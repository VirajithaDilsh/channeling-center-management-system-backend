// Idempotent demo data seeder for all three AI prediction modules:
//   1. Revenue Forecasting (12+ complete Asia/Colombo months of VisitSessions)
//   2. Medicine Stock-Out Prediction (90+ days of ExternalPrescription dispensing)
//   3. Doctor Appointment Demand Forecasting (90+ days history + 14 days upcoming)
//
// Targets ONLY the `channeling_center_dev` database.
//
// Usage:
//   node seed/seedPredictionDemoData.js --dry-run   (default: read-only preview)
//   node seed/seedPredictionDemoData.js --apply     (writes to channeling_center_dev)

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const dns = require("dns");

dns.setDefaultResultOrder("ipv4first");

const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Medicine = require("../models/Medicine");
const Schedule = require("../models/Schedule");
const Appointment = require("../models/Appointment");
const VisitSession = require("../models/VisitSession");
const ExternalPrescription = require("../models/ExternalPrescription");
const { CENTER_FEE } = require("../config/billingConfig");

const TARGET_DB_NAME = "channeling_center_dev";
const DEMO_MARKER = "PRED-DEMO-2026";
const COLOMBO_OFFSET_MS = 5.5 * 3600 * 1000;
const MS_PER_DAY = 86400000;
const HISTORY_DAYS = 410; // 2025-10-01 .. yesterday -> 13 complete months + current month
const STOCKOUT_DAYS = 95; // covers 90-day stockout window + buffer
const FUTURE_DAYS = 14;   // covers 7-day & 14-day demand forecast horizons

const DEMO_DOCTORS = [
  {
    key: "cardio",
    name: "Dr. Nalin Wijesinghe (Demo)",
    specialization: "Cardiology",
    qualifications: "MBBS, MD (Cardiology)",
    fee: 2000,
    phone: "0779000001",
    email: "pred-demo-doc1@clinicconnect.demo",
    experience: "15 years",
    status: "Available",
    // High demand on Mon/Wed/Fri/Sat
    weekdayDemand: [1, 7, 3, 8, 4, 9, 6],
    schedules: [
      { dayOfWeek: 1, startTime: "09:00", endTime: "12:00", maxPatients: 15 },
      { dayOfWeek: 3, startTime: "09:00", endTime: "12:00", maxPatients: 15 },
      { dayOfWeek: 5, startTime: "14:00", endTime: "17:00", maxPatients: 15 },
      { dayOfWeek: 6, startTime: "09:00", endTime: "13:00", maxPatients: 12 },
    ],
  },
  {
    key: "general",
    name: "Dr. Tharushi Senanayake (Demo)",
    specialization: "General Medicine",
    qualifications: "MBBS",
    fee: 1000,
    phone: "0779000002",
    email: "pred-demo-doc2@clinicconnect.demo",
    experience: "8 years",
    status: "Available",
    // Medium demand across weekdays
    weekdayDemand: [0, 5, 4, 5, 4, 6, 3],
    schedules: [
      { dayOfWeek: 1, startTime: "16:00", endTime: "19:00", maxPatients: 12 },
      { dayOfWeek: 2, startTime: "16:00", endTime: "19:00", maxPatients: 12 },
      { dayOfWeek: 3, startTime: "16:00", endTime: "19:00", maxPatients: 12 },
      { dayOfWeek: 4, startTime: "16:00", endTime: "19:00", maxPatients: 12 },
      { dayOfWeek: 5, startTime: "16:00", endTime: "19:00", maxPatients: 12 },
    ],
  },
  {
    key: "derm",
    name: "Dr. Dilshan Jayaweera (Demo)",
    specialization: "Dermatology",
    qualifications: "MBBS, MD (Dermatology)",
    fee: 1500,
    phone: "0779000003",
    email: "pred-demo-doc3@clinicconnect.demo",
    experience: "6 years",
    status: "Available",
    // Lower intermittent demand
    weekdayDemand: [0, 2, 1, 3, 0, 3, 2],
    schedules: [
      { dayOfWeek: 2, startTime: "10:00", endTime: "12:00", maxPatients: 8 },
      { dayOfWeek: 4, startTime: "10:00", endTime: "12:00", maxPatients: 8 },
      { dayOfWeek: 6, startTime: "10:00", endTime: "12:00", maxPatients: 8 },
    ],
  },
];

const DEMO_PATIENTS = [
  { patientId: "P-PRED-DEMO-01", name: "Anura Jayasuriya (Demo)", age: 42, gender: "Male", phone: "0719000001", blood: "O+", address: "10 Baseline Rd, Colombo 09" },
  { patientId: "P-PRED-DEMO-02", name: "Malini Gunasekara (Demo)", age: 54, gender: "Female", phone: "0719000002", blood: "A+", address: "22 High Level Rd, Nugegoda" },
  { patientId: "P-PRED-DEMO-03", name: "Roshan Fernando (Demo)", age: 31, gender: "Male", phone: "0719000003", blood: "B+", address: "5 Galle Rd, Dehiwala" },
  { patientId: "P-PRED-DEMO-04", name: "Sanduni Perera (Demo)", age: 29, gender: "Female", phone: "0719000004", blood: "AB+", address: "88 Kandy Rd, Kelaniya" },
  { patientId: "P-PRED-DEMO-05", name: "Upul Bandara (Demo)", age: 63, gender: "Male", phone: "0719000005", blood: "O-", address: "14 Negombo Rd, Wattala" },
];

function getColomboTodayStartUtc(now = new Date()) {
  const shifted = new Date(now.getTime() + COLOMBO_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      COLOMBO_OFFSET_MS
  );
}

function toColomboYmd(dateUtc) {
  const shifted = new Date(dateUtc.getTime() + COLOMBO_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDemoMedicines(todayStartUtc) {
  return [
    {
      name: "Paracetamol 500mg (Demo)",
      genericName: "Paracetamol",
      manufacturer: "State Pharma",
      category: "Analgesic",
      description: `Demo stock-out medicine (${DEMO_MARKER})`,
      stockQuantity: 180,
      unitType: "tablet",
      unitPrice: 15,
      reorderLevel: 50,
      batchNumber: "PRED-DEMO-M01",
      expiryDate: new Date(todayStartUtc.getTime() + 180 * MS_PER_DAY),
      storageCondition: "Room temperature",
      prescriptionRequired: false,
      weekdayQty: [2, 12, 8, 14, 9, 16, 10],
    },
    {
      name: "Amoxicillin 250mg (Demo)",
      genericName: "Amoxicillin",
      manufacturer: "MedPlus Labs",
      category: "Antibiotic",
      description: `Demo low-stock medicine (${DEMO_MARKER})`,
      stockQuantity: 45,
      unitType: "capsule",
      unitPrice: 45,
      reorderLevel: 40,
      batchNumber: "PRED-DEMO-M02",
      expiryDate: new Date(todayStartUtc.getTime() + 120 * MS_PER_DAY),
      storageCondition: "Cool, dry place",
      prescriptionRequired: true,
      weekdayQty: [1, 8, 5, 9, 6, 11, 5],
    },
    {
      name: "Metformin 500mg (Demo)",
      genericName: "Metformin HCl",
      manufacturer: "State Pharma",
      category: "Antidiabetic",
      description: `Demo critical-stock medicine (${DEMO_MARKER})`,
      stockQuantity: 18,
      unitType: "tablet",
      unitPrice: 30,
      reorderLevel: 30,
      batchNumber: "PRED-DEMO-M03",
      expiryDate: new Date(todayStartUtc.getTime() + 20 * MS_PER_DAY),
      storageCondition: "Room temperature",
      prescriptionRequired: true,
      weekdayQty: [0, 5, 4, 6, 4, 7, 3],
    },
    {
      name: "Cetirizine 10mg (Demo)",
      genericName: "Cetirizine",
      manufacturer: "AllerCare",
      category: "Antihistamine",
      description: `Demo intermittent-demand medicine (${DEMO_MARKER})`,
      stockQuantity: 220,
      unitType: "tablet",
      unitPrice: 10,
      reorderLevel: 30,
      batchNumber: "PRED-DEMO-M04",
      expiryDate: new Date(todayStartUtc.getTime() + 300 * MS_PER_DAY),
      storageCondition: "Room temperature",
      prescriptionRequired: false,
      weekdayQty: [0, 4, 0, 5, 2, 6, 2],
    },
  ];
}

function buildPlan(todayStartUtc) {
  const demoMeds = buildDemoMedicines(todayStartUtc);
  let appointmentCount = 0;
  let completedCount = 0;
  let scheduledCount = 0;
  let cancelledCount = 0;
  let closedSessionCount = 0;
  let openSessionCount = 0;
  let canceledSessionCount = 0;
  let externalRxCount = 0;
  let totalPlannedRevenue = 0;

  // Historical days: [-HISTORY_DAYS .. -1]
  for (let offset = HISTORY_DAYS; offset >= 1; offset -= 1) {
    const dayStartUtc = new Date(todayStartUtc.getTime() - offset * MS_PER_DAY);
    const shifted = new Date(dayStartUtc.getTime() + COLOMBO_OFFSET_MS);
    const weekday = shifted.getUTCDay();
    const monthsAgo = Math.floor(offset / 30);
    // Gentle upward growth over the past 13 months so revenue trend is realistic
    const growthBoost = Math.max(0, Math.floor((13 - monthsAgo) / 4));

    DEMO_DOCTORS.forEach((doc, dIdx) => {
      const base = doc.weekdayDemand[weekday];
      if (base === 0 && (offset + dIdx) % 7 !== 0) return;
      const count = Math.max(0, base + (dIdx === 0 ? growthBoost : 0) - ((offset + dIdx) % 5 === 0 ? 1 : 0));

      for (let k = 0; k < count; k += 1) {
        appointmentCount += 1;
        const isCancelled = (offset + k + dIdx) % 11 === 0;
        if (isCancelled) {
          cancelledCount += 1;
          canceledSessionCount += 1;
        } else {
          completedCount += 1;
          const isUnpaidPending = offset <= 3 && k === 0;
          if (isUnpaidPending) {
            openSessionCount += 1;
          } else {
            closedSessionCount += 1;
            const medCharge = ((offset + k) % 3) * 150;
            totalPlannedRevenue += doc.fee + CENTER_FEE + medCharge;
          }
        }
      }
    });

    // External prescriptions for trailing STOCKOUT_DAYS
    if (offset <= STOCKOUT_DAYS) {
      demoMeds.forEach((med, mIdx) => {
        const baseQty = med.weekdayQty[weekday];
        const isZero = (offset + mIdx * 7) % 13 === 0;
        const qty = isZero ? 0 : Math.max(0, baseQty + ((offset + mIdx) % 4 === 0 ? 2 : 0));
        if (qty > 0) externalRxCount += 1;
      });
    }
  }

  // Upcoming days: [0 .. FUTURE_DAYS - 1]
  for (let offset = 0; offset < FUTURE_DAYS; offset += 1) {
    const dayStartUtc = new Date(todayStartUtc.getTime() + offset * MS_PER_DAY);
    const shifted = new Date(dayStartUtc.getTime() + COLOMBO_OFFSET_MS);
    const weekday = shifted.getUTCDay();

    DEMO_DOCTORS.forEach((doc, dIdx) => {
      const base = doc.weekdayDemand[weekday];
      // Pre-book ~40% of typical demand for upcoming days
      const booked = Math.max(0, Math.floor(base * 0.4) - (offset > 7 ? 1 : 0));
      for (let k = 0; k < booked; k += 1) {
        appointmentCount += 1;
        scheduledCount += 1;
        openSessionCount += 1;
      }
      void dIdx;
    });
  }

  const scheduleCount = DEMO_DOCTORS.reduce((s, d) => s + d.schedules.length, 0);
  const earliestDate = toColomboYmd(new Date(todayStartUtc.getTime() - HISTORY_DAYS * MS_PER_DAY));
  const latestHistDate = toColomboYmd(new Date(todayStartUtc.getTime() - MS_PER_DAY));
  const stockoutEarliest = toColomboYmd(new Date(todayStartUtc.getTime() - STOCKOUT_DAYS * MS_PER_DAY));
  const futureLatest = toColomboYmd(new Date(todayStartUtc.getTime() + (FUTURE_DAYS - 1) * MS_PER_DAY));

  return {
    counts: {
      doctors: DEMO_DOCTORS.length,
      schedules: scheduleCount,
      patients: DEMO_PATIENTS.length,
      medicines: demoMeds.length,
      appointments: appointmentCount,
      appointmentsCompleted: completedCount,
      appointmentsScheduled: scheduledCount,
      appointmentsCancelled: cancelledCount,
      visitSessions: closedSessionCount + openSessionCount + canceledSessionCount,
      visitSessionsClosed: closedSessionCount,
      visitSessionsOpen: openSessionCount,
      visitSessionsCanceled: canceledSessionCount,
      externalPrescriptions: externalRxCount,
    },
    dateRanges: {
      revenueAndAppointmentsHistory: `${earliestDate} to ${latestHistDate} (${HISTORY_DAYS} days)`,
      stockoutDispensingHistory: `${stockoutEarliest} to ${latestHistDate} (${STOCKOUT_DAYS} days)`,
      upcomingAppointments: `${toColomboYmd(todayStartUtc)} to ${futureLatest} (${FUTURE_DAYS} days)`,
    },
    estimatedClosedRevenueLkr: totalPlannedRevenue,
  };
}

async function run() {
  const args = new Set(process.argv.slice(2));
  const isApply = args.has("--apply");
  const mode = isApply ? "APPLY" : "DRY-RUN";

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured in environment.");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: TARGET_DB_NAME,
    serverSelectionTimeoutMS: 10000,
  });

  if (mongoose.connection.name !== TARGET_DB_NAME) {
    throw new Error(`Safety abort: connected to "${mongoose.connection.name}" instead of "${TARGET_DB_NAME}".`);
  }

  const todayStartUtc = getColomboTodayStartUtc(new Date());
  const plan = buildPlan(todayStartUtc);

  const [
    existingDoctors,
    existingSchedules,
    existingPatients,
    existingMedicines,
    existingAppointments,
    existingSessions,
    existingExternalRx,
  ] = await Promise.all([
    Doctor.countDocuments(),
    Schedule.countDocuments(),
    Patient.countDocuments(),
    Medicine.countDocuments(),
    Appointment.countDocuments(),
    VisitSession.countDocuments(),
    ExternalPrescription.countDocuments(),
  ]);

  console.log(`\n=== Prediction Demo Seed (${mode}) ===`);
  console.log(`Target database: ${mongoose.connection.name}`);
  console.log("Existing collection counts:", {
    doctors: existingDoctors,
    schedules: existingSchedules,
    patients: existingPatients,
    medicines: existingMedicines,
    appointments: existingAppointments,
    visitSessions: existingSessions,
    externalPrescriptions: existingExternalRx,
  });
  console.log("Date ranges:", plan.dateRanges);
  console.log("Proposed demo record counts:", plan.counts);
  console.log(`Estimated closed historical revenue (LKR): ${plan.estimatedClosedRevenueLkr}`);

  if (!isApply) {
    console.log("\nDry-run complete. No database writes were performed.");
    console.log("Run with --apply after approval to write to channeling_center_dev.");
    await mongoose.disconnect();
    return;
  }

  // --- APPLY MODE (only when explicitly invoked with --apply) ---
  const demoDocEmails = DEMO_DOCTORS.map((d) => d.email);
  const priorDemoDoctors = await Doctor.find({ email: { $in: demoDocEmails } }, "_id").lean();
  const priorDemoDocIds = priorDemoDoctors.map((d) => d._id);

  // Idempotent cleanup of prior PRED-DEMO records only
  await Promise.all([
    Appointment.deleteMany({ patientId: /^P-PRED-DEMO-/ }),
    VisitSession.deleteMany({ patientId: /^P-PRED-DEMO-/ }),
    ExternalPrescription.deleteMany({ notes: DEMO_MARKER }),
    Schedule.deleteMany({ doctorId: { $in: priorDemoDocIds } }),
  ]);

  const savedDoctors = [];
  for (const { key, weekdayDemand, schedules, ...docFields } of DEMO_DOCTORS) {
    const saved = await Doctor.findOneAndUpdate(
      { email: docFields.email },
      docFields,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    savedDoctors.push({ key, weekdayDemand, schedules, doc: saved });
  }

  const scheduleDocs = [];
  for (const entry of savedDoctors) {
    for (const w of entry.schedules) {
      scheduleDocs.push({ doctorId: entry.doc._id, ...w, status: "Active" });
    }
  }
  if (scheduleDocs.length > 0) await Schedule.insertMany(scheduleDocs);

  for (const p of DEMO_PATIENTS) {
    await Patient.findOneAndUpdate(
      { patientId: p.patientId },
      p,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const demoMedsSpec = buildDemoMedicines(todayStartUtc);
  const savedMeds = [];
  for (const { weekdayQty, ...medFields } of demoMedsSpec) {
    const saved = await Medicine.findOneAndUpdate(
      { batchNumber: medFields.batchNumber },
      medFields,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    savedMeds.push({ weekdayQty, med: saved });
  }

  const appointmentsToInsert = [];
  const sessionsToInsert = [];
  const externalRxToInsert = [];

  for (let offset = HISTORY_DAYS; offset >= 1; offset -= 1) {
    const dayStartUtc = new Date(todayStartUtc.getTime() - offset * MS_PER_DAY);
    const shifted = new Date(dayStartUtc.getTime() + COLOMBO_OFFSET_MS);
    const weekday = shifted.getUTCDay();
    const monthsAgo = Math.floor(offset / 30);
    const growthBoost = Math.max(0, Math.floor((13 - monthsAgo) / 4));
    const apptDateUtcMidnight = new Date(`${toColomboYmd(dayStartUtc)}T00:00:00.000Z`);

    savedDoctors.forEach((dEntry, dIdx) => {
      const base = dEntry.weekdayDemand[weekday];
      if (base === 0 && (offset + dIdx) % 7 !== 0) return;
      const count = Math.max(0, base + (dIdx === 0 ? growthBoost : 0) - ((offset + dIdx) % 5 === 0 ? 1 : 0));

      for (let k = 0; k < count; k += 1) {
        const patient = DEMO_PATIENTS[(offset + k + dIdx) % DEMO_PATIENTS.length];
        const isCancelled = (offset + k + dIdx) % 11 === 0;
        const apptId = new mongoose.Types.ObjectId();
        const sessionId = new mongoose.Types.ObjectId();
        const closedAt = new Date(dayStartUtc.getTime() + (10 + (k % 6)) * 3600 * 1000);

        if (isCancelled) {
          appointmentsToInsert.push({
            _id: apptId,
            patientId: patient.patientId,
            patientName: patient.name,
            doctorId: dEntry.doc._id,
            doctorName: dEntry.doc.name,
            date: apptDateUtcMidnight,
            time: "10:00",
            durationMinutes: 15,
            reason: `Demo consultation (${DEMO_MARKER})`,
            status: "Cancelled",
            visitSessionId: sessionId,
          });
          sessionsToInsert.push({
            _id: sessionId,
            appointmentId: apptId,
            source: "APPOINTMENT",
            patientId: patient.patientId,
            patientName: patient.name,
            doctorId: dEntry.doc._id,
            doctorName: dEntry.doc.name,
            status: "CANCELED",
            lineItems: [],
            payments: [],
            statusHistory: [{ from: null, to: "CANCELED", at: closedAt, by: DEMO_MARKER, reason: "Cancelled appointment" }],
            createdAt: closedAt,
            updatedAt: closedAt,
          });
        } else {
          const isUnpaidPending = offset <= 3 && k === 0;
          const medCharge = ((offset + k) % 3) * 150;
          const lineItems = [
            { type: "DOCTOR_FEE", description: `Consultation — ${dEntry.doc.name}`, qty: 1, unitPrice: dEntry.doc.fee, amount: dEntry.doc.fee, postedAt: closedAt },
            { type: "CENTER_FEE", description: "Channeling center fee", qty: 1, unitPrice: CENTER_FEE, amount: CENTER_FEE, postedAt: closedAt },
          ];
          if (medCharge > 0) {
            lineItems.push({ type: "MEDICATION", description: "Dispensed medication", qty: 1, unitPrice: medCharge, amount: medCharge, postedAt: closedAt });
          }
          const total = lineItems.reduce((s, li) => s + li.amount, 0);

          appointmentsToInsert.push({
            _id: apptId,
            patientId: patient.patientId,
            patientName: patient.name,
            doctorId: dEntry.doc._id,
            doctorName: dEntry.doc.name,
            date: apptDateUtcMidnight,
            time: "10:00",
            durationMinutes: 15,
            reason: `Demo consultation (${DEMO_MARKER})`,
            status: "Completed",
            visitSessionId: sessionId,
          });

          if (isUnpaidPending) {
            sessionsToInsert.push({
              _id: sessionId,
              appointmentId: apptId,
              source: "APPOINTMENT",
              patientId: patient.patientId,
              patientName: patient.name,
              doctorId: dEntry.doc._id,
              doctorName: dEntry.doc.name,
              status: "READY_FOR_PAYMENT",
              lineItems,
              payments: [],
              statusHistory: [{ from: null, to: "READY_FOR_PAYMENT", at: closedAt, by: DEMO_MARKER }],
              createdAt: closedAt,
              updatedAt: closedAt,
            });
          } else {
            sessionsToInsert.push({
              _id: sessionId,
              appointmentId: apptId,
              source: "APPOINTMENT",
              patientId: patient.patientId,
              patientName: patient.name,
              doctorId: dEntry.doc._id,
              doctorName: dEntry.doc.name,
              status: "CLOSED",
              lineItems,
              payments: [{ amount: total, method: "cash", receivedBy: DEMO_MARKER, receivedAt: closedAt }],
              statusHistory: [
                { from: null, to: "OPEN", at: closedAt, by: DEMO_MARKER },
                { from: "OPEN", to: "CLOSED", at: closedAt, by: DEMO_MARKER },
              ],
              createdAt: closedAt,
              updatedAt: closedAt,
            });
          }
        }
      }
    });

    if (offset <= STOCKOUT_DAYS) {
      savedMeds.forEach((mEntry, mIdx) => {
        const baseQty = mEntry.weekdayQty[weekday];
        const isZero = (offset + mIdx * 7) % 13 === 0;
        const qty = isZero ? 0 : Math.max(0, baseQty + ((offset + mIdx) % 4 === 0 ? 2 : 0));
        if (qty <= 0) return;

        const dispensedAt = new Date(dayStartUtc.getTime() + (11 + mIdx) * 3600 * 1000);
        const unitPrice = mEntry.med.unitPrice || 20;
        const amount = qty * unitPrice;
        externalRxToInsert.push({
          source: "EXTERNAL_PRESCRIPTION",
          guestName: `Demo Walk-In (${DEMO_MARKER})`,
          visitSessionId: new mongoose.Types.ObjectId("000000000000000000000000"),
          prescribedBy: "Demo Clinic",
          notes: DEMO_MARKER,
          items: [
            {
              medicineId: mEntry.med._id,
              name: mEntry.med.name,
              qty,
              unitPrice,
              amount,
            },
          ],
          totalAmount: amount,
          dispensedByName: DEMO_MARKER,
          dispensedAt,
        });
      });
    }
  }

  for (let offset = 0; offset < FUTURE_DAYS; offset += 1) {
    const dayStartUtc = new Date(todayStartUtc.getTime() + offset * MS_PER_DAY);
    const shifted = new Date(dayStartUtc.getTime() + COLOMBO_OFFSET_MS);
    const weekday = shifted.getUTCDay();
    const apptDateUtcMidnight = new Date(`${toColomboYmd(dayStartUtc)}T00:00:00.000Z`);

    savedDoctors.forEach((dEntry, dIdx) => {
      const base = dEntry.weekdayDemand[weekday];
      const booked = Math.max(0, Math.floor(base * 0.4) - (offset > 7 ? 1 : 0));
      for (let k = 0; k < booked; k += 1) {
        const patient = DEMO_PATIENTS[(offset + k + dIdx) % DEMO_PATIENTS.length];
        const apptId = new mongoose.Types.ObjectId();
        const sessionId = new mongoose.Types.ObjectId();
        appointmentsToInsert.push({
          _id: apptId,
          patientId: patient.patientId,
          patientName: patient.name,
          doctorId: dEntry.doc._id,
          doctorName: dEntry.doc.name,
          date: apptDateUtcMidnight,
          time: "10:00",
          durationMinutes: 15,
          reason: `Upcoming demo appointment (${DEMO_MARKER})`,
          status: "Scheduled",
          visitSessionId: sessionId,
        });
        sessionsToInsert.push({
          _id: sessionId,
          appointmentId: apptId,
          source: "APPOINTMENT",
          patientId: patient.patientId,
          patientName: patient.name,
          doctorId: dEntry.doc._id,
          doctorName: dEntry.doc.name,
          status: "OPEN",
          lineItems: [],
          payments: [],
          statusHistory: [{ from: null, to: "OPEN", at: new Date(), by: DEMO_MARKER }],
        });
      }
    });
  }

  if (appointmentsToInsert.length > 0) await Appointment.insertMany(appointmentsToInsert);
  if (sessionsToInsert.length > 0) await VisitSession.insertMany(sessionsToInsert);
  if (externalRxToInsert.length > 0) await ExternalPrescription.insertMany(externalRxToInsert);

  console.log("\nApplied demo seed successfully to channeling_center_dev.");
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Seed failed:", err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
