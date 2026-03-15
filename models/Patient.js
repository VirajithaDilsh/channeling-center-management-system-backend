const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
  patientId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  age: Number,
  gender: String,
  phone: String,
  blood: String,
  doctor: String,
  address: String,
   disease: String,
  visit: Date,
  history: String,
  description: String
}, { timestamps: true });

module.exports = mongoose.model('Patient', patientSchema);