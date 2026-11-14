const Medicine = require("../models/Medicine");
const NotificationRead = require("../models/NotificationRead");
const SystemSettings = require("../models/SystemSettings");

const COLOMBO_TZ = "Asia/Colombo";
const MS_PER_DAY = 86400000;
const COLOMBO_OFFSET_MS = 5.5 * 3600 * 1000; // UTC+05:30 (Sri Lanka has no DST)

const colomboDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: COLOMBO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Extracts calendar (year, month, day) in Asia/Colombo using formatToParts()
 * so comparisons never depend on server locale or runtime timezone.
 */
function getColomboDateParts(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;

  const parts = colomboDateFormatter.formatToParts(date);
  let year;
  let month;
  let day;
  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function formatColomboYmd(dateInput) {
  const parts = getColomboDateParts(dateInput);
  if (!parts) return null;
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

function toEpochDay(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY);
}

/**
 * Returns the UTC Date corresponding to 00:00:00.000+05:30 on the given
 * calendar day in Asia/Colombo. Any stored expiryDate >= this instant falls
 * on today or a future calendar day in Asia/Colombo and is not yet expired.
 */
function getColomboTodayStartUtc(now = new Date()) {
  const parts = getColomboDateParts(now);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - COLOMBO_OFFSET_MS);
}

function getDaysRemainingInColombo(expiryDate, now = new Date()) {
  if (!expiryDate) return null;
  const expiryParts = getColomboDateParts(expiryDate);
  if (!expiryParts) return null;
  const todayParts = getColomboDateParts(now);
  return toEpochDay(expiryParts) - toEpochDay(todayParts);
}

function isExpiredInColombo(expiryDate, now = new Date()) {
  const days = getDaysRemainingInColombo(expiryDate, now);
  return days !== null && days < 0;
}

/**
 * Classifies a medicine's expiry status using Asia/Colombo calendar dates.
 * - daysRemaining < 0 -> EXPIRED
 * - 0 <= daysRemaining <= 7 -> URGENT
 * - 8 <= daysRemaining <= thresholdDays -> EXPIRING_SOON
 * - daysRemaining > thresholdDays -> NORMAL
 */
function classifyExpiry(expiryDate, thresholdDays = 30, now = new Date()) {
  const daysRemaining = getDaysRemainingInColombo(expiryDate, now);
  if (daysRemaining === null) {
    return { status: "NORMAL", priority: null, daysRemaining: null, expiryYmd: null };
  }

  const expiryYmd = formatColomboYmd(expiryDate);
  const safeThreshold = Number.isFinite(Number(thresholdDays)) && Number(thresholdDays) >= 1
    ? Number(thresholdDays)
    : 30;

  if (daysRemaining < 0) {
    return { status: "EXPIRED", priority: "CRITICAL", daysRemaining, expiryYmd };
  }
  if (daysRemaining <= 7) {
    return { status: "URGENT", priority: "HIGH", daysRemaining, expiryYmd };
  }
  if (daysRemaining <= safeThreshold) {
    return { status: "EXPIRING_SOON", priority: "MEDIUM", daysRemaining, expiryYmd };
  }
  return { status: "NORMAL", priority: null, daysRemaining, expiryYmd };
}

function buildAlertKey(medicineId, expiryYmd) {
  return `${String(medicineId)}:${expiryYmd}`;
}

const STATUS_SORT_ORDER = {
  EXPIRED: 0,
  URGENT: 1,
  EXPIRING_SOON: 2,
};

function buildActiveAlertsFromMedicines(medicines, thresholdDays = 30, now = new Date()) {
  const alerts = [];
  for (const med of medicines) {
    const stock = Number(med?.stockQuantity);
    if (!Number.isFinite(stock) || stock <= 0) continue;
    if (!med?.expiryDate) continue;

    const classification = classifyExpiry(med.expiryDate, thresholdDays, now);
    if (classification.status === "NORMAL") continue;

    alerts.push({
      id: buildAlertKey(med._id, classification.expiryYmd),
      medicineId: String(med._id),
      name: med.name || "Unnamed Medicine",
      batchNumber: med.batchNumber || "",
      expiryDate: med.expiryDate,
      expiryYmd: classification.expiryYmd,
      stockQuantity: stock,
      unitType: med.unitType || "",
      status: classification.status,
      priority: classification.priority,
      daysRemaining: classification.daysRemaining,
    });
  }

  alerts.sort((a, b) => {
    const orderDiff = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
    if (orderDiff !== 0) return orderDiff;
    return a.daysRemaining - b.daysRemaining;
  });

  return alerts;
}

const DEFAULT_PREFS = {
  enabled: true,
  thresholdDays: 30,
  showLoginPopup: true,
  soundEnabled: false,
};

async function getNotificationPreferences() {
  const settings = await SystemSettings.getSingleton();
  const prefs = settings.inventoryNotifications || {};
  return {
    enabled: prefs.enabled !== undefined ? Boolean(prefs.enabled) : DEFAULT_PREFS.enabled,
    thresholdDays:
      Number.isFinite(Number(prefs.thresholdDays)) && Number(prefs.thresholdDays) >= 1
        ? Number(prefs.thresholdDays)
        : DEFAULT_PREFS.thresholdDays,
    showLoginPopup:
      prefs.showLoginPopup !== undefined ? Boolean(prefs.showLoginPopup) : DEFAULT_PREFS.showLoginPopup,
    soundEnabled:
      prefs.soundEnabled !== undefined ? Boolean(prefs.soundEnabled) : DEFAULT_PREFS.soundEnabled,
  };
}

async function getInventoryNotificationsForAdmin(adminId, now = new Date()) {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled) {
    return {
      ...prefs,
      unreadCount: 0,
      notifications: [],
    };
  }

  const medicines = await Medicine.find({
    stockQuantity: { $gt: 0 },
    expiryDate: { $ne: null },
  })
    .select("name batchNumber expiryDate stockQuantity unitType")
    .lean();

  const rawAlerts = buildActiveAlertsFromMedicines(medicines, prefs.thresholdDays, now);
  if (rawAlerts.length === 0) {
    return {
      ...prefs,
      unreadCount: 0,
      notifications: [],
    };
  }

  const alertKeys = rawAlerts.map((a) => a.id);
  const readDocs = await NotificationRead.find({
    adminId,
    alertKey: { $in: alertKeys },
  })
    .select("alertKey")
    .lean();

  const readSet = new Set(readDocs.map((d) => d.alertKey));
  const notifications = rawAlerts.map((alert) => ({
    ...alert,
    isRead: readSet.has(alert.id),
  }));
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return {
    ...prefs,
    unreadCount,
    notifications,
  };
}

async function markAlertAsRead(adminId, alertKey) {
  await NotificationRead.updateOne(
    { adminId, alertKey },
    { $setOnInsert: { adminId, alertKey }, $set: { readAt: new Date() } },
    { upsert: true }
  );
}

async function markAllAlertsAsRead(adminId, now = new Date()) {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled) return 0;

  const medicines = await Medicine.find({
    stockQuantity: { $gt: 0 },
    expiryDate: { $ne: null },
  })
    .select("_id expiryDate stockQuantity")
    .lean();

  const rawAlerts = buildActiveAlertsFromMedicines(medicines, prefs.thresholdDays, now);
  if (rawAlerts.length === 0) return 0;

  const readAt = new Date();
  const ops = rawAlerts.map((alert) => ({
    updateOne: {
      filter: { adminId, alertKey: alert.id },
      update: { $setOnInsert: { adminId, alertKey: alert.id }, $set: { readAt } },
      upsert: true,
    },
  }));

  await NotificationRead.bulkWrite(ops);
  return rawAlerts.length;
}

module.exports = {
  COLOMBO_TZ,
  getColomboDateParts,
  formatColomboYmd,
  getColomboTodayStartUtc,
  getDaysRemainingInColombo,
  isExpiredInColombo,
  classifyExpiry,
  buildAlertKey,
  buildActiveAlertsFromMedicines,
  getNotificationPreferences,
  getInventoryNotificationsForAdmin,
  markAlertAsRead,
  markAllAlertsAsRead,
};

