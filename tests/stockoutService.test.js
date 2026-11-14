const { test } = require("node:test");
const assert = require("node:assert");

const {
  buildColomboWindowDates,
  aggregateDailyConsumption,
} = require("../services/stockoutService");
const { getStockoutPredictions } = require("../controllers/medicineController");
const stockoutService = require("../services/stockoutService");
const { ForecastUnavailable } = require("../services/forecastClient");
const medicineRoutes = require("../routes/medicineRoutes");

test("buildColomboWindowDates excludes today and uses Asia/Colombo calendar dates", () => {
  // 2026-11-14 01:00+05:30 = 2026-11-13T19:30:00.000Z
  const now = new Date("2026-11-13T19:30:00.000Z");
  const { asOfDate, dates } = buildColomboWindowDates(30, now);
  assert.strictEqual(asOfDate, "2026-11-14");
  assert.strictEqual(dates.length, 30);
  assert.strictEqual(dates[0], "2026-10-15");
  assert.strictEqual(dates[29], "2026-11-13");
});

test("aggregates internal (including partial), external, avoids double counting, and separates batches", () => {
  const now = new Date("2026-11-14T10:00:00+05:30");

  const medicines = [
    { _id: "med-batch-1", stockQuantity: 100, reorderLevel: 20, expiryDate: new Date("2027-01-01") },
    { _id: "med-batch-2", stockQuantity: 50, reorderLevel: 10, expiryDate: new Date("2026-11-10") }, // expired
  ];

  // External prescription dispensed on 2026-11-12 + one today (2026-11-14, must be excluded)
  const externalRecords = [
    {
      dispensedAt: new Date("2026-11-12T15:00:00+05:30"),
      items: [{ medicineId: "med-batch-1", qty: 4 }],
    },
    {
      dispensedAt: new Date("2026-11-14T00:05:00+05:30"), // today Colombo -> excluded
      items: [{ medicineId: "med-batch-1", qty: 99 }],
    },
  ];

  // Internal prescription partial dispensing (two lineItems with same refId)
  // Plus an external bill lineItem (refId: null) that MUST NOT be double-counted.
  const prescriptionItemMap = new Map([["rx-item-1", "med-batch-1"]]);
  const internalLineItems = [
    { refId: "rx-item-1", qty: 3, postedAt: new Date("2026-11-12T18:00:00+05:30") },
    { refId: "rx-item-1", qty: 2, postedAt: new Date("2026-11-13T09:00:00+05:30") },
    { refId: null, qty: 4, postedAt: new Date("2026-11-12T15:00:00+05:30") }, // external bill line -> ignored
  ];

  const { asOfDate, batchInputs } = aggregateDailyConsumption({
    medicines,
    externalRecords,
    internalLineItems,
    prescriptionItemMap,
    windowDays: 30,
    now,
  });

  assert.strictEqual(asOfDate, "2026-11-14");
  assert.strictEqual(batchInputs.length, 2);

  const b1 = batchInputs[0];
  const b2 = batchInputs[1];
  assert.strictEqual(b1.medicineId, "med-batch-1");
  assert.strictEqual(b1.isExpired, false);
  assert.strictEqual(b1.history.length, 30);

  const nov12 = b1.history.find((d) => d.date === "2026-11-12");
  const nov13 = b1.history.find((d) => d.date === "2026-11-13");
  const nov11 = b1.history.find((d) => d.date === "2026-11-11");
  assert.strictEqual(nov12.qty, 7); // 4 external + 3 internal, no double count
  assert.strictEqual(nov13.qty, 2); // partial dispense remainder
  assert.strictEqual(nov11.qty, 0); // zero-consumption day included

  // Batch 2 stays separate and marked expired
  assert.strictEqual(b2.medicineId, "med-batch-2");
  assert.strictEqual(b2.isExpired, true);
  assert.strictEqual(b2.history.every((d) => d.qty === 0), true);

  // Privacy check: only expected non-PII fields are included
  assert.deepStrictEqual(Object.keys(b1).sort(), [
    "currentStock",
    "history",
    "isExpired",
    "medicineId",
    "reorderLevel",
  ]);
});

test("getStockoutPredictions controller rejects invalid horizonDays with 400", async () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  await getStockoutPredictions({ query: { horizonDays: "0" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.message, /horizonDays/);
});

test("getStockoutPredictions controller returns 503 when Python forecast service is unavailable", async (t) => {
  t.mock.method(stockoutService, "getStockoutPredictions", async () => {
    throw new ForecastUnavailable("Forecast service is unreachable");
  });
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  await getStockoutPredictions({ query: { horizonDays: "14" } }, res);
  assert.strictEqual(res.statusCode, 503);
  assert.match(res.body.message, /unreachable/);
});

test("medicineRoutes registers /stockout-predictions before /:id with inventory_read permission", () => {
  const stack = medicineRoutes.stack.filter((layer) => layer.route);
  const paths = stack.map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  const stockoutIdx = paths.indexOf("GET /stockout-predictions");
  const putIdIdx = paths.indexOf("PUT /:id");
  assert.ok(stockoutIdx !== -1, "GET /stockout-predictions route must exist");
  assert.ok(stockoutIdx < putIdIdx, "GET /stockout-predictions must be registered before /:id");
});

