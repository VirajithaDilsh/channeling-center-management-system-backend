const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatColomboYmd,
  getColomboTodayStartUtc,
  getDaysRemainingInColombo,
  isExpiredInColombo,
  classifyExpiry,
  buildActiveAlertsFromMedicines,
} = require("../services/expiryAlertService");

test("Asia/Colombo calendar date handles UTC midnight and +05:30 boundary accurately", () => {
  // 2026-11-14T18:29:59.000Z is 2026-11-14 23:59:59+05:30
  assert.equal(formatColomboYmd(new Date("2026-11-14T18:29:59.000Z")), "2026-11-14");
  // 2026-11-14T18:30:00.000Z is 2026-11-15 00:00:00+05:30
  assert.equal(formatColomboYmd(new Date("2026-11-14T18:30:00.000Z")), "2026-11-15");
  // Date-only ISO string saved at UTC midnight stays on the same calendar day in Colombo
  assert.equal(formatColomboYmd(new Date("2026-11-14T00:00:00.000Z")), "2026-11-14");
});

test("Medicine expiring today remains valid throughout today and expires tomorrow in Asia/Colombo", () => {
  const expiryDate = new Date("2026-11-14T00:00:00.000Z");

  // Still 2026-11-14 23:55:00 in Asia/Colombo (18:25:00Z)
  const lateTodayColombo = new Date("2026-11-14T18:25:00.000Z");
  assert.equal(getDaysRemainingInColombo(expiryDate, lateTodayColombo), 0);
  assert.equal(isExpiredInColombo(expiryDate, lateTodayColombo), false);
  assert.equal(classifyExpiry(expiryDate, 30, lateTodayColombo).status, "URGENT");

  // 2026-11-15 00:05:00 in Asia/Colombo (18:35:00Z on Nov 14)
  const earlyTomorrowColombo = new Date("2026-11-14T18:35:00.000Z");
  assert.equal(getDaysRemainingInColombo(expiryDate, earlyTomorrowColombo), -1);
  assert.equal(isExpiredInColombo(expiryDate, earlyTomorrowColombo), true);
  assert.equal(classifyExpiry(expiryDate, 30, earlyTomorrowColombo).status, "EXPIRED");
});

test("getColomboTodayStartUtc matches exact 00:00:00+05:30 boundary", () => {
  const now = new Date("2026-11-14T10:00:00.000Z"); // 15:30 in Colombo on Nov 14
  const startUtc = getColomboTodayStartUtc(now);
  assert.equal(startUtc.toISOString(), "2026-11-13T18:30:00.000Z");

  // Yesterday's UTC midnight is strictly before startUtc -> blocked by atomic query
  assert.ok(new Date("2026-11-13T00:00:00.000Z") < startUtc);
  // Today's UTC midnight is >= startUtc -> allowed by atomic query
  assert.ok(new Date("2026-11-14T00:00:00.000Z") >= startUtc);
});

test("classifyExpiry applies EXPIRED, URGENT (0-7d), EXPIRING_SOON (8-threshold), and NORMAL (>threshold)", () => {
  const now = new Date("2026-11-14T06:00:00.000Z");

  assert.equal(classifyExpiry(new Date("2026-11-13T00:00:00.000Z"), 30, now).status, "EXPIRED");
  assert.equal(classifyExpiry(new Date("2026-11-14T00:00:00.000Z"), 30, now).status, "URGENT");
  assert.equal(classifyExpiry(new Date("2026-11-21T00:00:00.000Z"), 30, now).status, "URGENT");
  assert.equal(classifyExpiry(new Date("2026-11-22T00:00:00.000Z"), 30, now).status, "EXPIRING_SOON");
  assert.equal(classifyExpiry(new Date("2026-12-14T00:00:00.000Z"), 30, now).status, "EXPIRING_SOON");
  assert.equal(classifyExpiry(new Date("2026-12-15T00:00:00.000Z"), 30, now).status, "NORMAL");

  // Custom thresholdDays = 14
  assert.equal(classifyExpiry(new Date("2026-11-28T00:00:00.000Z"), 14, now).status, "EXPIRING_SOON");
  assert.equal(classifyExpiry(new Date("2026-11-29T00:00:00.000Z"), 14, now).status, "NORMAL");
});

test("buildActiveAlertsFromMedicines excludes zero-stock and normal medicines and sorts by severity", () => {
  const now = new Date("2026-11-14T06:00:00.000Z");
  const medicines = [
    { _id: "1", name: "ZeroStockExpired", batchNumber: "B1", expiryDate: new Date("2026-11-01T00:00:00.000Z"), stockQuantity: 0 },
    { _id: "2", name: "NormalMed", batchNumber: "B2", expiryDate: new Date("2027-01-01T00:00:00.000Z"), stockQuantity: 10 },
    { _id: "3", name: "SoonMed", batchNumber: "B3", expiryDate: new Date("2026-11-25T00:00:00.000Z"), stockQuantity: 5 },
    { _id: "4", name: "ExpiredMed", batchNumber: "B4", expiryDate: new Date("2026-11-10T00:00:00.000Z"), stockQuantity: 3 },
    { _id: "5", name: "UrgentMed", batchNumber: "B5", expiryDate: new Date("2026-11-16T00:00:00.000Z"), stockQuantity: 8 },
  ];

  const alerts = buildActiveAlertsFromMedicines(medicines, 30, now);
  assert.deepEqual(
    alerts.map((a) => ({ name: a.name, status: a.status, priority: a.priority })),
    [
      { name: "ExpiredMed", status: "EXPIRED", priority: "CRITICAL" },
      { name: "UrgentMed", status: "URGENT", priority: "HIGH" },
      { name: "SoonMed", status: "EXPIRING_SOON", priority: "MEDIUM" },
    ]
  );
  assert.equal(alerts[0].id, "4:2026-11-10");
});

