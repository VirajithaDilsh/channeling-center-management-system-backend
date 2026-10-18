const svc = require("./reportService");
const { requestForecast } = require("./forecastClient");

// 36 months of actuals plus a validated forecast; shared by the report endpoint and the assistant.
async function buildForecast(horizon) {
  const thisMonth = svc.currentMonthKey();
  const from = svc.shiftMonth(svc.parseMonth(thisMonth), -35);
  const series = svc.fillMonths(
    await svc.monthlySeries(svc.monthRange(from).from, svc.monthRange(thisMonth).to),
    from,
    thisMonth
  );
  const actuals = series.map((s) => ({ month: s.month, value: s.totalRevenue, partial: s.month === thisMonth }));
  const forecast = await requestForecast({
    points: actuals.map(({ month, value }) => ({ month, value })),
    horizon,
    currentMonth: thisMonth,
  });
  return { actuals, forecast };
}

module.exports = { buildForecast };
