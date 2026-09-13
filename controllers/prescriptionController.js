const mongoose = require("mongoose");
const Prescription = require("../models/Prescription");
const VisitSession = require("../models/VisitSession");
const Medicine = require("../models/Medicine");
const { resolveDoctorIdentity, doctorHasAppointmentWithPatient } = require("../services/doctorIdentityService");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hasPatientsModuleGrant(req) {
  const perms = req.user?.permissions || [];
  return perms.includes("patients_read") || perms.includes("patients_allow_all");
}

exports.getPrescriptionsByPatient = async (req, res) => {
  try {
    if (!hasPatientsModuleGrant(req)) {
      const identity = await resolveDoctorIdentity(req);
      const owns = identity && (await doctorHasAppointmentWithPatient(identity.doctorId, req.params.patientId));
      if (!owns) return res.status(403).json({ message: "Not authorized for this resource" });
    }

    const prescriptions = await Prescription.find({ patientId: req.params.patientId }).sort({ createdAt: -1 });
    res.json(prescriptions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Pharmacy counter's inbound queue: every item still awaiting action, oldest first.
exports.getPharmacyQueue = async (req, res) => {
  try {
    const prescriptions = await Prescription.find({ status: "PENDING" }).sort({ createdAt: 1 });
    res.json(prescriptions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Doctor writes an e-prescription -> queues items to the pharmacy and moves
// the visit session into PENDING_PHARMACY.
exports.createPrescription = async (req, res) => {
  const { appointmentId, patientId, patientName, diagnosis, notes, items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "At least one prescription item is required" });
  }

  // Authorship comes from the authenticated caller's linked Doctor profile.
  // Any doctorId/doctorName in the body is deliberately ignored, so a request
  // can't attribute a prescription to another doctor.
  const identity = await resolveDoctorIdentity(req);
  if (!identity) {
    return res.status(403).json({
      message: "No doctor profile is linked to this account, so a prescription cannot be issued from it",
    });
  }
  const { doctorId, doctorName } = identity;

  const dbSession = await mongoose.startSession();
  try {
    let result;
    await dbSession.withTransaction(async () => {
      const visitSession = await VisitSession.findOne({ appointmentId }).session(dbSession);
      if (!visitSession) throw new HttpError(404, "No visit session found for this appointment");
      if (!["OPEN", "PENDING_PHARMACY"].includes(visitSession.status)) {
        throw new HttpError(409, `Cannot queue a prescription while session is ${visitSession.status}`);
      }

      const medicineIds = items.map((i) => i.medicineId);
      const medicines = await Medicine.find({ _id: { $in: medicineIds } }).session(dbSession);
      const medicineById = new Map(medicines.map((m) => [String(m._id), m]));

      const prescriptionItems = items.map((i) => {
        const medicine = medicineById.get(String(i.medicineId));
        if (!medicine) throw new HttpError(400, `Unknown medicine: ${i.medicineId}`);
        return {
          medicineId: medicine._id,
          name: medicine.name,
          dosage: i.dosage,
          frequency: i.frequency,
          duration: i.duration,
          instructions: i.instructions,
          qtyPrescribed: i.qtyPrescribed || 1,
          unitPrice: medicine.unitPrice || 0,
          status: "QUEUED",
        };
      });

      const [prescription] = await Prescription.create(
        [{ appointmentId, visitSessionId: visitSession._id, patientId, patientName, doctorId, doctorName, diagnosis, notes, items: prescriptionItems }],
        { session: dbSession }
      );

      if (visitSession.status === "OPEN") {
        visitSession.pushStatus("PENDING_PHARMACY", doctorName);
        await visitSession.save({ session: dbSession });
      }

      result = prescription;
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  } finally {
    dbSession.endSession();
  }
};

// Recomputes the prescription's overall status and, if nothing is left
// QUEUED, checks whether the owning visit session can move on:
//  - if the session's cancellation was pending, finalize it to CANCELED
//  - otherwise, if every prescription tied to the session is resolved,
//    advance it to READY_FOR_PAYMENT
async function resolveSessionIfDone(prescription, visitSession, dbSession, actor) {
  prescription.recomputeStatus();
  await prescription.save({ session: dbSession });

  if (prescription.status !== "RESOLVED") return;

  const outstanding = await Prescription.countDocuments({
    visitSessionId: visitSession._id,
    status: "PENDING",
  }).session(dbSession);
  if (outstanding > 0) return;

  if (visitSession.cancelRequested) {
    visitSession.pushStatus("CANCELED", actor, "Cancellation resolved after pharmacy queue cleared");
  } else if (visitSession.status === "PENDING_PHARMACY") {
    visitSession.pushStatus("READY_FOR_PAYMENT", actor);
  }
  await visitSession.save({ session: dbSession });
}

// Dispenses (fully or partially) a single prescription item. Stock decrement,
// item status update, and the medication bill line all commit in one
// transaction so a mid-way failure can't give away stock without billing it.
exports.dispenseItem = async (req, res) => {
  const { qtyDispensed } = req.body;
  const dbSession = await mongoose.startSession();
  try {
    let result;
    let canceledForSession = false;
    await dbSession.withTransaction(async () => {
      const prescription = await Prescription.findById(req.params.id).session(dbSession);
      if (!prescription) throw new HttpError(404, "Prescription not found");
      const item = prescription.items.id(req.params.itemId);
      if (!item) throw new HttpError(404, "Prescription item not found");
      // PARTIAL is dispensable too — it means some quantity is still owed.
      if (!["QUEUED", "PARTIAL"].includes(item.status)) {
        throw new HttpError(409, `Item already ${item.status}`);
      }

      const visitSession = await VisitSession.findById(prescription.visitSessionId).session(dbSession);
      if (!visitSession) throw new HttpError(404, "Visit session not found");

      // Cancellation was requested mid-flight — resolve this item as canceled
      // (not dispensed) and let the transaction commit that outcome, rather
      // than aborting it: the whole point is to make the cancel stick.
      if (visitSession.cancelRequested) {
        item.status = "CANCELED";
        await resolveSessionIfDone(prescription, visitSession, dbSession, req.user?.name);
        canceledForSession = true;
        result = prescription;
        return;
      }

      const remaining = item.qtyPrescribed - item.qtyDispensed;
      const qtyToDispense = Math.min(qtyDispensed > 0 ? qtyDispensed : remaining, remaining);

      const medicine = await Medicine.findOneAndUpdate(
        { _id: item.medicineId, stockQuantity: { $gte: qtyToDispense } },
        { $inc: { stockQuantity: -qtyToDispense } },
        { new: true, session: dbSession }
      );
      if (!medicine) throw new HttpError(409, `Insufficient stock for ${item.name}`);

      item.qtyDispensed += qtyToDispense;
      item.status = item.qtyDispensed >= item.qtyPrescribed ? "DISPENSED" : "PARTIAL";

      visitSession.lineItems.push({
        type: "MEDICATION",
        description: item.name,
        qty: qtyToDispense,
        unitPrice: item.unitPrice,
        amount: qtyToDispense * item.unitPrice,
        refId: item._id,
      });
      await visitSession.save({ session: dbSession });

      await resolveSessionIfDone(prescription, visitSession, dbSession, req.user?.name);
      result = prescription;
    });
    if (canceledForSession) {
      return res.status(409).json({ message: "Session cancellation is in progress — item was not dispensed", prescription: result });
    }
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  } finally {
    dbSession.endSession();
  }
};

// Rejects a prescription item outright (e.g. discontinued, doctor substitutes
// elsewhere) — no stock movement, no bill line.
exports.rejectItem = async (req, res) => {
  const { reason } = req.body;
  const dbSession = await mongoose.startSession();
  try {
    let result;
    await dbSession.withTransaction(async () => {
      const prescription = await Prescription.findById(req.params.id).session(dbSession);
      if (!prescription) throw new HttpError(404, "Prescription not found");
      const item = prescription.items.id(req.params.itemId);
      if (!item) throw new HttpError(404, "Prescription item not found");
      // Rejecting a PARTIAL item writes off the quantity still owed — without
      // this the remainder could never be closed out and the visit session
      // would sit in PENDING_PHARMACY forever.
      if (!["QUEUED", "PARTIAL"].includes(item.status)) {
        throw new HttpError(409, `Item already ${item.status}`);
      }

      const visitSession = await VisitSession.findById(prescription.visitSessionId).session(dbSession);
      if (!visitSession) throw new HttpError(404, "Visit session not found");

      item.status = "REJECTED";
      item.rejectionReason = reason;

      await resolveSessionIfDone(prescription, visitSession, dbSession, req.user?.name);
      result = prescription;
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  } finally {
    dbSession.endSession();
  }
};
