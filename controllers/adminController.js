const Admin = require("../models/Admin");

exports.createAdmin = async (req, res) => {

  try {

    const admin = new Admin(req.body);

    await admin.save();

    res.status(201).json(admin);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};


exports.getAdmins = async (req, res) => {

  try {

    const admins = await Admin.find();

    res.json(admins);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};


exports.getAdminById = async (req, res) => {

  try {

    const admin = await Admin.findById(req.params.id);

    if (!admin) return res.status(404).json({ message: "Admin not found" });

    res.json(admin);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};


exports.updateAdmin = async (req, res) => {

  try {

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!admin) return res.status(404).json({ message: "Admin not found" });

    res.json(admin);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};


exports.deleteAdmin = async (req, res) => {

  try {

    const admin = await Admin.findByIdAndDelete(req.params.id);

    if (!admin) return res.status(404).json({ message: "Admin not found" });

    res.json({ message: "Admin deleted successfully" });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};
