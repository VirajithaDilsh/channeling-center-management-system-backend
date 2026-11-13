const mongoose = require("mongoose");

const NAME_MAX = 80;
const TEXT_MAX = 200;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const cleanText = (value, label) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > TEXT_MAX) throw new ValidationError(`${label} must be at most ${TEXT_MAX} characters`);
  return trimmed;
};

// Validates and normalises a template request body. Only whitelisted fields
// are returned, so nothing else in the body (doctorId, _id, ...) can leak in.
function parseTemplateInput(body = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new ValidationError("Template name is required");
  if (name.length > NAME_MAX) throw new ValidationError(`Template name must be at most ${NAME_MAX} characters`);

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ValidationError("A template needs at least one medicine");
  }

  const seen = new Set();
  const items = body.items.map((raw, idx) => {
    const row = idx + 1;
    if (!raw || !mongoose.isValidObjectId(raw.medicineId)) {
      throw new ValidationError(`Item ${row}: select a medicine`);
    }
    const key = String(raw.medicineId);
    if (seen.has(key)) throw new ValidationError(`Item ${row}: the same medicine is listed twice`);
    seen.add(key);

    const qty = raw.qtyPrescribed === undefined || raw.qtyPrescribed === "" ? 1 : Number(raw.qtyPrescribed);
    if (!Number.isInteger(qty) || qty < 1) throw new ValidationError(`Item ${row}: quantity must be a whole number of at least 1`);

    return {
      medicineId: key,
      dosage: cleanText(raw.dosage, `Item ${row}: dosage`),
      frequency: cleanText(raw.frequency, `Item ${row}: frequency`),
      duration: cleanText(raw.duration, `Item ${row}: duration`),
      instructions: cleanText(raw.instructions, `Item ${row}: instructions`),
      qtyPrescribed: qty,
    };
  });

  return { name, nameKey: name.toLowerCase(), items };
}

// Why a template item may need the doctor's attention. DELETED means the
// medicine is gone from inventory and must be replaced; the others are warnings.
function medicineIssue(medicine, now = new Date()) {
  if (!medicine) return "DELETED";
  if (medicine.expiryDate && new Date(medicine.expiryDate) < now) return "EXPIRED";
  if (!(medicine.stockQuantity > 0)) return "OUT_OF_STOCK";
  return null;
}

module.exports = { parseTemplateInput, medicineIssue, ValidationError, NAME_MAX, TEXT_MAX };
