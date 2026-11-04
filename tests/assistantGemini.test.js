const test = require("node:test");
const assert = require("node:assert/strict");
const gemini = require("../services/geminiClient");
const { TOOLS } = require("../services/assistantTools");
const { ForecastUnavailable } = require("../services/forecastClient");
const controller = require("../controllers/assistantController");
const router = require("../routes/assistantRoutes");
const { requirePermission, verifyToken } = require("../middleware/authMiddleware");

const REV = { period: "2026-10", partial: false, totalRevenue: 125000, paidSessions: 4, doctorFees: 100000, centerFees: 1200, medication: 23800 };
const origGenerate = gemini.generate;
const origRun = TOOLS.monthRevenue.run;
const origForecast = TOOLS.forecast.run;
const origKey = process.env.GEMINI_API_KEY;

function setup({ key = "test-key", generate } = {}) {
  if (key) process.env.GEMINI_API_KEY = key; else delete process.env.GEMINI_API_KEY;
  const calls = [];
  gemini.generate = async (args) => { calls.push(args); return generate ? generate(args, calls.length) : null; };
  TOOLS.monthRevenue.run = async () => REV;
  return calls;
}
test.afterEach(() => {
  gemini.generate = origGenerate;
  TOOLS.monthRevenue.run = origRun;
  TOOLS.forecast.run = origForecast;
  if (origKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = origKey;
  gemini._resetForTests();
});

async function ask(message, context) {
  let body, code = 200;
  const res = { status(c) { code = c; return this; }, json(b) { body = b; } };
  await controller.chat({ body: { message, context } }, res);
  return { code, body };
}

test("1/10: rule-based question works with Gemini unconfigured and never calls it", async () => {
  const calls = setup({ key: null });
  const { body } = await ask("What is our total revenue this month?");
  assert.equal(body.tool, "monthRevenue");
  assert.equal(body.source, "rules");
  assert.equal(body.usedLlm, false);
  assert.match(body.answer, /LKR 125,000\.00/);
  assert.equal(calls.length, 0);
});

test("2/3: unmatched question uses Gemini to pick a valid tool; params validated", async () => {
  const calls = setup({ generate: (a) => (a.schema ? JSON.stringify({ tool: "monthRevenue", params: { month: "2026-03", evil: "$where" } }) : null) });
  const { body } = await ask("how did we do money-wise in march");
  assert.equal(body.source, "llm");
  assert.deepEqual(body.params, { month: "2026-03" });
  assert.deepEqual(calls[0].schema.properties.tool.enum.sort(), [...Object.keys(TOOLS), "unsupported"].sort());
});

test("4: invalid tool from Gemini is rejected", async () => {
  setup({ generate: () => JSON.stringify({ tool: "dropDatabase", params: {} }) });
  const { body } = await ask("zzz qqq");
  assert.equal(body.kind, "unsupported");
  const proto = setup({ generate: () => JSON.stringify({ tool: "constructor", params: {} }) });
  assert.equal((await ask("zzz qqq")).body.kind, "unsupported");
  assert.ok(proto.length >= 1);
});

test("4b: invalid params from Gemini are rejected", async () => {
  setup({ generate: () => JSON.stringify({ tool: "monthRevenue", params: { month: "2026-99" } }) });
  assert.equal((await ask("zzz qqq")).body.kind, "unsupported");
});

test("5: malformed JSON from Gemini is rejected safely", async () => {
  setup({ generate: () => "not json {" });
  assert.equal((await ask("zzz qqq")).body.kind, "unsupported");
  setup({ generate: () => "null" });
  assert.equal((await ask("zzz qqq")).body.kind, "unsupported");
});

test("6/10: Gemini unavailable (null): unmatched -> unsupported, rule question still answered deterministically", async () => {
  setup({ generate: () => null });
  assert.equal((await ask("zzz qqq")).body.kind, "unsupported");
  const { body } = await ask("revenue this month");
  assert.equal(body.usedLlm, false);
  assert.match(body.answer, /LKR 125,000\.00/);
});

test("8: rewording succeeds and the prompt never contains the question", async () => {
  const calls = setup({ generate: () => "Good news: LKR 125,000.00 came from 4 visits." });
  const { body } = await ask("revenue this month for patient John Silva");
  assert.equal(body.usedLlm, true);
  assert.equal(body.answer, "Good news: LKR 125,000.00 came from 4 visits.");
  for (const c of calls) assert.ok(!JSON.stringify(c).includes("John Silva"));
});

test("9: invented number is rejected and the deterministic answer is used", async () => {
  setup({ generate: () => "Revenue was LKR 999,999.00." });
  const { body } = await ask("revenue this month");
  assert.equal(body.usedLlm, false);
  assert.match(body.answer, /LKR 125,000\.00/);
});

test("11: follow-up keeps previous context", async () => {
  setup({ key: null });
  const { body } = await ask("what about last month?", { tool: "monthRevenue", params: { month: "2026-10" } });
  assert.equal(body.tool, "monthRevenue");
  assert.match(body.params.month, /^\d{4}-\d{2}$/);
});

test("12: forecast outage is reported without involving Gemini", async () => {
  const calls = setup({ generate: () => "x" });
  TOOLS.forecast.run = async () => { throw new ForecastUnavailable("Forecast service is not configured"); };
  const { body } = await ask("predict next month's revenue");
  assert.equal(body.kind, "prediction");
  assert.match(body.answer, /forecasting service is unavailable/);
  assert.equal(calls.length, 0);
});

test("7: quota exhaustion starts a cooldown with no further SDK calls; status reports it", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  gemini._resetForTests();
  let sdkCalls = 0, probes = 0;
  const quota = Object.assign(new Error("RESOURCE_EXHAUSTED secret-key-123"), { status: 429 });
  gemini._setClientForTests({ models: { generateContent: async () => { sdkCalls++; throw quota; }, get: async () => { probes++; return {}; } } });
  const logs = [];
  const origWarn = console.warn;
  console.warn = (...a) => logs.push(a.join(" "));
  try {
    assert.equal(await gemini.generate({ system: "s", user: "u" }), null);
    assert.equal(await gemini.generate({ system: "s", user: "u" }), null);
    assert.equal(sdkCalls, 1);
    assert.deepEqual(await gemini.status(), { configured: true, status: "quota_exhausted" });
    assert.equal(probes, 0);
    assert.ok(logs.length === 1 && logs.every((l) => !l.includes("secret-key-123") && !l.includes("test-key")));
  } finally {
    console.warn = origWarn;
  }
});

test("status: online after success, cached (no generation call), unavailable after outage", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  gemini._resetForTests();
  let gens = 0, probes = 0;
  gemini._setClientForTests({ models: { generateContent: async () => { gens++; return { text: " hi " }; }, get: async () => { probes++; return {}; } } });
  assert.deepEqual(await gemini.status(), { configured: true, status: "online" });
  assert.deepEqual(await gemini.status(), { configured: true, status: "online" });
  assert.equal(probes, 1);
  assert.equal(gens, 0);
  assert.equal(await gemini.generate({ system: "s", user: "u" }), "hi");
  gemini._resetForTests();
  const origWarn = console.warn; console.warn = () => {};
  gemini._setClientForTests({ models: { generateContent: async () => { throw Object.assign(new Error("boom"), { status: 503 }); }, get: async () => { throw Object.assign(new Error("boom"), { status: 503 }); } } });
  try {
    assert.deepEqual(await gemini.status(), { configured: true, status: "unavailable" });
    assert.equal(await gemini.generate({ system: "s", user: "u" }), null);
  } finally { console.warn = origWarn; }
});

test("status: not configured, and no generation call is ever made", async () => {
  delete process.env.GEMINI_API_KEY;
  gemini._resetForTests();
  let body;
  await controller.status({}, { json: (b) => { body = b; } });
  assert.deepEqual(body, { success: true, provider: "gemini", configured: false, status: "not_configured" });
});

test("13: route is gated by auth, permission and rate limit; permission check works", () => {
  const global = router.stack.filter((l) => !l.route).map((l) => l.handle);
  assert.equal(global[0], verifyToken);
  const chat = router.stack.find((l) => l.route?.path === "/chat");
  assert.equal(chat.route.stack.length, 2, "rateLimit + controller");
  assert.equal(router.stack.filter((l) => !l.route).length, 2, "verifyToken + requirePermission");
  const guard = requirePermission("reports_read", "reports_allow_all");
  const res = { status(c) { this.code = c; return this; }, json() {} };
  let next = 0;
  guard({ user: { permissions: [] } }, res, () => next++);
  assert.equal(res.code, 403);
  guard({ user: { permissions: ["reports_allow_all"] } }, res, () => next++);
  assert.equal(next, 1);
});
