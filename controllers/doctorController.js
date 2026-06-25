const Doctor = require("../models/Doctor");

exports.createDoctor = async (req, res) => {

  try {

    const doctor = new Doctor(req.body);

    await doctor.save();

    res.status(201).json(doctor);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};


exports.getDoctors = async (req, res) => {

  try {

    const doctors = await Doctor.find();

    res.json(doctors);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};


exports.getDoctorById = async (req, res) => {

  try {

    const doctor = await Doctor.findById(req.params.id);

    res.json(doctor);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};


exports.updateDoctor = async (req, res) => {

  try {

    const doctor = await Doctor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json(doctor);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};


exports.deleteDoctor = async (req, res) => {

  try {

    await Doctor.findByIdAndDelete(req.params.id);

    res.json({ message: "Doctor deleted successfully" });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};

const addDoctor = async (req, res) => {

  try {

    const doctor = new Doctor(req.body);

    const savedDoctor = await doctor.save();

    res.status(201).json(savedDoctor);

  } catch (error) {

    res.status(500).json({
      message: "Error creating doctor",
      error: error.message
    });

  }

};

exports.addDoctor = addDoctor;
