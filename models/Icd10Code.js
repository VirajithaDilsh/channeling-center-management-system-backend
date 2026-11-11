const mongoose = require("mongoose");

// Reference catalog of ICD-10-CM diagnosis codes (CMS/CDC, public domain).
// Loaded by utils/seedIcd10.js; read-only from the app's point of view.
const icd10CodeSchema = new mongoose.Schema({
  // Display form with the decimal point, e.g. "E11.9".
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  // Same code without the point ("E119"), so a doctor can type either form and
  // still hit the index with an anchored prefix match.
  codeKey: { type: String, required: true, index: true },
  description: { type: String, required: true },
  active: { type: Boolean, default: true },
});

module.exports = mongoose.model("Icd10Code", icd10CodeSchema);
