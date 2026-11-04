// Google Gemini client (official @google/genai SDK). The API key stays on the
// backend. Every failure resolves to null so the assistant falls back to rules
// and templates rather than erroring. Only the failure kind and HTTP status are
// logged, never the error object, request or key.
const { GoogleGenAI } = require("@google/genai");

const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 10000;
const QUOTA_COOLDOWN_MS = 60000;
const HEALTH_TTL_MS = 5 * 60000;

const isConfigured = () => !!process.env.GEMINI_API_KEY;
const model = () => process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

let client = null;
let clientKey = null;
const getClient = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!client || clientKey !== key) {
    client = new GoogleGenAI({ apiKey: key });
    clientKey = key;
  }
  return client;
};

// Passive health: updated by real calls and by the (cached, non-generating) probe.
const state = { lastOk: 0, failure: null, quotaUntil: 0, probeAt: 0 };

function classify(err) {
  const status = Number(err?.status) || 0;
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(String(err?.message))) return { kind: "quota", status: status || 429 };
  if (status === 400 || status === 401 || status === 403) return { kind: "auth", status };
  return { kind: "unavailable", status };
}

function recordFailure(err) {
  const f = classify(err);
  state.failure = f.kind;
  if (f.kind === "quota") state.quotaUntil = Date.now() + QUOTA_COOLDOWN_MS;
  console.warn(`Gemini request failed: ${f.kind}${f.status ? ` (HTTP ${f.status})` : ""}`);
}

// Returns trimmed text, or null on any failure / when not configured / during a quota cooldown.
async function generate({ system, user, schema } = {}) {
  if (!isConfigured() || Date.now() < state.quotaUntil) return null;
  try {
    const res = await getClient().models.generateContent({
      model: model(),
      contents: user,
      config: {
        systemInstruction: system,
        temperature: 0,
        maxOutputTokens: 400,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
      },
    });
    state.lastOk = Date.now();
    state.failure = null;
    return res.text?.trim() || null;
  } catch (err) {
    recordFailure(err);
    return null;
  }
}

// { configured, status } with status: online | not_configured | quota_exhausted | unavailable.
// Never generates text: at most one cheap models.get, cached for HEALTH_TTL_MS.
async function status() {
  if (!isConfigured()) return { configured: false, status: "not_configured" };
  const now = Date.now();
  if (now < state.quotaUntil) return { configured: true, status: "quota_exhausted" };
  if (state.lastOk && now - state.lastOk < HEALTH_TTL_MS && !state.failure) return { configured: true, status: "online" };
  if (!state.probeAt || now - state.probeAt >= HEALTH_TTL_MS) {
    state.probeAt = now;
    try {
      await getClient().models.get({ model: model(), config: { abortSignal: AbortSignal.timeout(3000) } });
      state.failure = null;
      state.lastOk = Date.now();
    } catch (err) {
      recordFailure(err);
    }
  }
  if (Date.now() < state.quotaUntil) return { configured: true, status: "quota_exhausted" };
  return { configured: true, status: state.failure ? "unavailable" : "online" };
}

const _setClientForTests = (fake) => { client = fake; clientKey = process.env.GEMINI_API_KEY; };
const _resetForTests = () => { client = null; clientKey = null; Object.assign(state, { lastOk: 0, failure: null, quotaUntil: 0, probeAt: 0 }); };

module.exports = { generate, status, isConfigured, model, _setClientForTests, _resetForTests };
