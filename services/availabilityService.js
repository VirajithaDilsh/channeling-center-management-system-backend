// Weekly recurring doctor availability.
//
// A "window" is a Schedule document: { dayOfWeek 0-6 (0 = Sunday), startTime,
// endTime ("HH:mm"), maxPatients (null/undefined = unlimited), status }.
// Appointment.date is stored as a Date at UTC midnight of the chosen
// "YYYY-MM-DD", so every weekday calculation here is done in UTC to agree with
// how dates are persisted.

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const isValidTime = (t) => typeof t === "string" && TIME_RE.test(t);
const toMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// Blank / null / undefined => unlimited (null). Otherwise a positive integer.
function normalizeMaxPatients(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

// Returns an error message, or null when the window is acceptable.
function validateWindow({ dayOfWeek, startTime, endTime, maxPatients }) {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return "Day of week must be 0 (Sunday) to 6 (Saturday)";
  if (!isValidTime(startTime) || !isValidTime(endTime)) return "Start and end time must be in HH:mm format";
  if (toMinutes(endTime) <= toMinutes(startTime)) return "End time must be after start time";
  if (Number.isNaN(normalizeMaxPatients(maxPatients))) return "Max patients must be a whole number of at least 1, or left blank for unlimited";
  return null;
}

const overlaps = (a, b) =>
  a.dayOfWeek === b.dayOfWeek &&
  toMinutes(a.startTime) < toMinutes(b.endTime) &&
  toMinutes(b.startTime) < toMinutes(a.endTime);

// "YYYY-MM-DD" (or Date) -> "YYYY-MM-DD" in UTC; null when unparseable.
function toDateKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function weekdayOf(value) {
  const key = toDateKey(value);
  return key ? new Date(`${key}T00:00:00Z`).getUTCDay() : null;
}

// Today as a "YYYY-MM-DD" key in the server's local calendar, since "today"
// for a clinic is the local day, not the UTC day.
function localTodayKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const localMinutes = (now = new Date()) => now.getHours() * 60 + now.getMinutes();

const addDays = (key, n) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

const activeWindows = (windows) => windows.filter((w) => w.dayOfWeek !== undefined && w.dayOfWeek !== null && (w.status || "Active") === "Active");

// Window covering the date's weekday; when `time` is given it must lie inside
// the window (start inclusive, end exclusive). Returns undefined if none.
function findWindowForDate(windows, date, time) {
  const day = weekdayOf(date);
  if (day === null) return undefined;
  const candidates = activeWindows(windows).filter((w) => w.dayOfWeek === day);
  if (!time) return candidates.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))[0];
  if (!isValidTime(time)) return undefined;
  const t = toMinutes(time);
  return candidates.find((w) => t >= toMinutes(w.startTime) && t < toMinutes(w.endTime));
}

// Bookable [{ date, window }] from today through today + days, skipping
// windows that have already ended today.
function upcomingDates(windows, { days, now = new Date() }) {
  const today = localTodayKey(now);
  const nowMin = localMinutes(now);
  const usable = activeWindows(windows);
  const out = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const day = weekdayOf(date);
    usable
      .filter((w) => w.dayOfWeek === day)
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
      .forEach((w) => {
        if (i === 0 && toMinutes(w.endTime) <= nowMin) return;
        out.push({ date, window: w });
      });
  }
  return out;
}

// Number of appointments that fall in `window` given same-day appointments.
// An appointment with no time counts toward the first window of that day.
function countInWindow(window, sameDayAppointments, allWindowsOfDay) {
  const first = [...allWindowsOfDay].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))[0];
  return sameDayAppointments.filter((a) => {
    if (!a.time || !isValidTime(a.time)) return first && String(first._id) === String(window._id);
    const t = toMinutes(a.time);
    return t >= toMinutes(window.startTime) && t < toMinutes(window.endTime);
  }).length;
}

const remainingFor = (window, booked) => {
  const max = normalizeMaxPatients(window.maxPatients);
  return max === null || Number.isNaN(max) ? null : Math.max(0, max - booked);
};

module.exports = {
  WEEKDAY_NAMES,
  isValidTime,
  toMinutes,
  normalizeMaxPatients,
  validateWindow,
  overlaps,
  toDateKey,
  weekdayOf,
  localTodayKey,
  localMinutes,
  addDays,
  activeWindows,
  findWindowForDate,
  upcomingDates,
  countInWindow,
  remainingFor,
};
