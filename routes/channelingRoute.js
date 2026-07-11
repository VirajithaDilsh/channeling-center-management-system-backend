const express = require("express");
const router = express.Router();
const channelingController = require("../controllers/channelingController");
const { verifyToken, authorize } = require("../middleware/authMiddleware");

router.use(verifyToken, authorize("admin", "doctor", "patient_manager"));

router.get("/:id/channeling-history", channelingController.getChannelingHistory);
router.post("/:id/channeling-history", channelingController.addChannelingRecord);

module.exports = router;
