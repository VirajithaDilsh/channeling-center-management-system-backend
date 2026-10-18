const test = require("node:test");
const assert = require("node:assert/strict");
const svc = require("../services/reportService");

test("month range uses Asia/Colombo boundaries", () => {
  const { from, to } = svc.monthRange("2026-03");
  assert.equal(from.toISOString(), "2026-02-28T18:30:00.000Z");
  assert.equal(to.toISOString(), "2026-03-31T18:30:00.000Z");
});

test("payment at 00:01 Colombo on the 1st falls in the new month", () => {
  const t = new Date("2026-03-31T18:31:00.000Z"); // 00:01 on 1 Apr Colombo
  const r = svc.monthRange("2026-04");
  assert.ok(t >= r.from && t < r.to);
  const prev = svc.monthRange("2026-03");
  assert.ok(!(t >= prev.from && t < prev.to));
});

test("december rolls into next year", () => {
  assert.equal(svc.monthRange("2026-12").to.toISOString(), "2026-12-31T18:30:00.000Z");
});

test("currentMonthKey is Colombo-local", () => {
  assert.equal(svc.currentMonthKey(new Date("2026-03-31T19:00:00.000Z")), "2026-04");
});

test("shiftMonth crosses year boundaries", () => {
  assert.equal(svc.shiftMonth({ year: 2026, month: 12 }, -11), "2026-01");
  assert.equal(svc.shiftMonth({ year: 2026, month: 3 }, -11), "2025-04");
});

test("fillMonths inserts zero months", () => {
  const out = svc.fillMonths([{ month: "2026-01", totalRevenue: 5 }], "2026-01", "2026-03");
  assert.deepEqual(out.map((m) => m.month), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(out[1].totalRevenue, 0);
});

test("invalid input is rejected", () => {
  assert.throws(() => svc.parseMonth("2026-13"), svc.ReportError);
  assert.throws(() => svc.parseYear("abc"), svc.ReportError);
});
