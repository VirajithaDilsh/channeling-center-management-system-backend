const mongoose = require("mongoose");

// Weekly recurring availability window: "every <dayOfWeek> from startTime to
// endTime". maxPatients is optional — null means unlimited bookings.
// `date` is legacy (old exact-date schedules); those documents have no
// dayOfWeek and are ignored by booking.
const scheduleSchema = new mongoose.Schema({
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Doctor",
    required: true
  },
  dayOfWeek: { type: Number, min: 0, max: 6 },
  date: { type: String },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  maxPatients: { type: Number, min: 1, default: null },
  status: {
    type: String,
    enum: ["Active", "Inactive", "Cancelled", "Completed"],
    default: "Active"
  }
}, { timestamps: true });

scheduleSchema.index({ doctorId: 1, dayOfWeek: 1 });

module.exports = mongoose.model("Schedule", scheduleSchema);
