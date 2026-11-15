const Doctor = require("../models/Doctor");
const Schedule = require("../models/Schedule"); // 👈 add this import
const Admin = require("../models/Admin");
const Appointment = require("../models/Appointment");
const SystemSettings = require("../models/SystemSettings");
const { createDoctorAccount, setDoctorPassword: setDoctorPasswordService } = require("../services/doctorAccountService");
const availability = require("../services/availabilityService");

// Validates a weekly window and rejects overlaps with the doctor's other
// windows on the same day. Returns { error, status } or { values }.
async function checkWindow(doctorId, input, excludeId) {
  const values = {
    dayOfWeek: input.dayOfWeek === undefined || input.dayOfWeek === "" ? undefined : Number(input.dayOfWeek),
    startTime: input.startTime,
    endTime: input.endTime,
    maxPatients: availability.normalizeMaxPatients(input.maxPatients),
  };
  const invalid = availability.validateWindow(values);
  if (invalid) return { error: invalid, status: 400 };

  const others = await Schedule.find({ doctorId, dayOfWeek: values.dayOfWeek, status: "Active" });
  const clash = others.find((o) => String(o._id) !== String(excludeId) && availability.overlaps(values, o));
  if (clash) {
    return {
      error: `Overlaps an existing ${availability.WEEKDAY_NAMES[values.dayOfWeek]} slot (${clash.startTime}-${clash.endTime})`,
      status: 409,
    };
  }
  return { values };
}

// Resolves which Doctor record the logged-in user owns. Doctor-portal
// endpoints always derive the doctorId server-side from the token's admin id
// rather than trusting a client-supplied id, so a doctor can never read or
// modify another doctor's profile/schedule by changing a URL param.
async function resolveOwnDoctorId(req) {
  const admin = await Admin.findById(req.user.id);
  return admin?.doctorId || null;
}

// Only these fields are self-editable; specialization/fee/email stay
// admin-managed since they're business-critical (pricing, login matching).
// Status (Available/Busy/On Leave) is a day-to-day availability toggle, so
// doctors can set it themselves.
const SELF_EDITABLE_DOCTOR_FIELDS = ["phone", "experience", "status"];

const SELF_EDITABLE_STATUS_VALUES = ["Available", "Busy", "On Leave"];

exports.createDoctor = async (req, res) => {
  try {
    const { doctor, admin } = await createDoctorAccount(req.body);
    res.status(201).json({ doctor, admin });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

exports.getDoctors = async (req, res) => {
  try {
    const doctors = await Doctor.find().lean();
    // Attach each doctor's weekly slots (single query) so the Doctors page can
    // show availability without N+1 requests. Legacy dated schedules have no
    // dayOfWeek and are skipped.
    const windows = await Schedule.find({ dayOfWeek: { $ne: null }, status: "Active" })
      .sort({ dayOfWeek: 1, startTime: 1 })
      .lean();
    const byDoctor = {};
    windows.forEach((w) => {
      (byDoctor[String(w.doctorId)] ||= []).push(w);
    });
    // Whether each doctor already has a login (lets the UI label "Create login" vs "Reset password").
    const accounts = await Admin.find({ doctorId: { $ne: null } }).select("doctorId");
    const withAccount = new Set(accounts.map((a) => String(a.doctorId)));
    res.json(doctors.map((d) => ({
      ...d,
      weeklySchedule: byDoctor[String(d._id)] || [],
      hasAccount: withAccount.has(String(d._id)),
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Bookable dates for a doctor: every upcoming date (within the advance-booking
// limit) that falls on one of their weekly windows, with how many bookings are
// left (remaining = null means unlimited).
exports.getDoctorAvailability = async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) return res.status(404).json({ message: "Doctor not found" });

    const settings = await SystemSettings.getSingleton();
    const windows = await Schedule.find({ doctorId: doctor._id, dayOfWeek: { $ne: null }, status: "Active" });
    const dates = availability.upcomingDates(windows, { days: settings.appointments.maxAdvanceBookingDays });

    if (!dates.length) {
      return res.json({ doctorId: doctor._id, status: doctor.status, onLeave: doctor.status === "On Leave", dates: [] });
    }

    const first = new Date(`${dates[0].date}T00:00:00Z`);
    const last = new Date(`${dates[dates.length - 1].date}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() + 1);
    const booked = await Appointment.find({
      doctorId: doctor._id,
      status: { $ne: "Cancelled" },
      date: { $gte: first, $lt: last },
    }).lean();

    const byDay = {};
    booked.forEach((a) => {
      (byDay[availability.toDateKey(a.date)] ||= []).push(a);
    });

    const result = dates.map(({ date, window }) => {
      const dayWindows = windows.filter((w) => w.dayOfWeek === window.dayOfWeek);
      const count = availability.countInWindow(window, byDay[date] || [], dayWindows);
      const remaining = availability.remainingFor(window, count);
      return {
        date,
        dayOfWeek: window.dayOfWeek,
        scheduleId: window._id,
        startTime: window.startTime,
        endTime: window.endTime,
        maxPatients: window.maxPatients ?? null,
        booked: count,
        remaining,
        full: remaining === 0,
      };
    });
    res.json({ doctorId: doctor._id, status: doctor.status, onLeave: doctor.status === "On Leave", dates: result });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin-only: set (create or reset) a doctor's login password.
exports.setDoctorPassword = async (req, res) => {
  try {
    const { created } = await setDoctorPasswordService(req.params.id, req.body?.newPassword);
    res.json({
      created,
      message: created ? "Login created with the new password" : "Password reset successfully",
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Could not set the password" });
  }
};

exports.getDoctorById = async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id).lean();
    if (!doctor) return res.json(doctor);
    const weeklySchedule = await Schedule.find({ doctorId: doctor._id, dayOfWeek: { $ne: null }, status: "Active" })
      .sort({ dayOfWeek: 1, startTime: 1 })
      .lean();
    res.json({ ...doctor, weeklySchedule });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateDoctor = async (req, res) => {
  try {
    const doctor = await Doctor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(doctor);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteDoctor = async (req, res) => {
  try {
    await Doctor.findByIdAndDelete(req.params.id);
    res.json({ message: "Doctor deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ Schedule functions below

exports.getSchedulesByDoctor = async (req, res) => {
  try {
    console.log("Getting schedules for doctorId:", req.params.doctorId);
    const schedules = await Schedule.find({ doctorId: req.params.doctorId });
    res.json(schedules);
  } catch (error) {
    console.error("getSchedulesByDoctor error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

exports.createSchedule = async (req, res) => {
  try {
    if (!req.body.doctorId) return res.status(400).json({ message: "doctorId is required" });
    const checked = await checkWindow(req.body.doctorId, req.body);
    if (checked.error) return res.status(checked.status).json({ message: checked.error });

    const schedule = new Schedule({ doctorId: req.body.doctorId, ...checked.values });
    await schedule.save();
    res.status(201).json(schedule);
  } catch (error) {
    console.error("createSchedule error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

exports.updateSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });

    const merged = {
      dayOfWeek: req.body.dayOfWeek ?? schedule.dayOfWeek,
      startTime: req.body.startTime ?? schedule.startTime,
      endTime: req.body.endTime ?? schedule.endTime,
      maxPatients: req.body.maxPatients !== undefined ? req.body.maxPatients : schedule.maxPatients,
    };
    const checked = await checkWindow(schedule.doctorId, merged, schedule._id);
    if (checked.error) return res.status(checked.status).json({ message: checked.error });

    Object.assign(schedule, checked.values);
    if (req.body.status !== undefined) schedule.status = req.body.status;
    await schedule.save();
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSchedule = async (req, res) => {
  try {
    await Schedule.findByIdAndDelete(req.params.id);
    res.json({ message: "Schedule deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ Doctor self-service (Settings > Profile / Availability) below

exports.getMyProfile = async (req, res) => {
  try {
    const doctorId = await resolveOwnDoctorId(req);
    if (!doctorId) return res.status(404).json({ message: "No linked doctor profile found" });

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) return res.status(404).json({ message: "Doctor not found" });
    res.json(doctor);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateMyProfile = async (req, res) => {
  try {
    const doctorId = await resolveOwnDoctorId(req);
    if (!doctorId) return res.status(404).json({ message: "No linked doctor profile found" });

    if (req.body.status !== undefined && !SELF_EDITABLE_STATUS_VALUES.includes(req.body.status)) {
      return res.status(400).json({ message: `Status must be one of: ${SELF_EDITABLE_STATUS_VALUES.join(", ")}` });
    }

    const updates = {};
    SELF_EDITABLE_DOCTOR_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const doctor = await Doctor.findByIdAndUpdate(doctorId, updates, { new: true });
    if (!doctor) return res.status(404).json({ message: "Doctor not found" });
    res.json(doctor);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getMySchedules = async (req, res) => {
  try {
    const doctorId = await resolveOwnDoctorId(req);
    if (!doctorId) return res.status(404).json({ message: "No linked doctor profile found" });

    // Weekly windows only; legacy exact-date schedules (no dayOfWeek) are hidden.
    const schedules = await Schedule.find({ doctorId, dayOfWeek: { $ne: null } }).sort({ dayOfWeek: 1, startTime: 1 });
    res.json(schedules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createMySchedule = async (req, res) => {
  try {
    const doctorId = await resolveOwnDoctorId(req);
    if (!doctorId) return res.status(404).json({ message: "No linked doctor profile found" });

    const checked = await checkWindow(doctorId, req.body);
    if (checked.error) return res.status(checked.status).json({ message: checked.error });

    const schedule = new Schedule({ doctorId, ...checked.values });
    await schedule.save();
    res.status(201).json(schedule);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updateMySchedule = async (req, res) => {
  try {
    const doctorId = await resolveOwnDoctorId(req);
    if (!doctorId) return res.status(404).json({ message: "No linked doctor profile found" });

    const schedule = await Schedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });
    if (schedule.doctorId.toString() !== doctorId.toString()) {
      return res.status(403).json({ message: "Not authorized to modify this schedule" });
    }

    const merged = {
      dayOfWeek: req.body.dayOfWeek ?? schedule.dayOfWeek,
      startTime: req.body.startTime ?? schedule.startTime,
      endTime: req.body.endTime ?? schedule.endTime,
      maxPatients: req.body.maxPatients !== undefined ? req.body.maxPatients : schedule.maxPatients,
    };
    const checked = await checkWindow(doctorId, merged, schedule._id);
    if (checked.error) return res.status(checked.status).json({ message: checked.error });

    Object.assign(schedule, checked.values);
    if (["Active", "Inactive"].includes(req.body.status)) schedule.status = req.body.status;
    await schedule.save();
    res.json(schedule);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteMySchedule = async (req, res) => {
  try {
    const doctorId = await resolveOwnDoctorId(req);
    if (!doctorId) return res.status(404).json({ message: "No linked doctor profile found" });

    const schedule = await Schedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });
    if (schedule.doctorId.toString() !== doctorId.toString()) {
      return res.status(403).json({ message: "Not authorized to modify this schedule" });
    }

    await schedule.deleteOne();
    res.json({ message: "Schedule deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};