// Optional local/self-hosted language model. Every failure resolves to null so
// the assistant falls back to rules and templates rather than erroring.
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 30000;

const isConfigured = () => !!process.env.OLLAMA_URL;
const model = () => process.env.OLLAMA_MODEL || "qwen2.5:3b";

async function call(path, body, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.OLLAMA_KEY) headers.Authorization = `Bearer ${process.env.OLLAMA_KEY}`;
    const res = await fetch(`${process.env.OLLAMA_URL.replace(/\/$/, "")}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages, { json = false } = {}) {
  if (!isConfigured()) return null;
  const r = await call("/api/chat", {
    model: model(), messages, stream: false, ...(json ? { format: "json" } : {}),
    options: { temperature: 0, num_predict: 400 },
  });
  return r?.message?.content?.trim() || null;
}

async function available() {
  if (!isConfigured()) return false;
  const r = await call("/api/tags", null, 3000);
  return !!r;
}

module.exports = { chat, available, isConfigured, model };
