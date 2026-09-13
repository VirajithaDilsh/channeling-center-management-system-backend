const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Role = require("../models/Role");

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const admin = await Admin.findOne({ email }).populate("doctorId", "name");
    if (!admin) return res.status(400).json({ message: "Invalid credentials" });

    const matches = await admin.comparePassword(password);
    if (!matches) return res.status(400).json({ message: "Invalid credentials" });

    // Case-insensitive: some accounts have a role value (e.g. "Admin") that
    // differs in case from the actual Role document ("admin") — an exact
    // match here would silently resolve to zero permissions.
    const roleDoc = await Role.findOne({ name: admin.role }).collation({ locale: "en", strength: 2 });
    const permissions = roleDoc ? roleDoc.permissions : [];

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role, name: admin.name, permissions },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    // doctorId/doctorName come straight from the Admin.doctorId FK (set at account
    // creation by doctorAccountService), not from matching email strings — this is
    // the authoritative link the rest of the doctor-portal APIs already rely on.
    return res.json({
      message: "Login successful",
      token,
      role: admin.role,
      permissions,
      doctorId: admin.doctorId ? admin.doctorId._id : null,
      doctorName: admin.doctorId ? admin.doctorId.name : null,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  const { email, newPassword } = req.body;
  try {
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ message: "Email not found" });

    admin.password = newPassword;
    await admin.save();
    res.json({ message: "Password reset successfully! You can now login." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
