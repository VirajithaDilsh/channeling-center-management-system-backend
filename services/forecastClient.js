// Calls the separate Python forecast service. Everything here is optional: if
// FORECAST_SERVICE_URL is unset or the service is down, only the forecast
// endpoint fails (503); the rest of /api/reports keeps working.
const TIMEOUT_MS = Number(process.env.FORECAST_TIMEOUT_MS) || 20000;

class ForecastUnavailable extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}

async function requestForecast({ points, horizon, currentMonth }) {
  const base = process.env.FORECAST_SERVICE_URL;
  if (!base) throw new ForecastUnavailable("Forecast service is not configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/forecast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": process.env.FORECAST_SERVICE_KEY || "" },
      body: JSON.stringify({ points, horizon, currentMonth }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new ForecastUnavailable(`Forecast service returned ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof ForecastUnavailable) throw err;
    throw new ForecastUnavailable(
      err.name === "AbortError" ? "Forecast service timed out (it may be waking up; try again)" : "Forecast service is unreachable"
    );
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { requestForecast, ForecastUnavailable };
