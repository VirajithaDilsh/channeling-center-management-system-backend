const express = require("express");
const router = express.Router();
const channelingController = require("../controllers/channelingController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.get("/:id/channeling-history", requirePermission("patients_read", "patients_allow_all"), channelingController.getChannelingHistory);
router.post("/:id/channeling-history", requirePermission("patients_write", "patients_allow_all"), channelingController.addChannelingRecord);

module.exports = router;
