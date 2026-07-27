const mongoose = require("mongoose");
const VisitSession = require("../models/VisitSession");
const Prescription = require("../models/Prescription");
const Doctor = require("../models/Doctor");
const { CENTER_FEE } = require("../config/billingConfig");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Called right after an appointment is booked. Posts the Doctor Fee + Center
// Fee line items and opens the ledger for this visit.
exports.openForAppointment = async (appointment) => {
  const doctor = await Doctor.findById(appointment.doctorId);
  const doctorFee = doctor?.fee || 0;

  const session = new VisitSession({
    appointmentId: appointment._id,
    patientId: appointment.patientId,
    patientName: appointment.patientName,
    doctorId: appointment.doctorId,
    doctorName: appointment.doctorName || doctor?.name,
    status: "OPEN",
    lineItems: [
      { type: "DOCTOR_FEE", description: `Consultation - Dr. ${appointment.doctorName || doctor?.name || ""}`, qty: 1, unitPrice: doctorFee, amount: doctorFee },
      { type: "CENTER_FEE", description: "Channeling Center Fee", qty: 1, unitPrice: CENTER_FEE, amount: CENTER_FEE },
    ],
    statusHistory: [{ from: null, to: "OPEN" }],
  });
  await session.save();

  appointment.visitSessionId = session._id;
  await appointment.save();

  return session;
};

exports.getVisitSession = async (req, res) => {
  try {
    const session = await VisitSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "Visit session not found" });
    res.json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getVisitSessionByAppointment = async (req, res) => {
  try {
    const session = await VisitSession.findOne({ appointmentId: req.params.appointmentId });
    if (!session) return res.status(404).json({ message: "Visit session not found" });
    res.json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.listVisitSessions = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.patientId) filter.patientId = req.query.patientId;
    const sessions = await VisitSession.find(filter).sort({ createdAt: -1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Doctor clicks "Complete Appointment" with no further prescriptions to add.
// If pharmacy items are still queued, the session stays PENDING_PHARMACY and
// will flip to READY_FOR_PAYMENT on its own once dispensing resolves.
exports.finalizeConsultation = async (req, res) => {
  try {
    const session = await VisitSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "Visit session not found" });

    if (session.status === "OPEN") {
      session.pushStatus("READY_FOR_PAYMENT", req.user?.name);
      await session.save();
    }
    res.json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addPayment = async (req, res) => {
  const { amount, method } = req.body;
  if (!(amount > 0)) return res.status(400).json({ message: "Payment amount must be greater than 0" });

  const dbSession = await mongoose.startSession();
  try {
    let result;
    await dbSession.withTransaction(async () => {
      const session = await VisitSession.findById(req.params.id).session(dbSession);
      if (!session) throw new HttpError(404, "Visit session not found");
      if (!["READY_FOR_PAYMENT"].includes(session.status)) {
        throw new HttpError(409, `Cannot take payment while session is ${session.status}`);
      }

      const balance = session.totalDue();
      if (amount > balance + 0.01) {
        throw new HttpError(409, `Payment exceeds balance due (${balance})`);
      }

      session.payments.push({ amount, method: method || "cash", receivedBy: req.user?.name });
      if (session.totalDue() <= 0.01) {
        session.pushStatus("CLOSED", req.user?.name);
      }
      await session.save({ session: dbSession });
      result = session;
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  } finally {
    dbSession.endSession();
  }
};

// Cancel branches by current state:
//  - OPEN: nothing queued at pharmacy yet, cancel immediately.
//  - PENDING_PHARMACY: flag cancelRequested; dispensing checks this flag and
//    the session is closed out to CANCELED once every item resolves.
//  - READY_FOR_PAYMENT: only cancelable if nothing has been paid yet.
//  - CLOSED / CANCELED: terminal, reject.
exports.cancelVisitSession = async (req, res) => {
  try {
    const session = await VisitSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "Visit session not found" });

    if (session.status === "CLOSED" || session.status === "CANCELED") {
      return res.status(409).json({ message: `Session already ${session.status}` });
    }

    if (session.status === "OPEN") {
      session.pushStatus("CANCELED", req.user?.name, req.body?.reason);
      await session.save();
      return res.json(session);
    }

    if (session.status === "PENDING_PHARMACY") {
      session.cancelRequested = true;
      await session.save();
      return res.json({ ...session.toObject(), message: "Cancellation queued — waiting on pharmacy to resolve outstanding items." });
    }

    if (session.status === "READY_FOR_PAYMENT") {
      if (session.payments.length > 0) {
        return res.status(409).json({ message: "Cannot cancel a session with recorded payments — process a refund instead" });
      }
      session.pushStatus("CANCELED", req.user?.name, req.body?.reason);
      await session.save();
      return res.json(session);
    }

    return res.status(409).json({ message: `Cannot cancel session in status ${session.status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.HttpError = HttpError;
