const express = require("express");
const router = express.Router();
const channelingController = require("../controllers/channelingController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken, requirePermission("manage_patients"));

router.get("/:id/channeling-history", channelingController.getChannelingHistory);
router.post("/:id/channeling-history", channelingController.addChannelingRecord);

module.exports = router;
