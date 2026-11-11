// Manual (re-)import of the ICD-10-CM catalog: `node seed/importIcd10.js`
// Idempotent — upserts by code, never deletes.
require("dotenv").config();
const mongoose = require("mongoose");
const { importIcd10 } = require("../utils/seedIcd10");

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const total = await importIcd10();
    console.log(`Imported/updated ${total} ICD-10-CM codes`);
  } catch (err) {
    console.error("ICD-10 import failed:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
