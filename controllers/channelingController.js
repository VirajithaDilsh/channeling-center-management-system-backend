const ChannelingRecord = require("../models/ChannelingRecord");
const Patient = require("../models/Patient");

exports.getChannelingHistory = async (req, res) => {
  try {
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
