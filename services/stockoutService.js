const Medicine = require("../models/Medicine");
const ExternalPrescription = require("../models/ExternalPrescription");
const Prescription = require("../models/Prescription");
const VisitSession = require("../models/VisitSession");
const { requestStockoutPredictions } = require("./forecastClient");
const {
  formatColomboYmd,
  getColomboDateParts,
  getColomboTodayStartUtc,
  isExpiredInColombo,
} = require("./expiryAlertService");

const MS_PER_DAY = 86400000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_HORIZON_DAYS = 30;

/**
 * Builds the ordered list of complete Asia/Colombo calendar dates (YYYY-MM-DD)
 * for the trailing `windowDays` window, excluding today's incomplete day.
 */
function buildColomboWindowDates(windowDays = DEFAULT_WINDOW_DAYS, now = new Date()) {
  const todayStartUtc = getColomboTodayStartUtc(now);
  const windowStartUtc = new Date(todayStartUtc.getTime() - windowDays * MS_PER_DAY);
  const asOfDate = formatColomboYmd(todayStartUtc);
  const todayParts = getColomboDateParts(now);

  const dates = [];
  for (let offset = windowDays; offset >= 1; offset -= 1) {
    const d = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day - offset));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }

  return { asOfDate, todayStartUtc, windowStartUtc, dates };
}

function toValidPositiveQty(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/**
 * Aggregates historical daily consumption per Medicine._id from external and
 * internal dispensing records without double-counting or leaking patient PII.
 */
function aggregateDailyConsumption({
  medicines = [],
  externalRecords = [],
  internalLineItems = [],
  prescriptionItemMap = new Map(),
  windowDays = DEFAULT_WINDOW_DAYS,
  now = new Date(),
}) {
  const { asOfDate, todayStartUtc, windowStartUtc, dates } = buildColomboWindowDates(windowDays, now);
  const dateSet = new Set(dates);
  const byMedicine = new Map();

  for (const med of medicines) {
    const id = String(med._id);
    const dayMap = new Map();
    for (const d of dates) dayMap.set(d, 0);
    byMedicine.set(id, dayMap);
  }

  const addUsage = (medicineId, timestamp, rawQty) => {
    if (!medicineId || !timestamp) return;
    const ts = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(ts.getTime())) return;
    // Exclude today's incomplete day and records outside the trailing window.
    if (ts < windowStartUtc || ts >= todayStartUtc) return;

    const qty = toValidPositiveQty(rawQty);
    if (qty <= 0) return;

    const dayMap = byMedicine.get(String(medicineId));
    if (!dayMap) return;

    const ymd = formatColomboYmd(ts);
    if (!ymd || !dateSet.has(ymd)) return;
    dayMap.set(ymd, Math.round((dayMap.get(ymd) + qty) * 10000) / 10000);
  };

  // External prescriptions: ExternalPrescription.items[].{medicineId, qty} @ dispensedAt
  for (const record of externalRecords) {
    for (const item of record.items || []) {
      addUsage(item.medicineId, record.dispensedAt, item.qty);
    }
  }

  // Internal prescriptions: VisitSession.lineItems[].{refId, qty, postedAt}
  // joined to Prescription.items[]._id -> medicineId.
  for (const line of internalLineItems) {
    if (!line.refId) continue;
    const medicineId = prescriptionItemMap.get(String(line.refId));
    if (!medicineId) continue;
    addUsage(medicineId, line.postedAt, line.qty);
  }

  const batchInputs = medicines.map((med) => {
    const id = String(med._id);
    const dayMap = byMedicine.get(id);
    const history = dates.map((date) => ({ date, qty: dayMap.get(date) || 0 }));
    return {
      medicineId: id,
      currentStock: Math.max(0, Number(med.stockQuantity) || 0),
      reorderLevel: Math.max(0, Number(med.reorderLevel) || 0),
      isExpired: isExpiredInColombo(med.expiryDate, now),
      history,
    };
  });

  return { asOfDate, batchInputs };
}

async function getStockoutPredictions({
  horizonDays = DEFAULT_HORIZON_DAYS,
  windowDays = DEFAULT_WINDOW_DAYS,
  now = new Date(),
} = {}) {
  const { asOfDate, todayStartUtc, windowStartUtc } = buildColomboWindowDates(windowDays, now);

  const medicines = await Medicine.find(
    {},
    "_id name batchNumber unitType stockQuantity reorderLevel expiryDate"
  ).lean();

  if (medicines.length === 0) {
    return {
      asOfDate,
      horizonDays,
      windowDays,
      modelUsed: "moving_average_30d",
      methodType: "statistical_moving_average",
      predictions: [],
    };
  }

  const [externalRecords, internalSessions] = await Promise.all([
    ExternalPrescription.find(
      { dispensedAt: { $gte: windowStartUtc, $lt: todayStartUtc } },
      "dispensedAt items.medicineId items.qty"
    ).lean(),
    VisitSession.aggregate([
      {
        $match: {
          status: { $ne: "CANCELED" },
          lineItems: {
            $elemMatch: {
              type: "MEDICATION",
              refId: { $ne: null },
              postedAt: { $gte: windowStartUtc, $lt: todayStartUtc },
            },
          },
        },
      },
      { $unwind: "$lineItems" },
      {
        $match: {
          "lineItems.type": "MEDICATION",
          "lineItems.refId": { $ne: null },
          "lineItems.postedAt": { $gte: windowStartUtc, $lt: todayStartUtc },
        },
      },
      {
        $project: {
          _id: 0,
          refId: "$lineItems.refId",
          qty: "$lineItems.qty",
          postedAt: "$lineItems.postedAt",
        },
      },
    ]),
  ]);

  const refIds = [...new Set(internalSessions.map((l) => l.refId).filter(Boolean))];
  const prescriptionItemMap = new Map();
  if (refIds.length > 0) {
    const prescriptions = await Prescription.find(
      { "items._id": { $in: refIds } },
      "items._id items.medicineId"
    ).lean();
    for (const rx of prescriptions) {
      for (const item of rx.items || []) {
        if (item._id && item.medicineId) {
          prescriptionItemMap.set(String(item._id), String(item.medicineId));
        }
      }
    }
  }

  const { batchInputs } = aggregateDailyConsumption({
    medicines,
    externalRecords,
    internalLineItems: internalSessions,
    prescriptionItemMap,
    windowDays,
    now,
  });

  const forecastResponse = await requestStockoutPredictions({
    horizonDays,
    windowDays,
    asOfDate,
    medicines: batchInputs,
  });

  const medById = new Map(medicines.map((m) => [String(m._id), m]));
  const predictions = (forecastResponse.predictions || []).map((pred) => {
    const med = medById.get(String(pred.medicineId));
    return {
      ...pred,
      name: med?.name || null,
      batchNumber: med?.batchNumber || null,
      unitType: med?.unitType || null,
      expiryDate: med?.expiryDate || null,
    };
  });

  return {
    asOfDate: forecastResponse.asOfDate || asOfDate,
    horizonDays: forecastResponse.horizonDays || horizonDays,
    windowDays: forecastResponse.windowDays || windowDays,
    modelUsed: forecastResponse.modelUsed || "moving_average_30d",
    methodType: forecastResponse.methodType || "statistical_moving_average",
    predictions,
  };
}

module.exports = {
  buildColomboWindowDates,
  aggregateDailyConsumption,
  getStockoutPredictions,
};

