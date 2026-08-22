const express = require("express");
const router = express.Router();
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");
const { getPublicSettings, getSettings, updateSettings } = require("../controllers/settingsController");

// Open — needed by the pre-login Login page and by every authenticated role
// for non-sensitive branding/currency display.
router.get("/public", getPublicSettings);

router.use(verifyToken);

router.get("/", requirePermission("settings_read", "settings_allow_all"), getSettings);
router.put("/", requirePermission("settings_write", "settings_edit", "settings_allow_all"), updateSettings);

module.exports = router;
