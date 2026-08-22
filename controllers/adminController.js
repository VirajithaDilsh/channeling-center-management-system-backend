const Admin = require("../models/Admin");
const { createDoctorAccount } = require("../services/doctorAccountService");

// Self-service fields only — name/contact are safe for any authenticated
// user to change on their own account. email/role/adminId stay admin-managed
// since email is also how doctor accounts are matched to Doctor records
// (see doctorAccountService.js) and role controls permissions.
const SELF_EDITABLE_FIELDS = ["name", "contact"];

exports.getMe = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user.id).select("-password");
    if (!admin) return res.status(404).json({ message: "Account not found" });
    res.json(admin);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateMe = async (req, res) => {
  try {
    const updates = {};
    SELF_EDITABLE_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const admin = await Admin.findByIdAndUpdate(req.user.id, updates, { new: true }).select("-password");
    if (!admin) return res.status(404).json({ message: "Account not found" });
    res.json(admin);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const admin = await Admin.findById(req.user.id);
    if (!admin) return res.status(404).json({ message: "Account not found" });

    const matches = await admin.comparePassword(currentPassword);
    if (!matches) return res.status(400).json({ message: "Current password is incorrect" });

    admin.password = newPassword;
    await admin.save();
    res.json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createAdmin = async (req, res) => {

  try {

    if ((req.body.role || "").toLowerCase() === "doctor") {
      const { doctor, admin } = await createDoctorAccount(req.body);
      return res.status(201).json({ doctor, admin });
    }

    const existing = await Admin.findOne({ email: req.body.email });
    if (existing) {
      return res.status(400).json({ message: "An account with this email already exists" });
    }

    const admin = new Admin(req.body);

    await admin.save();

    const adminObj = admin.toObject();
    delete adminObj.password;

    res.status(201).json(adminObj);

  } catch (error) {

    res.status(error.status || 500).json({ message: error.message });

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
