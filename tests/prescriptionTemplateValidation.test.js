const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTemplateInput, medicineIssue } = require("../utils/prescriptionTemplateValidation");

const id1 = "64b7f0c2a1b2c3d4e5f60718";
const id2 = "64b7f0c2a1b2c3d4e5f60719";
const item = (o = {}) => ({ medicineId: id1, dosage: "500mg", frequency: "TDS", duration: "5 days", instructions: "After food", qtyPrescribed: 15, ...o });

test("accepts a multi-medicine template and normalises it", () => {
  const out = parseTemplateInput({ name: "  Common Fever ", doctorId: "evil", items: [item(), item({ medicineId: id2, qtyPrescribed: undefined })] });
  assert.equal(out.name, "Common Fever");
  assert.equal(out.nameKey, "common fever");
  assert.equal(out.items.length, 2);
  assert.equal(out.items[1].qtyPrescribed, 1);
  assert.equal(out.doctorId, undefined);
});

test("rejects blank/overlong names", () => {
  assert.throws(() => parseTemplateInput({ name: "   ", items: [item()] }), /name is required/);
  assert.throws(() => parseTemplateInput({ name: "x".repeat(81), items: [item()] }), /at most 80/);
});

test("rejects empty items, bad medicine ids, duplicates and bad quantities", () => {
  assert.throws(() => parseTemplateInput({ name: "A", items: [] }), /at least one medicine/);
  assert.throws(() => parseTemplateInput({ name: "A", items: [item({ medicineId: "nope" })] }), /select a medicine/);
  assert.throws(() => parseTemplateInput({ name: "A", items: [item(), item()] }), /twice/);
  assert.throws(() => parseTemplateInput({ name: "A", items: [item({ qtyPrescribed: 0 })] }), /quantity/);
  assert.throws(() => parseTemplateInput({ name: "A", items: [item({ qtyPrescribed: 1.5 })] }), /quantity/);
});

test("medicineIssue flags deleted, expired and out-of-stock medicines", () => {
  const now = new Date("2026-09-29");
  assert.equal(medicineIssue(null, now), "DELETED");
  assert.equal(medicineIssue({ stockQuantity: 5, expiryDate: "2026-01-01" }, now), "EXPIRED");
  assert.equal(medicineIssue({ stockQuantity: 0 }, now), "OUT_OF_STOCK");
  assert.equal(medicineIssue({ stockQuantity: 5, expiryDate: "2027-01-01" }, now), null);
});
