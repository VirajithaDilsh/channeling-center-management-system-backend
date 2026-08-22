const mongoose = require("mongoose");
const ExternalPrescription = require("../models/ExternalPrescription");
const VisitSession = require("../models/VisitSession");
const Medicine = require("../models/Medicine");
const Patient = require("../models/Patient");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TERMINAL_STATUSES = ["CLOSED", "CANCELED"];

exports.listExternalPrescriptions = async (req, res) => {
  try {
    const filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    const records = await ExternalPrescription.find(filter).sort({ dispensedAt: -1 }).limit(200);
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Dispenses a paper prescription brought in from outside, in a single
// transaction: stock decrement for every line, the MEDICATION bill lines, and
// the audit record all commit together or not at all.
//
// Stock safety matches the doctor-prescription dispense path exactly — a
// conditional `stockQuantity: { $gte: qty }` update per medicine — so two
// pharmacy users working at once cannot oversell.
exports.createExternalPrescription = async (req, res) => {
  const { patientId, guestName, guestPhone, prescribedBy, notes, items, visitSessionId } = req.body;

  // A walk-in may not be a registered patient at all. In that case we take a
  // name for the receipt and create no Patient record — see the model comment.
  const isGuest = !patientId;
  const trimmedGuestName = String(guestName || "").trim();

  if (isGuest && !trimmedGuestName) {
    return res.status(400).json({ message: "Select a registered patient, or enter the guest's name" });
  }
  if (isGuest && visitSessionId) {
    return res.status(400).json({ message: "A guest has no existing visit to add these charges to" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "At least one medicine is required" });
  }

  // Two lines for the same medicine would each be stock-checked separately and
  // read as a smaller request than it is; ask for them combined instead.
  const seen = new Set();
  for (const item of items) {
    if (!item.medicineId) return res.status(400).json({ message: "Every line must have a medicine selected" });
    const key = String(item.medicineId);
    if (seen.has(key)) {
      return res.status(400).json({ message: "The same medicine is listed twice — combine it into one line" });
    }
    seen.add(key);

    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ message: "Every quantity must be a whole number of at least 1" });
    }
  }

  const dbSession = await mongoose.startSession();
  try {
    let result;
    await dbSession.withTransaction(async () => {
      let patient = null;
      if (!isGuest) {
        patient = await Patient.findOne({ patientId }).session(dbSession);
        if (!patient) throw new HttpError(404, "Patient not found");
      }
      const billedName = patient ? patient.name : trimmedGuestName;

      const lineItems = [];
      const recordItems = [];

      for (const item of items) {
        const qty = Number(item.qty);

        // Conditional decrement: if stock is short the update matches nothing
        // and the whole transaction aborts, so no partial giveaway occurs.
        const medicine = await Medicine.findOneAndUpdate(
          { _id: item.medicineId, stockQuantity: { $gte: qty } },
          { $inc: { stockQuantity: -qty } },
          { new: true, session: dbSession }
        );
        if (!medicine) {
          const existing = await Medicine.findById(item.medicineId).session(dbSession);
          throw new HttpError(
            409,
            existing
              ? `Insufficient stock for ${existing.name} — ${existing.stockQuantity} available, ${qty} requested`
              : `Unknown medicine: ${item.medicineId}`
          );
        }

        // Unlike a typed prescription (which bills the price snapshotted when
        // the doctor prescribed it), an external script is priced at the
        // counter, so the current inventory price applies.
        const unitPrice = medicine.unitPrice || 0;
        const amount = qty * unitPrice;

        lineItems.push({
          type: "MEDICATION",
          description: `${medicine.name} (external prescription)`,
          qty,
          unitPrice,
          amount,
        });
        recordItems.push({ medicineId: medicine._id, name: medicine.name, qty, unitPrice, amount });
      }

      const totalAmount = recordItems.reduce((sum, i) => sum + i.amount, 0);

      let visitSession;
      if (visitSessionId) {
        // Bill onto the patient's existing visit. The status is deliberately
        // left exactly as it is: the doctor-prescription state machine owns
        // those transitions and must not be nudged from here.
        visitSession = await VisitSession.findById(visitSessionId).session(dbSession);
        if (!visitSession) throw new HttpError(404, "Visit session not found");
        if (visitSession.patientId !== patientId) {
          throw new HttpError(409, "That visit belongs to a different patient");
        }
        if (TERMINAL_STATUSES.includes(visitSession.status)) {
          throw new HttpError(409, `Cannot add charges to a ${visitSession.status} visit`);
        }
        visitSession.lineItems.push(...lineItems);
        await visitSession.save({ session: dbSession });
      } else {
        // A walk-in with no appointment: its own bill, payable immediately
        // since the medicine has already been handed over.
        visitSession = new VisitSession({
          source: "PHARMACY_WALK_IN",
          patientId: patient ? patientId : undefined,
          // Billing has no other way to tell a guest sale apart, and its
          // patient column is the only place staff will look.
          patientName: isGuest ? `${billedName} (guest)` : billedName,
          // Shown in the Billing grid's Doctor column; there is no Doctor
          // record to reference for an outside prescriber.
          doctorName: prescribedBy ? `External — ${prescribedBy}` : "External prescription",
          status: "READY_FOR_PAYMENT",
          lineItems,
          statusHistory: [
            { from: null, to: "READY_FOR_PAYMENT", by: req.user?.name, reason: "External prescription dispensed" },
          ],
        });
        await visitSession.save({ session: dbSession });
      }

      const [record] = await ExternalPrescription.create(
        [{
          patientId: patient ? patientId : undefined,
          patientName: billedName,
          guestName: isGuest ? billedName : undefined,
          guestPhone: isGuest ? String(guestPhone || "").trim() || undefined : undefined,
          prescribedBy,
          notes,
          visitSessionId: visitSession._id,
          items: recordItems,
          totalAmount,
          // Authorship from the token, not the body — same rule as prescriptions.
          dispensedByName: req.user?.name,
        }],
        { session: dbSession }
      );

      result = { externalPrescription: record, visitSession };
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  } finally {
    dbSession.endSession();
  }
};
