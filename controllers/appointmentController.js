const Appointment = require("../models/Appointment");
const { openForAppointment } = require("./visitSessionController");
const SystemSettings = require("../models/SystemSettings");
const { resolveDoctorIdentity } = require("../services/doctorIdentityService");
const Doctor = require("../models/Doctor");
const Schedule = require("../models/Schedule");
const availability = require("../services/availabilityService");

function hasModuleGrant(req) {
  const perms = req.user?.permissions || [];
  return perms.includes("appointments_read") || perms.includes("appointments_allow_all");
}

// Appointment.date is stored as a Date (midnight) and .time as a separate
// "HH:mm" string, so the actual moment of the appointment has to be combined
// from both fields to run time-based rules (advance-booking / cancellation window).
function combineDateAndTime(date, time) {
  const combined = new Date(date);
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    const [h, m] = time.split(":").map(Number);
    combined.setHours(h, m, 0, 0);
  }
  return combined;
}

// Verifies the doctor is actually available for the requested date (and time,
// if given) per their weekly windows, and that the window isn't full.
// Returns { error, status } or { time } (time defaults to the window start).
async function checkBookable({ doctorId, date, time, excludeAppointmentId }) {
  const dateKey = availability.toDateKey(date);
  if (!doctorId || !dateKey) return { error: "A valid doctor and date are required", status: 400 };

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) return { error: "Doctor not found", status: 404 };
  if (doctor.status === "On Leave") return { error: "This doctor is currently on leave", status: 409 };

  const today = availability.localTodayKey();
  if (dateKey < today) return { error: "Appointments can't be booked in the past", status: 400 };

  const windows = await Schedule.find({ doctorId, dayOfWeek: { $ne: null }, status: "Active" });
  const window = availability.findWindowForDate(windows, dateKey, time || undefined);
  if (!window) {
    return {
      error: time
        ? "The doctor is not available at that date and time"
        : "The doctor is not available on that date",
      status: 409,
    };
  }
  if (dateKey === today && availability.toMinutes(window.endTime) <= availability.localMinutes()) {
    return { error: "That availability window has already ended today", status: 409 };
  }

  const start = new Date(`${dateKey}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const filter = { doctorId, status: { $ne: "Cancelled" }, date: { $gte: start, $lt: end } };
  if (excludeAppointmentId) filter._id = { $ne: excludeAppointmentId };
  const sameDay = await Appointment.find(filter).lean();
  const dayWindows = windows.filter((w) => w.dayOfWeek === window.dayOfWeek);
  const booked = availability.countInWindow(window, sameDay, dayWindows);
  if (availability.remainingFor(window, booked) === 0) {
    return {
      error: `The doctor is fully booked for ${window.startTime}-${window.endTime} on that date (max ${window.maxPatients})`,
      status: 409,
    };
  }
  return { time: time || window.startTime };
}

exports.getAppointments = async (req, res) => {
  try {
    let filter = {};

    // A doctor holding only doctor_portal (no appointments_read/allow_all)
    // sees just their own appointments, not the whole schedule.
    if (!hasModuleGrant(req)) {
      const identity = await resolveDoctorIdentity(req);
      if (!identity) return res.status(403).json({ message: "Not authorized for this resource" });
      filter.doctorId = identity.doctorId;
    }

    const appointments = await Appointment.find(filter).sort({ date: -1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAppointmentById = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });

    if (!hasModuleGrant(req)) {
      const identity = await resolveDoctorIdentity(req);
      if (!identity || String(appointment.doctorId) !== String(identity.doctorId)) {
        return res.status(403).json({ message: "Not authorized for this resource" });
      }
    }

    res.json(appointment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createAppointment = async (req, res) => {
  try {
    const settings = await SystemSettings.getSingleton();
    const { appointments: rules } = settings;

    if (req.body.date) {
      const appointmentDate = new Date(req.body.date);
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + rules.maxAdvanceBookingDays);
      if (appointmentDate > maxDate) {
        return res.status(400).json({
          message: `Appointments can only be booked up to ${rules.maxAdvanceBookingDays} day(s) in advance`,
        });
      }
    }

    const bookable = await checkBookable({
      doctorId: req.body.doctorId,
      date: req.body.date,
      time: req.body.time,
    });
    if (bookable.error) return res.status(bookable.status).json({ message: bookable.error });

    // New bookings always start as Scheduled; the client can't pre-set status.
    const { status: _ignoredStatus, ...body } = req.body;
    const appointment = new Appointment({
      durationMinutes: rules.defaultDurationMinutes,
      ...body,
      time: bookable.time,
    });
    await appointment.save();

    // Opens the Unified Patient Ledger for this visit: posts Doctor Fee +
    // Center Fee line items. Booking still succeeds even if this fails since
    // the appointment itself is the primary record; billing can be opened
    // manually as a fallback.
    try {
      await openForAppointment(appointment);
    } catch (ledgerErr) {
      console.error("Failed to open visit session for appointment:", ledgerErr.message);
    }

    res.status(201).json(appointment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateAppointment = async (req, res) => {
  try {
    const existing = await Appointment.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Appointment not found" });

    if (req.body.status === "Cancelled" && existing.status !== "Cancelled") {
      const settings = await SystemSettings.getSingleton();
      const hoursUntil = (combineDateAndTime(existing.date, existing.time) - Date.now()) / 36e5;
      if (hoursUntil < settings.appointments.cancellationWindowHours) {
        return res.status(409).json({
          message: `Appointments can't be cancelled within ${settings.appointments.cancellationWindowHours} hour(s) of the scheduled time`,
        });
      }
    }

    // Re-check availability only when the doctor/date/time actually moves, so
    // status changes and edits to old appointments keep working.
    const sameDate = (a, b) => availability.toDateKey(a) === availability.toDateKey(b);
    const moved =
      (req.body.doctorId !== undefined && String(req.body.doctorId) !== String(existing.doctorId)) ||
      (req.body.date !== undefined && !sameDate(req.body.date, existing.date)) ||
      (req.body.time !== undefined && req.body.time !== existing.time);
    if (moved && req.body.status !== "Cancelled") {
      const bookable = await checkBookable({
        doctorId: req.body.doctorId ?? existing.doctorId,
        date: req.body.date ?? existing.date,
        time: req.body.time ?? existing.time,
        excludeAppointmentId: existing._id,
      });
      if (bookable.error) return res.status(bookable.status).json({ message: bookable.error });
    }

    const appointment = await Appointment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(appointment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteAppointment = async (req, res) => {
  try {
    const existing = await Appointment.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Appointment not found" });

    const settings = await SystemSettings.getSingleton();
    const hoursUntil = (combineDateAndTime(existing.date, existing.time) - Date.now()) / 36e5;
    if (hoursUntil < settings.appointments.cancellationWindowHours) {
      return res.status(409).json({
        message: `Appointments can't be cancelled within ${settings.appointments.cancellationWindowHours} hour(s) of the scheduled time`,
      });
    }

    await Appointment.findByIdAndDelete(req.params.id);
    res.json({ message: "Appointment deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
