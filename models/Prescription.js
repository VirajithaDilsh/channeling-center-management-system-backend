const mongoose = require("mongoose");

const prescriptionItemSchema = new mongoose.Schema({
  medicineId: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
  name: { type: String, required: true },
  dosage: String,
  frequency: String,
  duration: String,
  instructions: String,

  qtyPrescribed: { type: Number, required: true, min: 1 },
  qtyDispensed: { type: Number, default: 0 },
  unitPrice: { type: Number, required: true },

  status: {
    type: String,
    enum: ["QUEUED", "DISPENSED", "PARTIAL", "REJECTED", "CANCELED"],
    default: "QUEUED",
  },
  rejectionReason: String,
}, { _id: true });

const prescriptionSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
  visitSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "VisitSession", required: true, index: true },
  patientId: { type: String, required: true, index: true },
  patientName: String,
  doctorId: String,
  doctorName: String,
  diagnosis: String,
  notes: String,

  items: [prescriptionItemSchema],
  status: { type: String, enum: ["PENDING", "RESOLVED"], default: "PENDING", index: true },
}, { timestamps: true });

prescriptionSchema.methods.recomputeStatus = function () {
  const stillQueued = this.items.some((i) => i.status === "QUEUED");
  this.status = stillQueued ? "PENDING" : "RESOLVED";
  return this.status;
};

module.exports = mongoose.model("Prescription", prescriptionSchema);
