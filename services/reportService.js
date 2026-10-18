const VisitSession = require("../models/VisitSession");

// Sri Lanka has no DST, so a fixed offset is exact for month boundaries.
const TZ = "Asia/Colombo";
const TZ_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Revenue is recognised when a visit session is CLOSED (fully paid), so line
// items and payments agree and fees can be split by type. Partially paid and
// canceled sessions are excluded. Cancelled-with-payment cannot happen today and
// no refund records exist, so refunds are not representable.
const CENTER_COMMISSION_TYPES = ["CENTER_FEE", "MEDICATION"];

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

class ReportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseMonth(value, name = "month") {
  const m = MONTH_RE.exec(String(value || ""));
  if (!m) throw new ReportError(`${name} must be in YYYY-MM format`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

function parseYear(value) {
  const y = Number(value);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new ReportError("year must be between 2000 and 2100");
  return y;
}

// Instant at which the given Colombo calendar month starts.
function monthStart(year, month) {
  return new Date(Date.UTC(year, month - 1, 1) - TZ_OFFSET_MS);
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function nextMonth({ year, month }) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function shiftMonth({ year, month }, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}

function monthRange(key) {
  const p = parseMonth(key);
  const n = nextMonth(p);
  return { from: monthStart(p.year, p.month), to: monthStart(n.year, n.month) };
}

function yearRange(year) {
  return { from: monthStart(year, 1), to: monthStart(year + 1, 1) };
}

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// Stages shared by every report: closed sessions with a recognised close time.
function closedStages(from, to) {
  return [
    { $match: { status: "CLOSED" } },
    {
      $addFields: {
        closedAt: {
          $ifNull: [
            {
              $max: {
                $map: {
                  input: { $filter: { input: "$statusHistory", cond: { $eq: ["$$this.to", "CLOSED"] } } },
                  in: "$$this.at",
                },
              },
            },
            "$updatedAt",
          ],
        },
      },
    },
    { $match: { closedAt: { $gte: from, $lt: to } } },
  ];
}

function typeTotals(rows) {
  const t = { DOCTOR_FEE: 0, CENTER_FEE: 0, MEDICATION: 0, ADJUSTMENT: 0 };
  for (const r of rows) t[r.type] = round2((t[r.type] || 0) + r.amount);
  return t;
}

function summarise(byType, sessions) {
  const total = round2(Object.values(byType).reduce((s, v) => s + v, 0));
  const centerCommission = round2(CENTER_COMMISSION_TYPES.reduce((s, k) => s + (byType[k] || 0), 0));
  return {
    totalRevenue: total,
    doctorFees: byType.DOCTOR_FEE,
    centerFees: byType.CENTER_FEE,
    medication: byType.MEDICATION,
    adjustments: byType.ADJUSTMENT,
    centerCommission,
    paidSessions: sessions,
  };
}

async function periodTotals(from, to) {
  const [rows, counts] = await Promise.all([
    VisitSession.aggregate([
      ...closedStages(from, to),
      { $unwind: "$lineItems" },
      { $group: { _id: "$lineItems.type", amount: { $sum: "$lineItems.amount" } } },
      { $project: { _id: 0, type: "$_id", amount: 1 } },
    ]),
    VisitSession.aggregate([...closedStages(from, to), { $count: "n" }]),
  ]);
  return summarise(typeTotals(rows), counts[0]?.n || 0);
}

async function monthlySeries(from, to) {
  const rows = await VisitSession.aggregate([
    ...closedStages(from, to),
    { $unwind: "$lineItems" },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: "%Y-%m", date: "$closedAt", timezone: TZ } },
          type: "$lineItems.type",
        },
        amount: { $sum: "$lineItems.amount" },
      },
    },
  ]);
  const counts = await VisitSession.aggregate([
    ...closedStages(from, to),
    { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$closedAt", timezone: TZ } }, n: { $sum: 1 } } },
  ]);
  const byMonth = new Map();
  for (const r of rows) {
    const m = byMonth.get(r._id.month) || [];
    m.push({ type: r._id.type, amount: r.amount });
    byMonth.set(r._id.month, m);
  }
  const countMap = new Map(counts.map((c) => [c._id, c.n]));
  return [...byMonth.keys()].sort().map((month) => ({
    month,
    ...summarise(typeTotals(byMonth.get(month)), countMap.get(month) || 0),
  }));
}

// Same series with months that had no closed sessions filled with zeros, so
// charts and the forecaster see gaps explicitly.
function fillMonths(series, startKey, endKey) {
  const have = new Map(series.map((s) => [s.month, s]));
  const out = [];
  let cur = parseMonth(startKey);
  const end = parseMonth(endKey);
  while (cur.year < end.year || (cur.year === end.year && cur.month <= end.month)) {
    const k = monthKey(cur.year, cur.month);
    out.push(have.get(k) || { month: k, ...summarise(typeTotals([]), 0) });
    cur = nextMonth(cur);
  }
  return out;
}

async function byDoctor(from, to) {
  const rows = await VisitSession.aggregate([
    ...closedStages(from, to),
    { $unwind: "$lineItems" },
    {
      $group: {
        _id: { doctorId: "$doctorId", doctorName: "$doctorName", sessionId: "$_id" },
        total: { $sum: "$lineItems.amount" },
        doctorFee: { $sum: { $cond: [{ $eq: ["$lineItems.type", "DOCTOR_FEE"] }, "$lineItems.amount", 0] } },
        center: { $sum: { $cond: [{ $in: ["$lineItems.type", CENTER_COMMISSION_TYPES] }, "$lineItems.amount", 0] } },
      },
    },
    {
      $group: {
        _id: { doctorId: "$_id.doctorId", doctorName: "$_id.doctorName" },
        totalRevenue: { $sum: "$total" },
        doctorFees: { $sum: "$doctorFee" },
        centerCommission: { $sum: "$center" },
        paidSessions: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);
  return rows.map((r) => ({
    doctorId: r._id.doctorId ? String(r._id.doctorId) : null,
    // Pharmacy walk-ins have no doctor.
    doctorName: r._id.doctorName || "No doctor (pharmacy walk-in)",
    totalRevenue: round2(r.totalRevenue),
    doctorFees: round2(r.doctorFees),
    centerCommission: round2(r.centerCommission),
    paidSessions: r.paidSessions,
  }));
}

// Money sitting in open bills — shown next to revenue so it is never mistaken for it.
async function outstanding() {
  const rows = await VisitSession.aggregate([
    { $match: { status: { $in: ["OPEN", "PENDING_PHARMACY", "READY_FOR_PAYMENT"] } } },
    {
      $group: {
        _id: null,
        billed: { $sum: { $sum: "$lineItems.amount" } },
        paid: { $sum: { $sum: "$payments.amount" } },
        sessions: { $sum: 1 },
      },
    },
  ]);
  const r = rows[0] || { billed: 0, paid: 0, sessions: 0 };
  return { openSessions: r.sessions, unpaidBalance: round2(r.billed - r.paid) };
}

function changeOf(a, b) {
  return {
    revenue: round2(a.totalRevenue - b.totalRevenue),
    revenuePct: b.totalRevenue ? Math.round(((a.totalRevenue - b.totalRevenue) / b.totalRevenue) * 10000) / 100 : null,
    paidSessions: a.paidSessions - b.paidSessions,
  };
}

function currentMonthKey(now = new Date()) {
  const c = new Date(now.getTime() + TZ_OFFSET_MS);
  return monthKey(c.getUTCFullYear(), c.getUTCMonth() + 1);
}

module.exports = {
  TZ,
  CENTER_COMMISSION_TYPES,
  ReportError,
  parseMonth,
  parseYear,
  monthRange,
  yearRange,
  monthKey,
  nextMonth,
  shiftMonth,
  currentMonthKey,
  changeOf,
  fillMonths,
  periodTotals,
  monthlySeries,
  byDoctor,
  outstanding,
};
