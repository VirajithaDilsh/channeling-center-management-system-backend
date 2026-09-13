const ChannelingRecord = require("../models/ChannelingRecord");
const Patient = require("../models/Patient");
const { resolveDoctorIdentity, doctorHasAppointmentWithPatient } = require("../services/doctorIdentityService");

function hasModuleGrant(req) {
  const perms = req.user?.permissions || [];
  return perms.includes("patients_read") || perms.includes("patients_allow_all");
}

exports.getChannelingHistory = async (req, res) => {
  try {
    if (!hasModuleGrant(req)) {
      const identity = await resolveDoctorIdentity(req);
      const owns = identity && (await doctorHasAppointmentWithPatient(identity.doctorId, req.params.id));
      if (!owns) return res.status(403).json({ message: "Not authorized for this resource" });
    }

    const history = await ChannelingRecord.find({ patientId: req.params.id }).sort({ recordedAt: -1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addChannelingRecord = async (req, res) => {
  try {
    const patient = await Patient.findOne({ patientId: req.params.id });
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const record = new ChannelingRecord({
      ...req.body,
      patientId: req.params.id,
      recordedByRole: req.user?.role,
      recordedByName: req.user?.name,
    });
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
