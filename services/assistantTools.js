// The ONLY operations the assistant can perform. Each tool validates its own
// params, is read-only, and returns aggregate figures (no patient data).
const svc = require("./reportService");
const { buildForecast } = require("./forecastService");

const mkMonth = (v, name) => {
  const { year, month } = svc.parseMonth(v, name);
  return svc.monthKey(year, month);
};
const optPeriod = (p) => {
  if (p.month) return { month: mkMonth(p.month, "month") };
  if (p.year) return { year: String(svc.parseYear(p.year)) };
  return { month: svc.currentMonthKey() };
};
const rangeOf = (p) => (p.year ? svc.yearRange(Number(p.year)) : svc.monthRange(p.month));
const label = (p) => p.year || p.month;
const prevMonth = (key) => svc.shiftMonth(svc.parseMonth(key), -1);

const TOOLS = {
  monthRevenue: {
    description: "Total revenue for one month (default: this month) or one year",
    validate: optPeriod,
    run: async (p) => ({ period: label(p), partial: p.month === svc.currentMonthKey(), ...(await svc.periodTotals(rangeOf(p).from, rangeOf(p).to)) }),
  },
  compareMonths: {
    description: "Compare revenue between two months (monthA vs monthB)",
    validate: (p) => ({ monthA: mkMonth(p.monthA, "monthA"), monthB: mkMonth(p.monthB, "monthB") }),
    run: async (p) => {
      const a = svc.monthRange(p.monthA), b = svc.monthRange(p.monthB);
      const [ta, tb] = await Promise.all([svc.periodTotals(a.from, a.to), svc.periodTotals(b.from, b.to)]);
      return { monthA: { period: p.monthA, ...ta }, monthB: { period: p.monthB, ...tb },
        change: svc.changeOf(ta, tb) };
    },
  },
  topDoctor: {
    description: "Doctor who generated the most revenue in a month or year (default: this month)",
    validate: optPeriod,
    run: async (p) => {
      const doctors = await svc.byDoctor(rangeOf(p).from, rangeOf(p).to);
      return { period: label(p), top: doctors[0] || null, doctors: doctors.slice(0, 5) };
    },
  },
  centerCommission: {
    description: "Center commission (center fee + medication) for a month or year (default: this month)",
    validate: optPeriod,
    run: async (p) => ({ period: label(p), ...(await svc.periodTotals(rangeOf(p).from, rangeOf(p).to)) }),
  },
  paidAppointmentCount: {
    description: "Number of fully paid visits in a month or year (default: this month)",
    validate: optPeriod,
    run: async (p) => ({ period: label(p), ...(await svc.periodTotals(rangeOf(p).from, rangeOf(p).to)) }),
  },
  bestMonth: {
    description: "Highest-revenue month on record (last 60 months)",
    validate: () => ({}),
    run: async () => {
      const to = svc.currentMonthKey();
      const from = svc.shiftMonth(svc.parseMonth(to), -59);
      const series = (await svc.monthlySeries(svc.monthRange(from).from, svc.monthRange(to).to))
        .filter((s) => s.paidSessions > 0);
      const best = series.reduce((a, b) => (!a || b.totalRevenue > a.totalRevenue ? b : a), null);
      return { best, monthsConsidered: series.length };
    },
  },
  forecast: {
    description: "Predict revenue for the next 1 or 3 months",
    validate: (p) => {
      const h = p.horizon === undefined ? 1 : Number(p.horizon);
      if (![1, 3].includes(h)) throw new svc.ReportError("horizon must be 1 or 3");
      return { horizon: h };
    },
    run: async (p) => (await buildForecast(p.horizon)).forecast,
  },
  explainChange: {
    description: "Explain why revenue changed in a month versus the month before it (default: this month)",
    validate: (p) => ({ month: p.month ? mkMonth(p.month, "month") : svc.currentMonthKey() }),
    run: async (p) => {
      const prev = prevMonth(p.month);
      const a = svc.monthRange(p.month), b = svc.monthRange(prev);
      const [ta, tb, da, db] = await Promise.all([
        svc.periodTotals(a.from, a.to), svc.periodTotals(b.from, b.to),
        svc.byDoctor(a.from, a.to), svc.byDoctor(b.from, b.to),
      ]);
      const prevByDoc = new Map(db.map((d) => [d.doctorName, d.totalRevenue]));
      const drivers = da.map((d) => ({ doctorName: d.doctorName, change: Math.round((d.totalRevenue - (prevByDoc.get(d.doctorName) || 0)) * 100) / 100 }));
      for (const d of db) if (!da.find((x) => x.doctorName === d.doctorName)) drivers.push({ doctorName: d.doctorName, change: -d.totalRevenue });
      drivers.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
      const avg = (t) => (t.paidSessions ? Math.round((t.totalRevenue / t.paidSessions) * 100) / 100 : null);
      return {
        month: { period: p.month, partial: p.month === svc.currentMonthKey(), ...ta },
        previous: { period: prev, ...tb },
        change: svc.changeOf(ta, tb),
        byType: ["doctorFees", "centerFees", "medication", "adjustments"].map((k) => ({ type: k, change: Math.round((ta[k] - tb[k]) * 100) / 100 })),
        avgPerVisit: { month: avg(ta), previous: avg(tb) },
        doctorDrivers: drivers.slice(0, 3),
      };
    },
  },
};

module.exports = { TOOLS };
