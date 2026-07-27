const Appointment = require("../models/Appointment");
const { openForAppointment } = require("./visitSessionController");

exports.getAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ date: -1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createAppointment = async (req, res) => {
  try {
    const appointment = new Appointment(req.body);
    await appointment.save();

    // Opens the Unified Patient Ledger for this visit: posts Doctor Fee +
    // Center Fee line items. Booking still succeeds even if this fails since
    // the appointment itself is the primary record; billing can be opened
    // manually as a fallback.
    try {
      await openForAppointment(appointment);
    } catch (ledgerErr) {
      console.error("Failed to open visit session for appointment:", ledgerErr.message);
    }

    res.status(201).json(appointment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    res.json(appointment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndDelete(req.params.id);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    res.json({ message: "Appointment deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
