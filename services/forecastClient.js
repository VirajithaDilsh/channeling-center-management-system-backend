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

const WAKE_MS = Number(process.env.FORECAST_WAKE_MS) || 60000;
const RETRY_STATUSES = new Set([502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Free hosts (Render) sleep when idle and answer 502/503 while waking. Retry
// those (and network errors/timeouts) until the wake deadline instead of
// failing on the first attempt.
async function requestForecast({ points, horizon, currentMonth }) {
  const base = process.env.FORECAST_SERVICE_URL;
  if (!base) throw new ForecastUnavailable("Forecast service is not configured");
  const url = `${base.replace(/\/$/, "")}/forecast`;
  const deadline = Date.now() + WAKE_MS;
  let lastMessage = "Forecast service is unreachable";

  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": process.env.FORECAST_SERVICE_KEY || "" },
        body: JSON.stringify({ points, horizon, currentMonth }),
        signal: ctrl.signal,
      });
      if (res.ok) return await res.json();
      if (!RETRY_STATUSES.has(res.status)) throw new ForecastUnavailable(`Forecast service returned ${res.status}`);
      lastMessage = `Forecast service returned ${res.status}`;
    } catch (err) {
      if (err instanceof ForecastUnavailable) throw err;
      lastMessage = err.name === "AbortError" ? "Forecast service timed out" : "Forecast service is unreachable";
    } finally {
      clearTimeout(timer);
    }
    const delay = Math.min(3000 * (attempt + 1), 10000);
    if (Date.now() + delay >= deadline) {
      throw new ForecastUnavailable(`${lastMessage} (it may still be waking up; try again in a minute)`);
    }
    await sleep(delay);
  }
}

// Fire-and-forget ping so a sleeping service starts waking before it's needed.
function wakeForecastService() {
  const base = process.env.FORECAST_SERVICE_URL;
  if (!base) return;
  fetch(`${base.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}

module.exports = { requestForecast, wakeForecastService, ForecastUnavailable };
