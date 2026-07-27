const Patient = require('../models/Patient');
const ChannelingRecord = require('../models/ChannelingRecord');

// Get all patients, with each patient's most recent channeling visit date
exports.getPatients = async (req, res) => {
  try {
    const patients = await Patient.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "channelingrecords",
          let: { pid: "$patientId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$patientId", "$$pid"] } } },
            { $sort: { recordedAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, recordedAt: 1 } }
          ],
          as: "lastVisitRecord"
        }
      },
      { $addFields: { lastVisit: { $arrayElemAt: ["$lastVisitRecord.recordedAt", 0] } } },
      { $project: { lastVisitRecord: 0 } }
    ]);
    res.json(patients);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get a single patient by ID
exports.getPatientById = async (req, res) => {
  try {
    const patient = await Patient.findOne({ patientId: req.params.id });
    if (!patient) return res.status(404).json({ message: "Patient not found" });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Create new patient
exports.createPatient = async (req, res) => {
  try {
    const newPatient = new Patient(req.body);
    await newPatient.save();
    res.status(201).json(newPatient);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Update patient
exports.updatePatient = async (req, res) => {
  try {
    const updatedPatient = await Patient.findOneAndUpdate(
      { patientId: req.params.id },
      req.body,
      { new: true }
    );
    if (!updatedPatient) return res.status(404).json({ message: "Patient not found" });
    res.json(updatedPatient);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Delete patient
exports.deletePatient = async (req, res) => {
  try {
    const deletedPatient = await Patient.findOneAndDelete({ patientId: req.params.id });
    if (!deletedPatient) return res.status(404).json({ message: "Patient not found" });
    await ChannelingRecord.deleteMany({ patientId: req.params.id });
    res.json({ message: "Patient deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
