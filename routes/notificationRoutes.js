const express = require("express");
const router = express.Router();
const { verifyToken, requireAdmin } = require("../middleware/authMiddleware");
const {
  getInventoryNotifications,
  getUnreadInventoryNotificationCount,
  markInventoryNotificationRead,
  markAllInventoryNotificationsRead,
} = require("../controllers/notificationController");

router.use(verifyToken, requireAdmin);

router.get("/inventory", getInventoryNotifications);
router.get("/inventory/unread-count", getUnreadInventoryNotificationCount);
router.patch("/inventory/read-all", markAllInventoryNotificationsRead);
router.patch("/inventory/:id/read", markInventoryNotificationRead);

module.exports = router;

