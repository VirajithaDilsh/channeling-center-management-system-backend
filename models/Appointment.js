const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema({
  patientId: { type: String, required: true },
  patientName: String,
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
  doctorName: String,
  date: { type: Date, required: true },
  time: String,
  reason: String,
  status: { type: String, enum: ["Scheduled", "Completed", "Cancelled"], default: "Scheduled" },
}, { timestamps: true });

module.exports = mongoose.model("Appointment", appointmentSchema);
