const mongoose = require("mongoose");

const doctorSchema = new mongoose.Schema({

  name: {
    type: String,
    required: true
  },

  specialization: {
    type: String,
    required: true
  },

  qualifications: {
    type: String
  },

  fee: {
    type: Number,
    required: true
  },

  phone: {
    type: String
  },

  email: {
    type: String
  },

  status: {
    type: String,
    default: "Active"
  }

}, { timestamps: true });

module.exports = mongoose.model("Doctor", doctorSchema);