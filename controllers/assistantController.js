const svc = require("../services/reportService");
const { ForecastUnavailable } = require("../services/forecastClient");
const { TOOLS } = require("../services/assistantTools");
const { matchIntent } = require("../services/assistantRules");
const { buildAnswer, SUPPORTED } = require("../services/assistantAnswers");
const llm = require("../services/assistantLlm");
const ollama = require("../services/ollamaClient");

const MAX_LEN = 500;

function safeContext(ctx) {
  if (!ctx || typeof ctx !== "object" || !TOOLS[ctx.tool]) return null;
  try {
    return { tool: ctx.tool, params: TOOLS[ctx.tool].validate({ ...(ctx.params || {}) }) };
  } catch {
    return null;
  }
}

exports.status = async (req, res) => {
  res.json({ llmConfigured: ollama.isConfigured(), llmAvailable: await ollama.available(), model: ollama.isConfigured() ? ollama.model() : null });
};

exports.chat = async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > MAX_LEN) {
    return res.status(400).json({ message: `Question must be 1-${MAX_LEN} characters` });
  }
  const context = safeContext(req.body.context);
  const today = svc.currentMonthKey();
  const unsupported = (why) => res.json({
    kind: "unsupported", tool: null, params: null, source: "rules", usedLlm: false,
    answer: `${why} I can answer questions about revenue, center commission, paid visits, doctors, month comparisons, forecasts and why revenue changed. For example: ${SUPPORTED.slice(0, 4).map((q) => `"${q}"`).join(", ")}.`,
  });

  try {
    // 1. Understand: rules first (deterministic), model only for phrasings rules miss.
    let intent = matchIntent(message, context);
    let source = "rules";
    if (!intent && ollama.isConfigured()) {
      intent = await llm.pickTool(message, context, new Date().toISOString().slice(0, 10));
      source = "llm";
    }
    if (!intent || intent.tool === "unsupported") return unsupported("I couldn't match that to a financial question.");

    // 2. Validate params, 3. run the predefined read-only tool.
    const tool = TOOLS[intent.tool];
    let params;
    try { params = tool.validate({ ...intent.params }); } catch (e) {
      return unsupported(e instanceof svc.ReportError ? `${e.message}.` : "I couldn't read that request.");
    }
    const data = await tool.run(params);

    // 4. Facts are always built deterministically; the model may only rephrase them.
    const { kind, text } = buildAnswer(intent.tool, data);
    let answer = text, usedLlm = false;
    if (ollama.isConfigured()) {
      const phrased = await llm.phrase(tool.description, text, data) // never the raw question: it could contain a patient name;
      if (phrased) { answer = phrased; usedLlm = true; }
    }
    res.json({ kind, tool: intent.tool, params, source, usedLlm, answer, factual: text, data });
  } catch (err) {
    if (err instanceof ForecastUnavailable) {
      return res.json({ kind: "prediction", tool: "forecast", params: {}, source: "rules", usedLlm: false, answer: `The forecasting service is unavailable right now (${err.message}). Actual revenue questions still work.` });
    }
    console.error("Assistant error:", err);
    res.status(500).json({ message: "The assistant could not answer that." });
  }
};
