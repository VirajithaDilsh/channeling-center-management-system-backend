// controllers/authController.js
let adminEmail = "admin@example.com";
let adminPassword = "admin123";

exports.login = (req, res) => {
  const { email, password } = req.body;
  if (email === adminEmail && password === adminPassword) {
    return res.json({ message: "Login successful" });
  } else {
    return res.status(400).json({ message: "Invalid credentials" });
  }
};

exports.resetPassword = (req, res) => {
  const { email, newPassword } = req.body;
  if (email !== adminEmail) {
    return res.status(400).json({ message: "Email not found" });
  }
  adminPassword = newPassword;
  res.json({ message: "Password reset successfully! You can now login." });
};