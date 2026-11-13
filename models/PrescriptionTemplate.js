const mongoose = require("mongoose");

// Mirrors Prescription's item shape (minus dispensing/pricing state) so a
// template can be copied straight into a consultation's prescription form.
// medicineName is a snapshot: it lets the UI still show what the item was if
// the Medicine has since been deleted from inventory.
const templateItemSchema = new mongoose.Schema({
  medicineId: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
  medicineName: { type: String, required: true },
  dosage: String,
  frequency: String,
  duration: String,
  instructions: String,
  qtyPrescribed: { type: Number, required: true, min: 1, default: 1 },
}, { _id: true });

// Templates are private to the doctor who created them. Prescriptions created
// from a template are plain copies and hold no reference back to it, so
// editing or deleting a template never touches an issued prescription.
const prescriptionTemplateSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
  name: { type: String, required: true, trim: true },
  // Lower-cased name, used only to enforce case-insensitive uniqueness per doctor.
  nameKey: { type: String, required: true },
  items: {
    type: [templateItemSchema],
    validate: [(v) => v.length > 0, "A template needs at least one medicine"],
  },
}, { timestamps: true });

prescriptionTemplateSchema.index({ doctorId: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model("PrescriptionTemplate", prescriptionTemplateSchema);
