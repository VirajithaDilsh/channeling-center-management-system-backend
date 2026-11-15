const { test } = require("node:test");
const assert = require("node:assert");

const {
  buildColomboDemandWindow,
  aggregateDoctorAppointments,
  mergeForecastWithFutureBookings,
} = require("../services/appointmentDemandService");
const appointmentDemandService = require("../services/appointmentDemandService");
const { getAppointmentDemandForecast } = require("../controllers/appointmentController");
const { ForecastUnavailable } = require("../services/forecastClient");
const Admin = require("../models/Admin");
const Doctor = require("../models/Doctor");
const appointmentRoutes = require("../routes/appointmentRoutes");

test("buildColomboDemandWindow uses 90 complete Asia/Colombo days excluding today", () => {
  // 2026-11-15 01:00+05:30 = 2026-11-14T19:30:00.000Z
  const now = new Date("2026-11-14T19:30:00.000Z");
  const { asOfDate, historicalDates, futureDates } = buildColomboDemandWindow(90, 7, now);
  assert.strictEqual(asOfDate, "2026-11-15");
  assert.strictEqual(historicalDates.length, 90);
  assert.strictEqual(historicalDates[89], "2026-11-14");
  assert.strictEqual(futureDates.length, 7);
  assert.strictEqual(futureDates[0], "2026-11-15");
  assert.strictEqual(futureDates[6], "2026-11-21");
});

test("aggregateDoctorAppointments counts Scheduled+Completed, excludes Cancelled, fills zeros, separates future", () => {
  const now = new Date("2026-11-15T10:00:00+05:30");
  const appointments = [
    { date: new Date("2026-11-13T00:00:00.000Z"), status: "Completed" },
    { date: new Date("2026-11-13T00:00:00.000Z"), status: "Scheduled" },
    { date: new Date("2026-11-13T00:00:00.000Z"), status: "Cancelled" }, // excluded
    { date: new Date("2026-11-15T00:00:00.000Z"), status: "Scheduled" }, // today -> future
    { date: new Date("2026-11-16T00:00:00.000Z"), status: "Scheduled" }, // future
    { date: new Date("2026-11-16T00:00:00.000Z"), status: "Cancelled" }, // excluded
  ];

  const { history, futureBookedByDate, cancelledExcludedCount } = aggregateDoctorAppointments({
    appointments,
    windowDays: 90,
    horizonDays: 7,
    now,
  });

  assert.strictEqual(cancelledExcludedCount, 2);
  assert.strictEqual(history.length, 90);
  assert.strictEqual(history.find((d) => d.date === "2026-11-13").count, 2);
  assert.strictEqual(history.find((d) => d.date === "2026-11-12").count, 0);
  assert.strictEqual(futureBookedByDate.get("2026-11-15"), 1);
  assert.strictEqual(futureBookedByDate.get("2026-11-16"), 1);
  assert.strictEqual(futureBookedByDate.get("2026-11-17"), 0);
});

test("mergeForecastWithFutureBookings computes max(raw, booked) and non-negative remaining without double counting", () => {
  const futureDates = ["2026-11-15", "2026-11-16"];
  const futureBookedByDate = new Map([
    ["2026-11-15", 8], // alreadyBooked > rawPredictedDemand (5)
    ["2026-11-16", 2], // alreadyBooked < rawPredictedDemand (6)
  ]);

  const { dailyForecast, summary } = mergeForecastWithFutureBookings({
    mlResponse: {
      predictionStatus: "ok",
      dailyPredictions: [
        { date: "2026-11-15", rawPredictedDemand: 5 },
        { date: "2026-11-16", rawPredictedDemand: 6 },
      ],
    },
    futureDates,
    futureBookedByDate,
    doctorStatus: "Available",
    activeSchedules: [{ dayOfWeek: 0, maxPatients: 10 }, { dayOfWeek: 1, maxPatients: null }],
  });

  assert.strictEqual(dailyForecast[0].expectedTotalAppointments, 8);
  assert.strictEqual(dailyForecast[0].remainingExpectedBookings, 0);
  assert.strictEqual(dailyForecast[1].expectedTotalAppointments, 6);
  assert.strictEqual(dailyForecast[1].remainingExpectedBookings, 4);
  assert.strictEqual(summary.expectedTotalAppointments, 14);
  assert.strictEqual(summary.alreadyBookedTotal, 10);
  assert.strictEqual(summary.remainingExpectedBookingsTotal, 4);
});

test("getAppointmentDemandForecast validates doctorId and horizonDays and handles 503", async (t) => {
  const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  });

  const resBadId = makeRes();
  await getAppointmentDemandForecast({ query: { doctorId: "bad-id", horizonDays: "7" }, user: { permissions: ["appointments_read"] } }, resBadId);
  assert.strictEqual(resBadId.statusCode, 400);

  const resBadHorizon = makeRes();
  await getAppointmentDemandForecast({ query: { doctorId: "507f1f77bcf86cd799439011", horizonDays: "30" }, user: { permissions: ["appointments_read"] } }, resBadHorizon);
  assert.strictEqual(resBadHorizon.statusCode, 400);

  t.mock.method(appointmentDemandService, "getDoctorDemandForecast", async () => {
    throw new ForecastUnavailable("Forecast service is unreachable");
  });
  const res503 = makeRes();
  await getAppointmentDemandForecast({ query: { doctorId: "507f1f77bcf86cd799439011", horizonDays: "14" }, user: { permissions: ["appointments_read"] } }, res503);
  assert.strictEqual(res503.statusCode, 503);
});

test("doctor-only account without appointments_read cannot query another doctor's forecast", async (t) => {
  t.mock.method(Admin, "findById", async () => ({ _id: "507f1f77bcf86cd799439099", doctorId: "507f1f77bcf86cd799439022" }));
  t.mock.method(Doctor, "findById", async () => ({ _id: "507f1f77bcf86cd799439022", name: "Dr. Other" }));
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
  await getAppointmentDemandForecast(
    {
      query: { doctorId: "507f1f77bcf86cd799439011", horizonDays: "7" },
      user: { id: "507f1f77bcf86cd799439099", permissions: ["doctor_portal"] },
    },
    res
  );
  assert.strictEqual(res.statusCode, 403);
});

test("appointmentRoutes registers /demand-forecast before /:id", () => {
  const stack = appointmentRoutes.stack.filter((layer) => layer.route);
  const paths = stack.map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  const demandIdx = paths.indexOf("GET /demand-forecast");
  const idIdx = paths.indexOf("GET /:id");
  assert.ok(demandIdx !== -1, "GET /demand-forecast must exist");
  assert.ok(demandIdx < idIdx, "GET /demand-forecast must be registered before GET /:id");
});
