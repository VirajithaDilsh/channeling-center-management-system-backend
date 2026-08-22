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

  experience: {
    type: String
  },
  
  status: {
    type: String,
    default: "Available"
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin"
  }

}, { timestamps: true });

module.exports = mongoose.model("Doctor", doctorSchema);