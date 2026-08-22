const Doctor = require("../models/Doctor");
const Schedule = require("../models/Schedule"); // 👈 add this import
const Admin = require("../models/Admin");
const { createDoctorAccount } = require("../services/doctorAccountService");

// Resolves which Doctor record the logged-in user owns. Doctor-portal
// endpoints always derive the doctorId server-side from the token's admin id
// rather than trusting a client-supplied id, so a doctor can never read or
// modify another doctor's profile/schedule by changing a URL param.
async function resolveOwnDoctorId(req) {
  const admin = await Admin.findById(req.user.id);
  return admin?.doctorId || null;
}

// Only these fields are self-editable; specialization/fee/status/email stay
// admin-managed since they're business-critical (pricing, login matching).
const SELF_EDITABLE_DOCTOR_FIELDS = ["phone", "experience"];

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
    const doctors = await Doctor.find();
    res.json(doctors);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getDoctorById = async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id);
    res.json(doctor);
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
    console.log("Body received:", req.body); 
    console.log("Schedule model:", Schedule);
    const schedule = new Schedule(req.body);
    await schedule.save();
    res.status(201).json(schedule);
  } catch (error) {
    console.error("❌ createSchedule error:", error.message);
    res.status(500).json({ message: error.message });
  }
};

exports.updateSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });
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

    const schedules = await Schedule.find({ doctorId }).sort({ date: 1, startTime: 1 });
    res.json(schedules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createMySchedule = async (req, res) => {
  try {
    const doctorId = await resolveOwnDoctorId(req);
    if (!doctorId) return res.status(404).json({ message: "No linked doctor profile found" });

    const { date, startTime, endTime, maxPatients } = req.body;
    const schedule = new Schedule({ doctorId, date, startTime, endTime, maxPatients });
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

    ["date", "startTime", "endTime", "maxPatients", "status"].forEach((field) => {
      if (req.body[field] !== undefined) schedule[field] = req.body[field];
    });
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