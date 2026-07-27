const mongoose = require("mongoose");

const channelingRecordSchema = new mongoose.Schema({
  patientId: { type: String, required: true, index: true },
  recordedAt: { type: Date, default: Date.now },
  recordedByRole: String,
  recordedByName: String,
  doctor: String,
  disease: String,
  medicalHistory: String,
  bloodPressureSystolic: Number,
  bloodPressureDiastolic: Number,
  heartRate: Number,
  temperature: Number,
  weight: Number,
  height: Number,
  cholesterol: Number,
  sugarLevel: Number,
  allergies: String,
  notes: String,
}, { timestamps: true });

module.exports = mongoose.model("ChannelingRecord", channelingRecordSchema);
