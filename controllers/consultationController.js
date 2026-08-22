const mongoose = require("mongoose");
const Consultation = require("../models/Consultation");
const Appointment = require("../models/Appointment");
const Prescription = require("../models/Prescription");
const VisitSession = require("../models/VisitSession");
const { resolveDoctorIdentity } = require("../services/doctorIdentityService");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CLINICAL_FIELDS = ["chiefComplaint", "symptoms", "examination", "diagnosis", "notes"];

function applyClinicalFields(consultation, body) {
  CLINICAL_FIELDS.forEach((field) => {
    if (body[field] !== undefined) consultation[field] = body[field];
  });
}

// GET /api/consultations/by-appointment/:appointmentId
exports.getConsultationByAppointment = async (req, res) => {
  try {
    const consultation = await Consultation.findOne({ appointmentId: req.params.appointmentId });
    if (!consultation) return res.status(404).json({ message: "No consultation recorded for this appointment yet" });
    res.json(consultation);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/consultations/patient/:patientId — the doctor-authored history for
// this patient. Distinct from the patient-desk ChannelingRecord history.
exports.getConsultationsByPatient = async (req, res) => {
  try {
    const consultations = await Consultation.find({
      patientId: req.params.patientId,
      status: "COMPLETED",
    }).sort({ completedAt: -1, createdAt: -1 });

    // Attach the typed prescriptions belonging to each consultation so the
    // history can show what was prescribed without an N+1 round trip per row.
    const appointmentIds = consultations.map((c) => c.appointmentId);
    const prescriptions = await Prescription.find({ appointmentId: { $in: appointmentIds } });

    const byAppointment = new Map();
    prescriptions.forEach((p) => {
      const key = String(p.appointmentId);
      if (!byAppointment.has(key)) byAppointment.set(key, []);
      byAppointment.get(key).push(p);
    });

    res.json(
      consultations.map((c) => ({
        ...c.toObject(),
        prescriptions: byAppointment.get(String(c.appointmentId)) || [],
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/consultations/by-appointment/:appointmentId
// Upserts the working draft ("Save Consultation"). Purely clinical — it never
// touches the appointment status or the visit session.
exports.saveConsultationDraft = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const identity = await resolveDoctorIdentity(req);
    if (!identity) {
      return res.status(403).json({
        message: "No doctor profile is linked to this account, so a consultation cannot be recorded against it",
      });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });

    let consultation = await Consultation.findOne({ appointmentId });

    if (consultation && consultation.status === "COMPLETED") {
      return res.status(409).json({ message: "This consultation has already been completed" });
    }

    if (!consultation) {
      const visitSession = await VisitSession.findOne({ appointmentId });
      consultation = new Consultation({
        appointmentId,
        visitSessionId: visitSession?._id,
        patientId: appointment.patientId,
        patientName: appointment.patientName,
      });
    }

    // Authorship is stamped from the token on every save, so it can't be
    // steered by the body even on an update.
    consultation.doctorId = identity.doctorId;
    consultation.doctorName = identity.doctorName;

    applyClinicalFields(consultation, req.body);

    if (req.body.prescriptionMode !== undefined) {
      if (!Consultation.PRESCRIPTION_MODES.includes(req.body.prescriptionMode)) {
        return res.status(400).json({ message: `Unknown prescription mode: ${req.body.prescriptionMode}` });
      }
      consultation.prescriptionMode = req.body.prescriptionMode;
    }

    // Confirmation is only meaningful for a handwritten prescription, and is
    // cleared if the doctor switches away from that mode.
    if (consultation.prescriptionMode !== "HANDWRITTEN") {
      consultation.handwrittenConfirmedAt = undefined;
    } else if (req.body.handwrittenConfirmed === true) {
      consultation.handwrittenConfirmedAt = consultation.handwrittenConfirmedAt || new Date();
    } else if (req.body.handwrittenConfirmed === false) {
      consultation.handwrittenConfirmedAt = undefined;
    }

    await consultation.save();
    res.json(consultation);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
};

// POST /api/consultations/by-appointment/:appointmentId/complete
//
// The single place that decides what completing a consultation means. The
// client sends clinical fields and a prescription mode; the resulting
// appointment status and VisitSession transition are worked out here so the
// frontend can never set a financial state directly.
//
//   TYPED       -> a prescription is queued, pharmacy owns the next move
//                  (session stays PENDING_PHARMACY)
//   HANDWRITTEN -> nothing for pharmacy to do -> READY_FOR_PAYMENT
//   NONE        -> nothing for pharmacy to do -> READY_FOR_PAYMENT
exports.completeConsultation = async (req, res) => {
  const { appointmentId } = req.params;

  const identity = await resolveDoctorIdentity(req);
  if (!identity) {
    return res.status(403).json({
      message: "No doctor profile is linked to this account, so a consultation cannot be completed against it",
    });
  }

  const dbSession = await mongoose.startSession();
  try {
    let result;
    await dbSession.withTransaction(async () => {
      const appointment = await Appointment.findById(appointmentId).session(dbSession);
      if (!appointment) throw new HttpError(404, "Appointment not found");

      let consultation = await Consultation.findOne({ appointmentId }).session(dbSession);
      if (consultation?.status === "COMPLETED") {
        throw new HttpError(409, "This consultation has already been completed");
      }

      const visitSession = await VisitSession.findOne({ appointmentId }).session(dbSession);
      if (!visitSession) {
        throw new HttpError(404, "No visit session found for this appointment — billing cannot be advanced");
      }

      if (!consultation) {
        consultation = new Consultation({
          appointmentId,
          visitSessionId: visitSession._id,
          patientId: appointment.patientId,
          patientName: appointment.patientName,
        });
      }
      consultation.visitSessionId = consultation.visitSessionId || visitSession._id;
      consultation.doctorId = identity.doctorId;
      consultation.doctorName = identity.doctorName;
      applyClinicalFields(consultation, req.body);

      const mode = req.body.prescriptionMode ?? consultation.prescriptionMode;
      if (!Consultation.PRESCRIPTION_MODES.includes(mode)) {
        throw new HttpError(400, "Choose how the prescription is being handled before completing the consultation");
      }
      consultation.prescriptionMode = mode;

      const queuedPrescriptions = await Prescription.countDocuments({ appointmentId }).session(dbSession);

      if (mode === "TYPED") {
        // The medicines are saved through the prescription API before this
        // point; completing with nothing saved would silently skip pharmacy.
        if (queuedPrescriptions === 0) {
          throw new HttpError(
            409,
            "Save the prescription before completing, or choose Handwritten Prescription / No Prescription"
          );
        }
      } else {
        // Switching to handwritten/none after already queuing medicines would
        // leave the pharmacy holding a work order nobody is expecting.
        if (queuedPrescriptions > 0) {
          throw new HttpError(
            409,
            "A prescription has already been sent to the pharmacy for this visit, so this consultation must be completed as a typed prescription"
          );
        }

        consultation.handwrittenConfirmedAt =
          mode === "HANDWRITTEN" ? consultation.handwrittenConfirmedAt : undefined;

        if (mode === "HANDWRITTEN") {
          const confirmed = req.body.handwrittenConfirmed === true || !!consultation.handwrittenConfirmedAt;
          if (!confirmed) {
            throw new HttpError(400, "Confirm that the handwritten prescription was given to the patient");
          }
          consultation.handwrittenConfirmedAt = consultation.handwrittenConfirmedAt || new Date();
        }

        // Nothing is going to the pharmacy, so the visit is ready to be paid.
        // Only advance from OPEN — a session already further along is left
        // exactly as the pharmacy or billing left it.
        if (visitSession.status === "OPEN") {
          visitSession.pushStatus("READY_FOR_PAYMENT", identity.doctorName);
          await visitSession.save({ session: dbSession });
        }
      }

      consultation.status = "COMPLETED";
      consultation.completedAt = new Date();
      await consultation.save({ session: dbSession });

      appointment.status = "Completed";
      await appointment.save({ session: dbSession });

      result = { consultation, appointmentStatus: appointment.status, visitSessionStatus: visitSession.status };
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  } finally {
    dbSession.endSession();
  }
};
