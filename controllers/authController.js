const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ message: "Invalid credentials" });

    const matches = await admin.comparePassword(password);
    if (!matches) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({ message: "Login successful", token, role: admin.role });
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
