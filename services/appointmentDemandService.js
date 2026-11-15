const Appointment = require("../models/Appointment");
const Doctor = require("../models/Doctor");
const Schedule = require("../models/Schedule");
const { requestAppointmentDemandForecast } = require("./forecastClient");
const {
  formatColomboYmd,
  getColomboDateParts,
  getColomboTodayStartUtc,
} = require("./expiryAlertService");

const MS_PER_DAY = 86400000;
const DEFAULT_HISTORY_DAYS = 90;
const NET_DEMAND_STATUSES = new Set(["Scheduled", "Completed"]);

function addDaysYmd(ymd, offsetDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function buildColomboDemandWindow(windowDays = DEFAULT_HISTORY_DAYS, horizonDays = 7, now = new Date()) {
  const todayStartUtc = getColomboTodayStartUtc(now);
  const windowStartUtc = new Date(todayStartUtc.getTime() - windowDays * MS_PER_DAY);
  const horizonEndUtc = new Date(todayStartUtc.getTime() + horizonDays * MS_PER_DAY);
  const asOfDate = formatColomboYmd(todayStartUtc);
  const todayParts = getColomboDateParts(now);

  const historicalDates = [];
  for (let offset = windowDays; offset >= 1; offset -= 1) {
    const d = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day - offset));
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    historicalDates.push(`${yy}-${mm}-${dd}`);
  }

  const futureDates = [];
  for (let offset = 0; offset < horizonDays; offset += 1) {
    futureDates.push(addDaysYmd(asOfDate, offset));
  }

  return { asOfDate, todayStartUtc, windowStartUtc, horizonEndUtc, historicalDates, futureDates };
}

/**
 * Aggregates historical net appointment demand (Scheduled + Completed, excluding
 * Cancelled) and future confirmed bookings (Scheduled/Completed) separately
 * in Asia/Colombo calendar dates, without modifying any database records.
 */
function aggregateDoctorAppointments({
  appointments = [],
  windowDays = DEFAULT_HISTORY_DAYS,
  horizonDays = 7,
  now = new Date(),
}) {
  const {
    asOfDate,
    todayStartUtc,
    windowStartUtc,
    horizonEndUtc,
    historicalDates,
    futureDates,
  } = buildColomboDemandWindow(windowDays, horizonDays, now);

  const histMap = new Map(historicalDates.map((d) => [d, 0]));
  const futureMap = new Map(futureDates.map((d) => [d, 0]));
  let cancelledExcludedCount = 0;

  for (const appt of appointments) {
    if (!appt || !appt.date) continue;
    const dt = appt.date instanceof Date ? appt.date : new Date(appt.date);
    if (Number.isNaN(dt.getTime())) continue;
    if (dt < windowStartUtc || dt >= horizonEndUtc) continue;

    if (appt.status === "Cancelled") {
      cancelledExcludedCount += 1;
      continue;
    }
    if (!NET_DEMAND_STATUSES.has(appt.status)) continue;

    const ymd = formatColomboYmd(dt);
    if (!ymd) continue;

    if (dt < todayStartUtc && histMap.has(ymd)) {
      histMap.set(ymd, histMap.get(ymd) + 1);
    } else if (dt >= todayStartUtc && futureMap.has(ymd)) {
      futureMap.set(ymd, futureMap.get(ymd) + 1);
    }
  }

  const history = historicalDates.map((date) => ({ date, count: histMap.get(date) || 0 }));
  const futureBookedByDate = futureMap;

  return {
    asOfDate,
    history,
    futureBookedByDate,
    cancelledExcludedCount,
  };
}

/**
 * Combines ML/baseline daily predictions with future confirmed bookings and
 * current schedule capacity without double-counting existing appointments.
 */
function mergeForecastWithFutureBookings({
  mlResponse,
  futureDates,
  futureBookedByDate,
  doctorStatus,
  activeSchedules = [],
}) {
  const byDatePred = new Map(
    (mlResponse?.dailyPredictions || []).map((p) => [p.date, p])
  );

  // Map weekday (0=Sun..6=Sat) -> { isScheduledAvailable, maxPatients }
  const weekdayMap = new Map();
  for (const w of activeSchedules) {
    if (w.dayOfWeek === undefined || w.dayOfWeek === null) continue;
    const prev = weekdayMap.get(w.dayOfWeek) || { isScheduledAvailable: true, maxPatients: 0, hasUnlimited: false };
    if (w.maxPatients === null || w.maxPatients === undefined) {
      prev.hasUnlimited = true;
    } else {
      prev.maxPatients += Number(w.maxPatients) || 0;
    }
    weekdayMap.set(w.dayOfWeek, prev);
  }

  const isOnLeave = doctorStatus === "On Leave";
  const predictionOk = mlResponse?.predictionStatus === "ok";

  const dailyForecast = futureDates.map((date) => {
    const pred = byDatePred.get(date);
    const rawPredictedDemand = predictionOk
      ? Math.max(0, Math.round(Number(pred?.rawPredictedDemand ?? 0)))
      : 0;
    const alreadyBooked = Math.max(0, Number(futureBookedByDate.get(date) || 0));
    const expectedTotalAppointments = Math.max(rawPredictedDemand, alreadyBooked);
    const remainingExpectedBookings = Math.max(0, expectedTotalAppointments - alreadyBooked);

    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    const sched = weekdayMap.get(wd);
    const isScheduledAvailable = !isOnLeave && Boolean(sched?.isScheduledAvailable);
    const scheduledCapacity = isScheduledAvailable
      ? (sched.hasUnlimited ? null : sched.maxPatients)
      : 0;

    return {
      date,
      rawPredictedDemand,
      alreadyBooked,
      expectedTotalAppointments,
      remainingExpectedBookings,
      isScheduledAvailable,
      scheduledCapacity,
    };
  });

  const rawPredictedTotalDemand = dailyForecast.reduce((s, d) => s + d.rawPredictedDemand, 0);
  const expectedTotalAppointments = dailyForecast.reduce((s, d) => s + d.expectedTotalAppointments, 0);
  const alreadyBookedTotal = dailyForecast.reduce((s, d) => s + d.alreadyBooked, 0);
  const remainingExpectedBookingsTotal = dailyForecast.reduce((s, d) => s + d.remainingExpectedBookings, 0);
  const horizonDays = futureDates.length || 1;
  const averagePredictedPerDay = Math.round((expectedTotalAppointments / horizonDays) * 10) / 10;

  let peakDemandDay = null;
  if (predictionOk && dailyForecast.length > 0) {
    peakDemandDay = dailyForecast.reduce(
      (best, cur) => (cur.expectedTotalAppointments > best.expectedTotalAppointments ? cur : best),
      dailyForecast[0]
    );
  }

  return {
    dailyForecast,
    summary: {
      rawPredictedTotalDemand,
      expectedTotalAppointments,
      alreadyBookedTotal,
      remainingExpectedBookingsTotal,
      averagePredictedPerDay,
      peakDemandDay,
    },
  };
}

async function getDoctorDemandForecast({
  doctorId,
  horizonDays = 7,
  windowDays = DEFAULT_HISTORY_DAYS,
  now = new Date(),
}) {
  const doctor = await Doctor.findById(doctorId, "_id name specialization status").lean();
  if (!doctor) {
    const err = new Error("Doctor not found");
    err.status = 404;
    throw err;
  }

  const { asOfDate, windowStartUtc, horizonEndUtc, futureDates } = buildColomboDemandWindow(
    windowDays,
    horizonDays,
    now
  );

  const [appointments, activeSchedules] = await Promise.all([
    Appointment.find(
      {
        doctorId: doctor._id,
        date: { $gte: windowStartUtc, $lt: horizonEndUtc },
      },
      "date status"
    ).lean(),
    Schedule.find(
      {
        doctorId: doctor._id,
        dayOfWeek: { $ne: null },
        status: "Active",
      },
      "dayOfWeek maxPatients status"
    ).lean(),
  ]);

  const { history, futureBookedByDate, cancelledExcludedCount } = aggregateDoctorAppointments({
    appointments,
    windowDays,
    horizonDays,
    now,
  });

  const mlResponse = await requestAppointmentDemandForecast({
    doctorId: String(doctor._id),
    horizonDays,
    windowDays,
    asOfDate,
    history,
  });

  if (!mlResponse || typeof mlResponse !== "object" || !Array.isArray(mlResponse.dailyPredictions)) {
    const err = new Error("Invalid response from appointment demand forecasting service");
    err.status = 502;
    throw err;
  }

  const { dailyForecast, summary } = mergeForecastWithFutureBookings({
    mlResponse,
    futureDates,
    futureBookedByDate,
    doctorStatus: doctor.status,
    activeSchedules,
  });

  return {
    doctor: {
      _id: String(doctor._id),
      name: doctor.name,
      specialization: doctor.specialization,
      status: doctor.status,
    },
    asOfDate: mlResponse.asOfDate || asOfDate,
    horizonDays,
    windowDays,
    demandDefinition: "net_appointment_demand",
    demandDefinitionLabel: "Net appointment demand (Scheduled + Completed, excluding Cancelled)",
    historicalAvailabilityStatus: mlResponse.historicalAvailabilityStatus || "unknown",
    planningNote:
      "Expected total appointments = max(raw predicted demand, already booked) per day as a planning estimate; existing bookings are never double-counted.",
    predictionStatus: mlResponse.predictionStatus,
    modelUsed: mlResponse.modelUsed,
    modelLabel: mlResponse.modelLabel,
    roundingMethod: mlResponse.roundingMethod || "round_non_negative_int",
    validation: mlResponse.validation || null,
    message: mlResponse.message || null,
    dataQuality: {
      ...(mlResponse.dataQuality || {}),
      cancelledExcludedCount,
    },
    summary,
    dailyForecast,
  };
}

module.exports = {
  buildColomboDemandWindow,
  aggregateDoctorAppointments,
  mergeForecastWithFutureBookings,
  getDoctorDemandForecast,
};

