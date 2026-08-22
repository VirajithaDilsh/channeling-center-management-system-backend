const express = require("express");
const router = express.Router();
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

const { getPermissionCatalog } = require("../controllers/permissionController");

router.get("/", verifyToken, requirePermission("admin_read", "admin_allow_all"), getPermissionCatalog);

module.exports = router;
