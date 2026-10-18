// Deterministic, fact-only answers. These are the source of truth; the language
// model may rephrase them but its numbers are checked against these facts.
const lkr = (n) => `LKR ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pretty = (p) => (/^\d{4}-\d{2}$/.test(p) ? `${MONTH_NAMES[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : p);
const partialNote = (d) => (d.partial ? " (month still in progress, so this figure is incomplete)" : "");
const sign = (n) => (n > 0 ? "+" : n < 0 ? "-" : "") + lkr(Math.abs(n));
const visits = (n) => `${n} visit${n === 1 ? "" : "s"}`;
const pct = (n) => (n === null || n === undefined ? "n/a (no revenue in the base month)" : `${n > 0 ? "+" : ""}${n}%`);

const SUPPORTED = [
  "What is our total revenue this month?",
  "How much revenue did we generate last month?",
  "Which doctor generated the highest revenue?",
  "Compare revenue between March and April",
  "What is our total center commission?",
  "How many appointments were successfully paid?",
  "What was our highest-revenue month?",
  "Predict next month's revenue",
  "Why did revenue change compared with the previous month?",
];

function forecastAnswer(f) {
  if (f.status !== "ok") return { kind: "prediction", text: `I can't give a reliable forecast yet. ${f.message}` };
  const v = f.validation;
  const rows = f.forecast.map((x) => `${pretty(x.month)}: ${lkr(x.value)} (likely range ${lkr(x.lower)} to ${lkr(x.upper)})`).join("; ");
  return {
    kind: "prediction",
    text: `Estimate (not actual revenue) — ${rows}. Model: ${f.model.replace(/_/g, " ")}, validated by backtest with an average error of ${lkr(v.mae)} per month (naive baseline ${lkr(v.baselineMae)}).`,
  };
}

const BUILDERS = {
  monthRevenue: (d) => ({ kind: "fact", text: `Total revenue for ${pretty(d.period)} is ${lkr(d.totalRevenue)} from ${d.paidSessions} fully paid visit(s)${partialNote(d)}. That is ${lkr(d.doctorFees)} in doctor fees, ${lkr(d.centerFees)} in center fees and ${lkr(d.medication)} in medication.` }),
  compareMonths: (d) => ({ kind: "fact", text: `${pretty(d.monthA.period)}: ${lkr(d.monthA.totalRevenue)} (${visits(d.monthA.paidSessions)}). ${pretty(d.monthB.period)}: ${lkr(d.monthB.totalRevenue)} (${visits(d.monthB.paidSessions)}). Difference: ${sign(d.change.revenue)} (${pct(d.change.revenuePct)}).` }),
  topDoctor: (d) => (d.top
    ? { kind: "fact", text: `${d.top.doctorName} generated the most revenue in ${pretty(d.period)}: ${lkr(d.top.totalRevenue)} from ${d.top.paidSessions} visit(s).` }
    : { kind: "fact", text: `There is no paid revenue recorded for ${pretty(d.period)} yet.` }),
  centerCommission: (d) => ({ kind: "fact", text: `Center commission (center fees plus medication) for ${pretty(d.period)} is ${lkr(d.centerCommission)}: ${lkr(d.centerFees)} center fees and ${lkr(d.medication)} medication.` }),
  paidAppointmentCount: (d) => ({ kind: "fact", text: `${d.paidSessions} visit(s) were fully paid in ${pretty(d.period)}.` }),
  bestMonth: (d) => (d.best
    ? { kind: "fact", text: `Your highest-revenue month is ${pretty(d.best.month)} with ${lkr(d.best.totalRevenue)} from ${d.best.paidSessions} visit(s), out of ${d.monthsConsidered} month(s) with paid revenue.` }
    : { kind: "fact", text: "There is no paid revenue on record yet." }),
  forecast: forecastAnswer,
  explainChange: (d) => {
    const c = d.change;
    const dir = c.revenue < 0 ? "decreased" : c.revenue > 0 ? "increased" : "did not change";
    const types = d.byType.filter((x) => x.change !== 0).map((x) => `${x.type.replace(/([A-Z])/g, " $1").toLowerCase()} ${sign(x.change)}`).join(", ");
    const drivers = d.doctorDrivers.filter((x) => x.change !== 0).map((x) => `${x.doctorName} ${sign(x.change)}`).join(", ");
    const avg = d.avgPerVisit;
    return {
      kind: "fact",
      text: `Revenue ${dir} from ${lkr(d.previous.totalRevenue)} in ${pretty(d.previous.period)} to ${lkr(d.month.totalRevenue)} in ${pretty(d.month.period)} (${sign(c.revenue)}, ${pct(c.revenuePct)})${partialNote(d.month)}. Paid visits went from ${d.previous.paidSessions} to ${d.month.paidSessions}${avg.month !== null && avg.previous !== null ? `, and average revenue per visit from ${lkr(avg.previous)} to ${lkr(avg.month)}` : ""}.${types ? ` By component: ${types}.` : ""}${drivers ? ` Biggest doctor changes: ${drivers}.` : ""} These are the measurable differences; the data cannot tell me the underlying reasons.`,
    };
  },
};

function buildAnswer(tool, data) {
  return BUILDERS[tool](data);
}

module.exports = { buildAnswer, SUPPORTED, lkr };
