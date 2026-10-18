// Tiny in-memory per-user limiter (single Render instance). Keyed by user id
// from the JWT, so it must run after verifyToken.
module.exports = function rateLimit({ windowMs = 60000, max = 10 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.user?.id || req.ip;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.set("Retry-After", String(Math.ceil((windowMs - (now - recent[0])) / 1000)));
      return res.status(429).json({ message: "Too many questions; please wait a moment." });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
};
