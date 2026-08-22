const mongoose = require("mongoose");

// A paper prescription a patient brings in from an outside doctor or clinic,
// dispensed over the counter.
//
// Deliberately NOT a Prescription: that model is the work order our own doctor
// sends to the pharmacy, with a QUEUED/PARTIAL/DISPENSED lifecycle per item and
// a PENDING status that getPharmacyQueue selects on. An external script has no
// such lifecycle — the pharmacist reads the paper and hands the medicine over
// in one act — and it must never appear in the doctor prescription queue.
//
// Note the distinction this model encodes:
//   Consultation.prescriptionMode  = what OUR doctor did (TYPED/HANDWRITTEN/NONE)
//   ExternalPrescription           = a request that originated OUTSIDE the system
const externalPrescriptionItemSchema = new mongoose.Schema({
  medicineId: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
  // Snapshot of the name and the price actually charged, so the record stays
  // readable and auditable if the inventory record later changes.
  name: { type: String, required: true },
  qty: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  amount: { type: Number, required: true },
}, { _id: true });

const externalPrescriptionSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: ["EXTERNAL_PRESCRIPTION"],
    default: "EXTERNAL_PRESCRIPTION",
  },

  // Either a registered patient, or a guest walking in off the street with a
  // paper prescription. Guests deliberately get NO Patient record: they are
  // buying medicine, not being admitted as a patient of the centre, and
  // inventing patient records for them would distort the patient registry,
  // patient counts, and channeling history.
  patientId: { type: String, index: true },
  patientName: String,

  // Required precisely when there is no registered patient, so a record can
  // never exist without saying who the medicine went to.
  guestName: {
    type: String,
    required: function () { return !this.patientId; },
  },
  guestPhone: String,

  // The outside doctor or clinic that wrote the paper prescription. Free text
  // and optional: they are not a Doctor in this system, so there is nothing to
  // reference, and the patient may not know the name.
  prescribedBy: String,
  notes: String,

  // The bill these medication lines were posted to — either the patient's
  // existing visit, or a dedicated PHARMACY_WALK_IN session.
  visitSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "VisitSession",
    required: true,
    index: true,
  },

  items: {
    type: [externalPrescriptionItemSchema],
    validate: [(v) => v.length > 0, "At least one medicine is required"],
  },
  totalAmount: { type: Number, required: true },

  // Taken from the authenticated pharmacy user, never from the request body.
  dispensedByName: String,
  dispensedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("ExternalPrescription", externalPrescriptionSchema);
