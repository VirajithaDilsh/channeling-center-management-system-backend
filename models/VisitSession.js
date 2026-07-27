const mongoose = require("mongoose");

const lineItemSchema = new mongoose.Schema({
  type: { type: String, enum: ["DOCTOR_FEE", "CENTER_FEE", "MEDICATION", "ADJUSTMENT"], required: true },
  description: { type: String, required: true },
  qty: { type: Number, default: 1 },
  unitPrice: { type: Number, required: true },
  amount: { type: Number, required: true },
  refId: { type: mongoose.Schema.Types.ObjectId }, // e.g. prescription item this line came from
  postedAt: { type: Date, default: Date.now },
}, { _id: true });

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  method: { type: String, default: "cash" },
  receivedBy: String,
  receivedAt: { type: Date, default: Date.now },
}, { _id: true });

const statusHistorySchema = new mongoose.Schema({
  from: String,
  to: { type: String, required: true },
  at: { type: Date, default: Date.now },
  by: String,
  reason: String,
}, { _id: false });

const visitSessionSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
  patientId: { type: String, required: true, index: true },
  patientName: String,
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
  doctorName: String,

  status: {
    type: String,
    enum: ["OPEN", "PENDING_PHARMACY", "READY_FOR_PAYMENT", "CLOSED", "CANCELED"],
    default: "OPEN",
    index: true,
  },
  cancelRequested: { type: Boolean, default: false },

  lineItems: [lineItemSchema],
  payments: [paymentSchema],
  statusHistory: [statusHistorySchema],
}, { timestamps: true });

visitSessionSchema.methods.totalDue = function () {
  const total = this.lineItems.reduce((sum, li) => sum + li.amount, 0);
  const paid = this.payments.reduce((sum, p) => sum + p.amount, 0);
  return Math.max(0, Math.round((total - paid) * 100) / 100);
};

visitSessionSchema.methods.pushStatus = function (to, by, reason) {
  this.statusHistory.push({ from: this.status, to, by, reason });
  this.status = to;
};

module.exports = mongoose.model("VisitSession", visitSessionSchema);
