const express = require("express");
const router = express.Router();
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

const {
  createAdmin,
  getAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  getMe,
  updateMe,
  changePassword
} = require("../controllers/adminController");

router.use(verifyToken);

// Self-service routes (any authenticated user, own account only) — must be
// registered before the "/:id" routes below or "me" would be matched as an id.
router.get("/me", getMe);
router.patch("/me", updateMe);
router.patch("/change-password", changePassword);

router.post("/", requirePermission("admin_write", "admin_allow_all"), createAdmin);

router.get("/", requirePermission("admin_read", "admin_allow_all"), getAdmins);

router.get("/:id", requirePermission("admin_read", "admin_allow_all"), getAdminById);

router.put("/:id", requirePermission("admin_edit", "admin_allow_all"), updateAdmin);

router.delete("/:id", requirePermission("admin_edit", "admin_allow_all"), deleteAdmin);

module.exports = router;
