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
