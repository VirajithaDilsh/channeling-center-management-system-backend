const express = require("express");
const router = express.Router();
const reportController = require("../controllers/reportController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);
router.use(requirePermission("reports_read", "reports_allow_all"));

router.get("/summary", reportController.summary);
router.get("/monthly", reportController.monthly);
router.get("/by-doctor", reportController.byDoctor);
router.get("/forecast", reportController.forecast);
router.get("/compare", reportController.compare);

module.exports = router;
