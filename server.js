const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
connectDB();

// Admin credentials
let adminPassword = "admin123";
const adminEmail = "admin@example.com";

// Login route
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (email === adminEmail && password === adminPassword) {
    return res.json({ message: "Login successful" });
  } else {
    return res.status(400).json({ message: "Invalid credentials" });
  }
});

// Reset password route
app.post("/api/reset-password", (req, res) => {
  const { email, newPassword } = req.body;
  if (email !== adminEmail) {
    return res.status(400).json({ message: "Email not found" });
  }
  adminPassword = newPassword;
  res.json({ message: "Password reset successfully! You can now login." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));