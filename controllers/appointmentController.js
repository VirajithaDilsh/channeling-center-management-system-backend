const Appointment = require("../models/Appointment");
const { openForAppointment } = require("./visitSessionController");
const SystemSettings = require("../models/SystemSettings");

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

exports.getAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ date: -1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAppointmentById = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
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

    const appointment = new Appointment({
      durationMinutes: rules.defaultDurationMinutes,
      ...req.body,
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
