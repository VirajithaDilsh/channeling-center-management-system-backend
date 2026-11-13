const PrescriptionTemplate = require("../models/PrescriptionTemplate");
const Medicine = require("../models/Medicine");
const { resolveDoctorIdentity } = require("../services/doctorIdentityService");
const { parseTemplateInput, medicineIssue } = require("../utils/prescriptionTemplateValidation");

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Templates belong to one doctor, resolved from the token — never from the
// request. An account with no linked Doctor profile (e.g. an admin) has none.
async function requireDoctor(req, res) {
  const identity = await resolveDoctorIdentity(req);
  if (!identity) {
    res.status(403).json({ message: "No doctor profile is linked to this account, so it has no prescription templates" });
    return null;
  }
  return identity;
}

// Adds live inventory status to each item so the UI can flag medicines that
// were deleted, expired or are out of stock. Nothing extra is stored.
async function withAvailability(templates) {
  const ids = [...new Set(templates.flatMap((t) => t.items.map((i) => String(i.medicineId))))];
  const medicines = await Medicine.find({ _id: { $in: ids } }).select("name stockQuantity expiryDate");
  const byId = new Map(medicines.map((m) => [String(m._id), m]));

  return templates.map((t) => {
    const obj = t.toObject();
    obj.items = obj.items.map((item) => {
      const medicine = byId.get(String(item.medicineId));
      return {
        ...item,
        medicineName: medicine?.name || item.medicineName,
        stockQuantity: medicine?.stockQuantity ?? null,
        issue: medicineIssue(medicine),
      };
    });
    return obj;
  });
}

// Confirms every referenced medicine still exists, and returns items with the
// current name snapshot filled in.
async function attachMedicineNames(items) {
  const medicines = await Medicine.find({ _id: { $in: items.map((i) => i.medicineId) } }).select("name");
  const byId = new Map(medicines.map((m) => [String(m._id), m]));
  return items.map((item, idx) => {
    const medicine = byId.get(item.medicineId);
    if (!medicine) {
      const err = new Error(`Item ${idx + 1}: this medicine no longer exists — choose another`);
      err.status = 400;
      throw err;
    }
    return { ...item, medicineName: medicine.name };
  });
}

const sendError = (res, err) => {
  if (err.code === 11000) {
    return res.status(409).json({ message: "You already have a template with this name" });
  }
  if (err.name === "CastError") return res.status(404).json({ message: "Template not found" });
  res.status(err.status || 500).json({ message: err.message });
};

exports.listTemplates = async (req, res) => {
  try {
    const identity = await requireDoctor(req, res);
    if (!identity) return;

    const filter = { doctorId: identity.doctorId };
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) filter.name = new RegExp(escapeRegex(search), "i");

    const templates = await PrescriptionTemplate.find(filter).sort({ name: 1 });
    res.json(await withAvailability(templates));
  } catch (err) {
    sendError(res, err);
  }
};

exports.getTemplate = async (req, res) => {
  try {
    const identity = await requireDoctor(req, res);
    if (!identity) return;

    // Scoped by doctorId: another doctor's template id looks like a 404.
    const template = await PrescriptionTemplate.findOne({ _id: req.params.id, doctorId: identity.doctorId });
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json((await withAvailability([template]))[0]);
  } catch (err) {
    sendError(res, err);
  }
};

exports.createTemplate = async (req, res) => {
  try {
    const identity = await requireDoctor(req, res);
    if (!identity) return;

    const input = parseTemplateInput(req.body);
    input.items = await attachMedicineNames(input.items);

    const template = await PrescriptionTemplate.create({ ...input, doctorId: identity.doctorId });
    res.status(201).json((await withAvailability([template]))[0]);
  } catch (err) {
    sendError(res, err);
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const identity = await requireDoctor(req, res);
    if (!identity) return;

    const template = await PrescriptionTemplate.findOne({ _id: req.params.id, doctorId: identity.doctorId });
    if (!template) return res.status(404).json({ message: "Template not found" });

    const input = parseTemplateInput(req.body);
    input.items = await attachMedicineNames(input.items);

    template.name = input.name;
    template.nameKey = input.nameKey;
    template.items = input.items;
    await template.save();
    res.json((await withAvailability([template]))[0]);
  } catch (err) {
    sendError(res, err);
  }
};

// Hard delete is safe: prescriptions hold copies, not references to templates.
exports.deleteTemplate = async (req, res) => {
  try {
    const identity = await requireDoctor(req, res);
    if (!identity) return;

    const deleted = await PrescriptionTemplate.findOneAndDelete({ _id: req.params.id, doctorId: identity.doctorId });
    if (!deleted) return res.status(404).json({ message: "Template not found" });
    res.json({ message: "Template deleted successfully" });
  } catch (err) {
    sendError(res, err);
  }
};
