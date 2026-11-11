const Icd10Code = require("../models/Icd10Code");

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/icd10?q=<text>&limit=20
//
// Matches either the start of the code (typed with or without the point, so
// "E11.9" and "E119" both work) or every word of the description, in any order.
exports.searchIcd10 = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    if (q.length < 2) return res.json([]);

    const codeKey = q.replace(/\./g, "").toUpperCase();
    const words = q.split(/\s+/).filter(Boolean).map((w) => new RegExp(escapeRegex(w), "i"));

    const or = [{ codeKey: new RegExp(`^${escapeRegex(codeKey)}`) }];
    or.push({ $and: words.map((re) => ({ description: re })) });

    const results = await Icd10Code.find({ active: true, $or: or })
      .select("code description -_id")
      .sort({ code: 1 })
      .limit(limit)
      .lean();

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
