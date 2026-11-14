const {
  getInventoryNotificationsForAdmin,
  markAlertAsRead,
  markAllAlertsAsRead,
} = require("../services/expiryAlertService");

exports.getInventoryNotifications = async (req, res) => {
  try {
    const data = await getInventoryNotificationsForAdmin(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getUnreadInventoryNotificationCount = async (req, res) => {
  try {
    const data = await getInventoryNotificationsForAdmin(req.user.id);
    res.json({
      enabled: data.enabled,
      showLoginPopup: data.showLoginPopup,
      soundEnabled: data.soundEnabled,
      thresholdDays: data.thresholdDays,
      unreadCount: data.unreadCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.markInventoryNotificationRead = async (req, res) => {
  try {
    const alertKey = String(req.params.id || "").trim();
    if (!alertKey) {
      return res.status(400).json({ message: "Notification id is required" });
    }
    await markAlertAsRead(req.user.id, alertKey);
    res.json({ message: "Notification marked as read", id: alertKey });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.markAllInventoryNotificationsRead = async (req, res) => {
  try {
    const count = await markAllAlertsAsRead(req.user.id);
    res.json({ message: "All notifications marked as read", count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

