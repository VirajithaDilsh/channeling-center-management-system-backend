const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const realFetch = global.fetch;
beforeEach(() => {
  process.env.FORECAST_SERVICE_URL = "http://forecast.test";
  process.env.FORECAST_WAKE_MS = "120000";
  delete require.cache[require.resolve("../services/forecastClient")];
});
afterEach(() => { global.fetch = realFetch; });

test("retries 502 while the service wakes, then succeeds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const codes = [502, 502, 200];
  let calls = 0;
  global.fetch = async () => {
    const code = codes[calls++];
    return { ok: code === 200, status: code, json: async () => ({ status: "ok" }) };
  };
  const { requestForecast } = require("../services/forecastClient");
  const p = requestForecast({ points: [], horizon: 1, currentMonth: "2026-01" });
  for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); t.mock.timers.tick(10000); }
  assert.deepStrictEqual(await p, { status: "ok" });
  assert.strictEqual(calls, 3);
});

test("non-retryable status fails immediately", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 401 }; };
  const { requestForecast, ForecastUnavailable } = require("../services/forecastClient");
  await assert.rejects(requestForecast({ points: [], horizon: 1, currentMonth: "x" }), ForecastUnavailable);
  assert.strictEqual(calls, 1);
});

test("checkForecastHealth: healthy when /health answers 200", async () => {
  let url;
  global.fetch = async (u) => { url = u; return { ok: true, status: 200 }; };
  const { checkForecastHealth } = require("../services/forecastClient");
  assert.deepStrictEqual(await checkForecastHealth(), { healthy: true });
  assert.strictEqual(url, "http://forecast.test/health");
});

test("checkForecastHealth: 503 or network error means not healthy yet", async () => {
  const { checkForecastHealth } = require("../services/forecastClient");
  global.fetch = async () => ({ ok: false, status: 503 });
  assert.deepStrictEqual(await checkForecastHealth(), { healthy: false });
  global.fetch = async () => { throw new Error("ECONNREFUSED"); };
  assert.deepStrictEqual(await checkForecastHealth(), { healthy: false });
});

test("checkForecastHealth: throws when URL is not configured", async () => {
  delete process.env.FORECAST_SERVICE_URL;
  const { checkForecastHealth, ForecastUnavailable } = require("../services/forecastClient");
  await assert.rejects(checkForecastHealth(), ForecastUnavailable);
});

test("requestStockoutPredictions posts batched payload to /predict/stockout and retries 503", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const codes = [503, 200];
  let calls = 0;
  let capturedUrl = null;
  global.fetch = async (url) => {
    capturedUrl = url;
    const code = codes[calls++];
    return { ok: code === 200, status: code, json: async () => ({ predictions: [] }) };
  };
  const { requestStockoutPredictions } = require("../services/forecastClient");
  const p = requestStockoutPredictions({ horizonDays: 14, windowDays: 30, asOfDate: "2026-11-14", medicines: [] });
  for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); t.mock.timers.tick(10000); }
  assert.deepStrictEqual(await p, { predictions: [] });
  assert.strictEqual(calls, 2);
  assert.strictEqual(capturedUrl, "http://forecast.test/predict/stockout");
});