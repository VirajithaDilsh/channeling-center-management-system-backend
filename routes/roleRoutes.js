const express = require("express");
const router = express.Router();
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

const {
  createRole,
  getRoles,
  getRoleById,
  updateRole,
  deleteRole
} = require("../controllers/roleController");

router.use(verifyToken);

router.post("/", requirePermission("admin_write", "admin_allow_all"), createRole);

router.get("/", requirePermission("admin_read", "admin_allow_all"), getRoles);

router.get("/:id", requirePermission("admin_read", "admin_allow_all"), getRoleById);

router.put("/:id", requirePermission("admin_edit", "admin_allow_all"), updateRole);

router.delete("/:id", requirePermission("admin_edit", "admin_allow_all"), deleteRole);

module.exports = router;
