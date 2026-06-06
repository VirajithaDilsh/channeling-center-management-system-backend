const mongoose = require("mongoose");

const scheduleSchema = new mongoose.Schema({
  doctorId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Doctor", 
    required: true 
  },
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  maxPatients: { type: Number, required: true },
  status: {
    type: String,
    enum: ["Active", "Cancelled", "Completed"],
    default: "Active"
  }
}, { timestamps: true });

module.exports = mongoose.model("Schedule", scheduleSchema);