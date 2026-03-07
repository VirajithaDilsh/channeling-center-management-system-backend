// routes/auth.js
const express = require("express");
const router = express.Router();
const { login, resetPassword } = require("../controllers/authController");

router.post("/login", login);
router.post("/reset-password", resetPassword);

module.exports = router;