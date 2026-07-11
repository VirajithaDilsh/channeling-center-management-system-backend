const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({

  adminId: {
    type: String,
    required: true,
    unique: true
  },

  name: {
    type: String,
    required: true
  },

  email: {
    type: String,
    required: true,
    unique: true
  },

  role: {
    type: String,
    required: true
  },

  contact: {
    type: String
  },

  password: {
    type: String,
    required: true
  }

}, { timestamps: true });

module.exports = mongoose.model("Admin", adminSchema);
