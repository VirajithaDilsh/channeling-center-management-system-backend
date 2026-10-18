const express = require("express");
const router = express.Router();
const assistantController = require("../controllers/assistantController");
const rateLimit = require("../middleware/rateLimit");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);
router.use(requirePermission("reports_read", "reports_allow_all"));

router.get("/status", assistantController.status);
router.post("/chat", rateLimit({ windowMs: 60000, max: 10 }), assistantController.chat);

module.exports = router;
