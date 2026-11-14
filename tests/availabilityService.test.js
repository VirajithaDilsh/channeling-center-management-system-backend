const test = require("node:test");
const assert = require("node:assert/strict");
const a = require("../services/availabilityService");

const mon = { _id: "m", dayOfWeek: 1, startTime: "10:00", endTime: "12:00", maxPatients: 2, status: "Active" };
const monPm = { _id: "m2", dayOfWeek: 1, startTime: "14:00", endTime: "16:00", maxPatients: null, status: "Active" };

test("validateWindow accepts valid windows, blank/unlimited max", () => {
  assert.equal(a.validateWindow({ dayOfWeek: 1, startTime: "10:00", endTime: "12:00", maxPatients: 5 }), null);
  assert.equal(a.validateWindow({ dayOfWeek: 1, startTime: "10:00", endTime: "12:00", maxPatients: "" }), null);
  assert.equal(a.validateWindow({ dayOfWeek: 0, startTime: "00:00", endTime: "23:59", maxPatients: null }), null);
});

test("validateWindow rejects bad input", () => {
  assert.ok(a.validateWindow({ dayOfWeek: 7, startTime: "10:00", endTime: "12:00" }));
  assert.ok(a.validateWindow({ startTime: "10:00", endTime: "12:00" }));
  assert.ok(a.validateWindow({ dayOfWeek: 1, startTime: "12:00", endTime: "10:00" }));
  assert.ok(a.validateWindow({ dayOfWeek: 1, startTime: "10:00", endTime: "10:00" }));
  assert.ok(a.validateWindow({ dayOfWeek: 1, startTime: "9:00", endTime: "10:00" }));
  assert.ok(a.validateWindow({ dayOfWeek: 1, startTime: "10:00", endTime: "12:00", maxPatients: 0 }));
  assert.ok(a.validateWindow({ dayOfWeek: 1, startTime: "10:00", endTime: "12:00", maxPatients: 1.5 }));
});

test("normalizeMaxPatients", () => {
  assert.equal(a.normalizeMaxPatients(""), null);
  assert.equal(a.normalizeMaxPatients(undefined), null);
  assert.equal(a.normalizeMaxPatients("8"), 8);
});

test("overlaps: same day only, touching edges don't overlap", () => {
  assert.equal(a.overlaps(mon, { dayOfWeek: 1, startTime: "11:00", endTime: "13:00" }), true);
  assert.equal(a.overlaps(mon, { dayOfWeek: 1, startTime: "12:00", endTime: "13:00" }), false);
  assert.equal(a.overlaps(mon, { dayOfWeek: 2, startTime: "10:00", endTime: "12:00" }), false);
});

test("weekdayOf uses the calendar day (UTC) for YYYY-MM-DD and Dates", () => {
  assert.equal(a.weekdayOf("2026-11-16"), 1); // Monday
  assert.equal(a.weekdayOf(new Date("2026-11-16")), 1);
  assert.equal(a.weekdayOf("2026-11-15"), 0);
  assert.equal(a.weekdayOf("2026-13-45"), null);
  assert.equal(a.weekdayOf("garbage"), null);
});

test("findWindowForDate", () => {
  const ws = [mon, monPm, { ...mon, _id: "x", dayOfWeek: 2, status: "Inactive" }];
  assert.equal(a.findWindowForDate(ws, "2026-11-16")._id, "m"); // earliest on Monday
  assert.equal(a.findWindowForDate(ws, "2026-11-16", "14:30")._id, "m2");
  assert.equal(a.findWindowForDate(ws, "2026-11-16", "12:00"), undefined); // end exclusive
  assert.equal(a.findWindowForDate(ws, "2026-11-16", "10:00")._id, "m"); // start inclusive
  assert.equal(a.findWindowForDate(ws, "2026-11-17"), undefined); // inactive Tuesday
  assert.equal(a.findWindowForDate(ws, "2026-11-18"), undefined); // no Wednesday
  assert.equal(a.findWindowForDate([{ startTime: "10:00", endTime: "12:00" }], "2026-11-16"), undefined); // legacy
});

test("upcomingDates lists only matching weekdays within range and hides ended windows today", () => {
  // Fixed local "now": Monday 2026-11-16 13:00 -> Monday 10-12 window already ended.
  const now = new Date(2026, 10, 16, 13, 0, 0);
  const dates = a.upcomingDates([mon, monPm], { days: 7, now });
  assert.deepEqual(
    dates.map((d) => `${d.date} ${d.window.startTime}`),
    ["2026-11-16 14:00", "2026-11-23 10:00", "2026-11-23 14:00"]
  );
  assert.deepEqual(a.upcomingDates([], { days: 30, now }), []);
});

test("countInWindow / remainingFor handle caps and unlimited", () => {
  const day = [mon, monPm];
  const appts = [{ time: "10:30" }, { time: "11:00" }, { time: "14:00" }, {}];
  assert.equal(a.countInWindow(mon, appts, day), 3); // 2 timed + 1 untimed (first window)
  assert.equal(a.countInWindow(monPm, appts, day), 1);
  assert.equal(a.remainingFor(mon, 3), 0);
  assert.equal(a.remainingFor(mon, 1), 1);
  assert.equal(a.remainingFor(monPm, 500), null); // unlimited
});
