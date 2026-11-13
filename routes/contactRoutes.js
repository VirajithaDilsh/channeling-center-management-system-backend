const express = require("express");
const router = express.Router();
const { sendContactMessage } = require("../controllers/contactController");
const rateLimit = require("../middleware/rateLimit");

router.post("/", rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), sendContactMessage);

module.exports = router;
