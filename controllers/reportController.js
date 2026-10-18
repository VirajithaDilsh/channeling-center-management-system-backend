const svc = require("../services/reportService");
const { ForecastUnavailable } = require("../services/forecastClient");
const { buildForecast } = require("../services/forecastService");

function handle(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof ForecastUnavailable) return res.status(503).json({ message: err.message });
      if (err instanceof svc.ReportError) return res.status(err.status).json({ message: err.message });
      console.error("Report error:", err);
      res.status(500).json({ message: "Failed to build report" });
    }
  };
}

const meta = () => ({
  timezone: svc.TZ,
  basis: "Closed (fully paid) visit sessions, dated by the time they were closed",
  centerCommission: svc.CENTER_COMMISSION_TYPES.join(" + "),
  refundsTracked: false,
});

// Resolve ?month=YYYY-MM or ?year=YYYY into a range; defaults to current month.
function resolvePeriod(q) {
  if (q.year && !q.month) {
    const y = svc.parseYear(q.year);
    return { label: String(y), ...svc.yearRange(y) };
  }
  const key = q.month || svc.currentMonthKey();
  return { label: key, ...svc.monthRange(key) };
}

exports.summary = handle(async (req) => {
  const now = new Date();
  const thisMonth = svc.currentMonthKey(now);
  const year = req.query.year ? svc.parseYear(req.query.year) : Number(thisMonth.slice(0, 4));
  const [month, yearTotals, out] = await Promise.all([
    svc.periodTotals(...Object.values(svc.monthRange(thisMonth))),
    svc.periodTotals(...Object.values(svc.yearRange(year))),
    svc.outstanding(),
  ]);
  return { meta: meta(), currentMonth: { period: thisMonth, partial: true, ...month }, year: { period: String(year), ...yearTotals }, outstanding: out };
});

exports.monthly = handle(async (req) => {
  const thisMonth = svc.currentMonthKey();
  const to = req.query.to || thisMonth;
  const toP = svc.parseMonth(to, "to");
  const from = req.query.from || svc.shiftMonth(toP, -11); // default: 12 months ending at `to`
  const fromP = svc.parseMonth(from, "from");
  if (svc.monthKey(fromP.year, fromP.month) > svc.monthKey(toP.year, toP.month)) {
    return Promise.reject(new svc.ReportError("from must not be after to"));
  }
  if ((toP.year - fromP.year) * 12 + toP.month - fromP.month > 60) {
    return Promise.reject(new svc.ReportError("range is limited to 61 months"));
  }
  const range = { from: svc.monthRange(from).from, to: svc.monthRange(to).to };
  const series = svc.fillMonths(await svc.monthlySeries(range.from, range.to), from, to);
  return { meta: meta(), currentMonth: thisMonth, series: series.map((s) => ({ ...s, partial: s.month === thisMonth })) };
});

exports.byDoctor = handle(async (req) => {
  const p = resolvePeriod(req.query);
  return { meta: meta(), period: p.label, doctors: await svc.byDoctor(p.from, p.to) };
});

exports.compare = handle(async (req) => {
  const a = svc.monthRange(req.query.monthA);
  const b = svc.monthRange(req.query.monthB);
  const [ta, tb] = await Promise.all([svc.periodTotals(a.from, a.to), svc.periodTotals(b.from, b.to)]);
  const pct = (x, y) => (y ? Math.round(((x - y) / y) * 10000) / 100 : null);
  return {
    meta: meta(),
    monthA: { period: req.query.monthA, ...ta },
    monthB: { period: req.query.monthB, ...tb },
    change: {
      revenue: Math.round((ta.totalRevenue - tb.totalRevenue) * 100) / 100,
      revenuePct: pct(ta.totalRevenue, tb.totalRevenue),
      paidSessions: ta.paidSessions - tb.paidSessions,
    },
  };
});

// Actual history (36 months) plus a validated forecast. Actuals are always
// returned; `forecast` is null with a reason when the service can't answer.
exports.forecast = handle(async (req) => {
  const horizon = req.query.horizon === undefined ? 1 : Number(req.query.horizon);
  if (![1, 3].includes(horizon)) throw new svc.ReportError("horizon must be 1 or 3");
  const { actuals, forecast } = await buildForecast(horizon);
  return { meta: { ...meta(), estimate: true }, actuals, forecast };
});
