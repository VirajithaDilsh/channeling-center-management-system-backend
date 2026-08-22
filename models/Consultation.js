const mongoose = require("mongoose");

// The clinical record of a doctor's consultation. Kept separate from
// Prescription (which is the pharmacy's work order) and from VisitSession
// (which is the money): a consultation can exist with no prescription at all,
// and its notes must not disappear when there is nothing to dispense.
//
// ChannelingRecord stays what it always was — patient-desk/registration vitals
// captured by reception — and is not touched by this model.
const PRESCRIPTION_MODES = ["TYPED", "HANDWRITTEN", "NONE"];

const consultationSchema = new mongoose.Schema({
  // One consultation per appointment.
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appointment",
    required: true,
    unique: true,
    index: true,
  },
  visitSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "VisitSession" },

  patientId: { type: String, required: true, index: true },
  patientName: String,

  // Always derived from the authenticated user server-side, never from the
  // request body — see services/doctorIdentityService.js.
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
  doctorName: String,

  // Clinical fields.
  chiefComplaint: String,
  symptoms: String,
  examination: String,
  diagnosis: String,
  notes: String,

  // Why the pharmacy was or wasn't involved. Left unset on a fresh draft and
  // required before the consultation can be completed.
  prescriptionMode: { type: String, enum: PRESCRIPTION_MODES },

  // Only meaningful for HANDWRITTEN: records that the doctor confirmed the
  // paper prescription was handed to the patient.
  handwrittenConfirmedAt: Date,

  status: {
    type: String,
    enum: ["IN_PROGRESS", "COMPLETED"],
    default: "IN_PROGRESS",
    index: true,
  },
  completedAt: Date,
}, { timestamps: true });

consultationSchema.statics.PRESCRIPTION_MODES = PRESCRIPTION_MODES;

module.exports = mongoose.model("Consultation", consultationSchema);
module.exports.PRESCRIPTION_MODES = PRESCRIPTION_MODES;
