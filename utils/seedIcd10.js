const fs = require("fs");
const path = require("path");
const Icd10Code = require("../models/Icd10Code");

// ICD-10-CM FY2027 (effective 2026-10-01), "Code Descriptions" file from
// https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/
// To move to a new fiscal year, drop the new icd10cm-codes-<year>.txt into
// data/, update this path, and run `node seed/importIcd10.js` (idempotent).
const DATA_FILE = path.join(__dirname, "..", "data", "icd10cm-codes-2027.txt");
const BATCH_SIZE = 1000;

// "E119" -> "E11.9"; 3-character category codes have no point.
function formatCode(raw) {
  return raw.length > 3 ? `${raw.slice(0, 3)}.${raw.slice(3)}` : raw;
}

function parseLine(line) {
  const match = line.match(/^(\S+)\s+(.+?)\s*$/);
  if (!match) return null;
  const raw = match[1].toUpperCase();
  return { code: formatCode(raw), codeKey: raw, description: match[2] };
}

// Upserts every code in the file. Safe to re-run: existing codes get their
// description refreshed, nothing is deleted.
async function importIcd10(file = DATA_FILE) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let batch = [];
  let total = 0;

  const flush = async () => {
    if (!batch.length) return;
    await Icd10Code.bulkWrite(batch, { ordered: false });
    total += batch.length;
    batch = [];
  };

  for (const line of lines) {
    const doc = parseLine(line);
    if (!doc) continue;
    batch.push({
      updateOne: {
        filter: { code: doc.code },
        update: { $set: { codeKey: doc.codeKey, description: doc.description }, $setOnInsert: { active: true } },
        upsert: true,
      },
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return total;
}

// Boot-time guard, mirroring seedRoles.js: only loads into an empty collection
// so a fresh deploy self-populates without re-importing on every restart.
async function seedIcd10() {
  const count = await Icd10Code.estimatedDocumentCount();
  if (count > 0) return;
  const total = await importIcd10();
  console.log(`Seeded ${total} ICD-10-CM codes`);
}

module.exports = seedIcd10;
module.exports.importIcd10 = importIcd10;
