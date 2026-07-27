// Comprehensive demo/test data for every feature: logins, doctor profiles,
// patients, pharmacy inventory (including low/out-of-stock items), doctor
// schedules, visit history, and the Unified Patient Ledger in every state
// (OPEN, PENDING_PHARMACY, READY_FOR_PAYMENT, CLOSED, CANCELED) plus the two
// race-condition edge cases from the ledger design (insufficient stock ready
// to trigger, cancel-mid-pharmacy ready to finalize).
//
// Safe to re-run: accounts/doctors/patients/medicines/schedules are upserted;
// the demo appointments/sessions/prescriptions/channeling records (all tied
// to patientId "P-DEMO-*") are wiped and recreated fresh each run so the
// ledger scenarios stay in a known, deterministic state.
//
// Run with: node seed/seedDemoData.js
require("dotenv").config();
const mongoose = require("mongoose");
const dns = require("dns");

dns.setDefaultResultOrder("ipv4first");

const Admin = require("../models/Admin");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Medicine = require("../models/Medicine");
const Schedule = require("../models/Schedule");
const ChannelingRecord = require("../models/ChannelingRecord");
const Appointment = require("../models/Appointment");
const VisitSession = require("../models/VisitSession");
const Prescription = require("../models/Prescription");
const { CENTER_FEE } = require("../config/billingConfig");

const TODAY = "2026-07-26";

const LOGINS = [
  { adminId: "A-ADMIN-001", name: "Default Admin", email: "admin@clinicconnect.com", role: "admin", contact: "", password: "ChangeMe123!" },
  { adminId: "A-RECEPTION-001", name: "Reception Test User", email: "reception@clinicconnect.com", role: "reception", contact: "", password: "ChangeMe123!" },
  { adminId: "A-BILLING-001", name: "Billing Test User", email: "billing@clinicconnect.com", role: "billing", contact: "", password: "ChangeMe123!" },
  { adminId: "A-PATIENTMGR-001", name: "Patient Manager Test User", email: "patientmanager@clinicconnect.com", role: "patient_manager", contact: "", password: "ChangeMe123!" },
  // Email matches the "Dr. Ruwan Silva" Doctor profile below so the doctor
  // portal can resolve which Doctor record this login belongs to.
  { adminId: "A-DOCTOR-001", name: "Doctor Test User", email: "doctor@clinicconnect.com", role: "doctor", contact: "", password: "ChangeMe123!" },
];

const DOCTORS = [
  { key: "silva", name: "Dr. Ruwan Silva", specialization: "General Medicine", qualifications: "MBBS", fee: 800, phone: "0771000001", email: "doctor@clinicconnect.com", experience: "12 years", status: "Active" },
  { key: "perera", name: "Dr. Nadeeka Perera", specialization: "Cardiology", qualifications: "MBBS, MD (Cardiology)", fee: 1500, phone: "0771000002", email: "dr.perera@clinicconnect.demo", experience: "18 years", status: "Active" },
  { key: "fernando", name: "Dr. Amaya Fernando", specialization: "Pediatrics", qualifications: "MBBS, DCH", fee: 1000, phone: "0771000003", email: "dr.fernando@clinicconnect.demo", experience: "9 years", status: "Active" },
  { key: "jayawardena", name: "Dr. Kasun Jayawardena", specialization: "Dermatology", qualifications: "MBBS, MD (Dermatology)", fee: 1200, phone: "0771000004", email: "dr.jayawardena@clinicconnect.demo", experience: "7 years", status: "Active" },
];

const PATIENTS = [
  { patientId: "P-DEMO-001", name: "Kasun Mendis", age: 34, gender: "Male", phone: "0711234001", blood: "O+", address: "12 Galle Road, Colombo 03" },
  { patientId: "P-DEMO-002", name: "Nimali Rathnayake", age: 45, gender: "Female", phone: "0711234002", blood: "A+", address: "45 Kandy Road, Kadawatha" },
  { patientId: "P-DEMO-003", name: "Saman Kumara", age: 61, gender: "Male", phone: "0711234003", blood: "B-", address: "8 Temple Lane, Negombo" },
  { patientId: "P-DEMO-004", name: "Dilani Wickramasinghe", age: 28, gender: "Female", phone: "0711234004", blood: "AB+", address: "23 Lake Road, Nugegoda" },
  { patientId: "P-DEMO-005", name: "Chathura Gunasekara", age: 52, gender: "Male", phone: "0711234005", blood: "O-", address: "67 Station Road, Gampaha" },
];

const MEDICINES = [
  { name: "Paracetamol 500mg", genericName: "Paracetamol", manufacturer: "State Pharma", category: "Analgesic", description: "Fever & pain relief", stockQuantity: 500, unitType: "tablet", unitPrice: 15, reorderLevel: 50, batchNumber: "PCM-2601", expiryDate: new Date("2027-12-31"), storageCondition: "Room temperature", prescriptionRequired: false },
  { name: "Amoxicillin 250mg", genericName: "Amoxicillin", manufacturer: "MedPlus Labs", category: "Antibiotic", description: "Broad-spectrum antibiotic", stockQuantity: 300, unitType: "capsule", unitPrice: 45, reorderLevel: 40, batchNumber: "AMX-2544", expiryDate: new Date("2027-06-30"), storageCondition: "Cool, dry place", prescriptionRequired: true },
  { name: "Metformin 500mg", genericName: "Metformin HCl", manufacturer: "State Pharma", category: "Antidiabetic", description: "Type 2 diabetes management", stockQuantity: 20, unitType: "tablet", unitPrice: 30, reorderLevel: 30, batchNumber: "MET-2519", expiryDate: new Date("2027-03-31"), storageCondition: "Room temperature", prescriptionRequired: true },
  { name: "Atorvastatin 20mg", genericName: "Atorvastatin", manufacturer: "CardioCare", category: "Statin", description: "Cholesterol control", stockQuantity: 150, unitType: "tablet", unitPrice: 60, reorderLevel: 25, batchNumber: "ATV-2602", expiryDate: new Date("2028-01-31"), storageCondition: "Room temperature", prescriptionRequired: true },
  { name: "Cetirizine 10mg", genericName: "Cetirizine", manufacturer: "AllerCare", category: "Antihistamine", description: "Allergy relief", stockQuantity: 0, unitType: "tablet", unitPrice: 10, reorderLevel: 20, batchNumber: "CTZ-2478", expiryDate: new Date("2026-11-30"), storageCondition: "Room temperature", prescriptionRequired: false },
  { name: "Omeprazole 20mg", genericName: "Omeprazole", manufacturer: "GastroLine", category: "PPI", description: "Acid reflux / ulcer treatment", stockQuantity: 200, unitType: "capsule", unitPrice: 35, reorderLevel: 30, batchNumber: "OMZ-2533", expiryDate: new Date("2027-09-30"), storageCondition: "Cool, dry place", prescriptionRequired: true },
  { name: "Salbutamol Inhaler", genericName: "Salbutamol", manufacturer: "RespiCare", category: "Bronchodilator", description: "Asthma relief inhaler", stockQuantity: 40, unitType: "inhaler", unitPrice: 450, reorderLevel: 10, batchNumber: "SAL-2591", expiryDate: new Date("2027-05-31"), storageCondition: "Below 30°C", prescriptionRequired: true },
  { name: "Ibuprofen 400mg", genericName: "Ibuprofen", manufacturer: "MedPlus Labs", category: "NSAID", description: "Pain & inflammation relief", stockQuantity: 250, unitType: "tablet", unitPrice: 20, reorderLevel: 40, batchNumber: "IBU-2567", expiryDate: new Date("2027-08-31"), storageCondition: "Room temperature", prescriptionRequired: false },
];

async function seedLogins() {
  for (const user of LOGINS) {
    await Admin.findOneAndUpdate({ email: user.email }, user, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  console.log(`Seeded ${LOGINS.length} login accounts`);
}

async function seedDoctors() {
  const byKey = {};
  for (const { key, ...doc } of DOCTORS) {
    const saved = await Doctor.findOneAndUpdate({ email: doc.email }, doc, { upsert: true, new: true, setDefaultsOnInsert: true });
    byKey[key] = saved;
  }
  console.log(`Seeded ${DOCTORS.length} doctor profiles`);
  return byKey;
}

async function seedPatients() {
  for (const patient of PATIENTS) {
    await Patient.findOneAndUpdate({ patientId: patient.patientId }, patient, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  console.log(`Seeded ${PATIENTS.length} patients`);
}

async function seedMedicines() {
  const byName = {};
  for (const med of MEDICINES) {
    // Overwritten (not just upserted) each run so demo dispensing scenarios
    // below always start from the same known stock baseline.
    const saved = await Medicine.findOneAndUpdate({ name: med.name, manufacturer: med.manufacturer }, med, { upsert: true, new: true, setDefaultsOnInsert: true });
    byName[med.name] = saved;
  }
  console.log(`Seeded ${MEDICINES.length} medicines (including one low-stock, one out-of-stock)`);
  return byName;
}

async function seedSchedules(doctors) {
  const entries = [
    { doctorId: doctors.silva._id, date: TODAY, startTime: "09:00", endTime: "13:00", maxPatients: 15 },
    { doctorId: doctors.perera._id, date: TODAY, startTime: "14:00", endTime: "17:00", maxPatients: 10 },
    { doctorId: doctors.fernando._id, date: TODAY, startTime: "09:00", endTime: "12:00", maxPatients: 12 },
    { doctorId: doctors.jayawardena._id, date: TODAY, startTime: "10:00", endTime: "14:00", maxPatients: 10 },
  ];
  for (const s of entries) {
    await Schedule.findOneAndUpdate({ doctorId: s.doctorId, date: s.date, startTime: s.startTime }, s, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  console.log(`Seeded ${entries.length} doctor schedules`);
}

async function seedChannelingHistory() {
  const entries = [
    { patientId: "P-DEMO-001", recordedByRole: "doctor", recordedByName: "Dr. Ruwan Silva", doctor: "Dr. Ruwan Silva", disease: "Seasonal flu", medicalHistory: "None significant", bloodPressureSystolic: 118, bloodPressureDiastolic: 76, heartRate: 78, temperature: 37.8, weight: 70, height: 172, cholesterol: 180, sugarLevel: 95, allergies: "None known", notes: "Prescribed rest and paracetamol" },
    { patientId: "P-DEMO-003", recordedByRole: "doctor", recordedByName: "Dr. Ruwan Silva", doctor: "Dr. Ruwan Silva", disease: "Type 2 diabetes - routine review", medicalHistory: "Diagnosed 2021, on Metformin", bloodPressureSystolic: 132, bloodPressureDiastolic: 84, heartRate: 74, temperature: 36.9, weight: 82, height: 168, cholesterol: 210, sugarLevel: 168, allergies: "Penicillin", notes: "Advised diet control, continue medication" },
  ];

  await ChannelingRecord.deleteMany({ patientId: { $in: entries.map((e) => e.patientId) }, notes: { $in: entries.map((e) => e.notes) } });
  await ChannelingRecord.insertMany(entries);
  console.log(`Seeded ${entries.length} channeling history records`);
}

function lineItemsFor(doctorFee, doctorName) {
  return [
    { type: "DOCTOR_FEE", description: `Consultation - Dr. ${doctorName}`, qty: 1, unitPrice: doctorFee, amount: doctorFee },
    { type: "CENTER_FEE", description: "Channeling Center Fee", qty: 1, unitPrice: CENTER_FEE, amount: CENTER_FEE },
  ];
}

async function wipeDemoLedgerData() {
  const demoPatientIds = PATIENTS.map((p) => p.patientId);
  const oldAppointments = await Appointment.find({ patientId: { $in: demoPatientIds } });
  const oldApptIds = oldAppointments.map((a) => a._id);

  await Prescription.deleteMany({ patientId: { $in: demoPatientIds } });
  await VisitSession.deleteMany({ appointmentId: { $in: oldApptIds } });
  await Appointment.deleteMany({ _id: { $in: oldApptIds } });
  console.log("Cleared previous demo appointments/sessions/prescriptions");
}

async function seedLedgerScenarios(doctors, medicines) {
  const scenarios = [];

  // 1. OPEN — booked, doctor hasn't started the consult yet.
  scenarios.push(await buildOpen({
    patientId: "P-DEMO-001", patientName: "Kasun Mendis",
    doctor: doctors.silva, time: "09:00", reason: "Fever and cough",
  }));

  // 2. PENDING_PHARMACY — prescription queued, healthy stock (normal path).
  scenarios.push(await buildPendingPharmacy({
    patientId: "P-DEMO-002", patientName: "Nimali Rathnayake",
    doctor: doctors.perera, time: "09:30", reason: "Chest pain follow-up",
    diagnosis: "Hypertension, mild dyslipidemia",
    items: [
      { medicine: medicines["Atorvastatin 20mg"], qty: 30 },
      { medicine: medicines["Paracetamol 500mg"], qty: 10 },
    ],
  }));

  // 3. PENDING_PHARMACY — prescribed qty (60) exceeds Metformin's seeded
  // stock (20): ready-made to demo the insufficient-stock / partial-dispense
  // edge case at the pharmacy counter.
  scenarios.push(await buildPendingPharmacy({
    patientId: "P-DEMO-003", patientName: "Saman Kumara",
    doctor: doctors.silva, time: "10:00", reason: "Diabetes review",
    diagnosis: "Type 2 diabetes mellitus",
    items: [{ medicine: medicines["Metformin 500mg"], qty: 60 }],
  }));

  // 4. READY_FOR_PAYMENT — doctor finalized with nothing to dispense.
  scenarios.push(await buildReadyForPayment({
    patientId: "P-DEMO-004", patientName: "Dilani Wickramasinghe",
    doctor: doctors.fernando, time: "11:00", reason: "Routine child wellness check",
    appointmentStatus: "Completed",
  }));

  // 5. READY_FOR_PAYMENT — pharmacy already dispensed in full; awaiting cashier.
  scenarios.push(await buildDispensedAwaitingPayment({
    patientId: "P-DEMO-005", patientName: "Chathura Gunasekara",
    doctor: doctors.jayawardena, time: "11:30", reason: "Skin rash",
    diagnosis: "Contact dermatitis",
    items: [{ medicine: medicines["Omeprazole 20mg"], qty: 14 }],
  }));

  // 6. CLOSED — fully paid, for revenue reporting.
  scenarios.push(await buildClosed({
    patientId: "P-DEMO-001", patientName: "Kasun Mendis",
    doctor: doctors.fernando, time: "15:00", reason: "Follow-up consultation",
    diagnosis: "Muscle strain",
    items: [{ medicine: medicines["Ibuprofen 400mg"], qty: 20 }],
  }));

  // 7. CANCELED — canceled while still OPEN (e.g. patient no-show).
  scenarios.push(await buildCanceledOpen({
    patientId: "P-DEMO-004", patientName: "Dilani Wickramasinghe",
    doctor: doctors.perera, time: "16:00", reason: "Cardiology consult (no-show)",
  }));

  // 8. PENDING_PHARMACY with cancellation queued mid-flight — demonstrates
  // the race condition: dispensing this item should be rejected and the
  // session should auto-finalize to CANCELED once resolved.
  scenarios.push(await buildCancelRequestedPendingPharmacy({
    patientId: "P-DEMO-003", patientName: "Saman Kumara",
    doctor: doctors.jayawardena, time: "13:00", reason: "Eczema flare-up",
    diagnosis: "Eczema",
    items: [{ medicine: medicines["Ibuprofen 400mg"], qty: 5 }],
  }));

  console.log(`Seeded ${scenarios.length} visit sessions covering every ledger state`);
}

async function createAppointment({ patientId, patientName, doctor, time, reason, status }) {
  const appointment = new Appointment({
    patientId, patientName, doctorId: doctor._id, doctorName: doctor.name,
    date: new Date(TODAY), time, reason, status: status || "Scheduled",
  });
  await appointment.save();
  return appointment;
}

async function openVisitSession(appointment, doctor) {
  const session = new VisitSession({
    appointmentId: appointment._id,
    patientId: appointment.patientId,
    patientName: appointment.patientName,
    doctorId: doctor._id,
    doctorName: doctor.name,
    status: "OPEN",
    lineItems: lineItemsFor(doctor.fee, doctor.name),
    statusHistory: [{ from: null, to: "OPEN" }],
  });
  await session.save();
  appointment.visitSessionId = session._id;
  await appointment.save();
  return session;
}

async function buildOpen({ patientId, patientName, doctor, time, reason }) {
  const appointment = await createAppointment({ patientId, patientName, doctor, time, reason });
  return openVisitSession(appointment, doctor);
}

function prescriptionItems(items) {
  return items.map(({ medicine, qty }) => ({
    medicineId: medicine._id, name: medicine.name, dosage: "As directed",
    frequency: "BD", duration: "5 days", qtyPrescribed: qty, unitPrice: medicine.unitPrice, status: "QUEUED",
  }));
}

async function buildPendingPharmacy({ patientId, patientName, doctor, time, reason, diagnosis, items }) {
  const appointment = await createAppointment({ patientId, patientName, doctor, time, reason });
  const session = await openVisitSession(appointment, doctor);

  await Prescription.create({
    appointmentId: appointment._id, visitSessionId: session._id,
    patientId, patientName, doctorId: doctor._id, doctorName: doctor.name,
    diagnosis, items: prescriptionItems(items), status: "PENDING",
  });

  session.pushStatus("PENDING_PHARMACY", doctor.name);
  await session.save();
  return session;
}

async function buildCancelRequestedPendingPharmacy(opts) {
  const session = await buildPendingPharmacy(opts);
  session.cancelRequested = true;
  await session.save();
  return session;
}

async function buildReadyForPayment({ patientId, patientName, doctor, time, reason, appointmentStatus }) {
  const appointment = await createAppointment({ patientId, patientName, doctor, time, reason, status: appointmentStatus });
  const session = await openVisitSession(appointment, doctor);
  session.pushStatus("READY_FOR_PAYMENT", doctor.name);
  await session.save();
  return session;
}

async function buildDispensedAwaitingPayment({ patientId, patientName, doctor, time, reason, diagnosis, items }) {
  const appointment = await createAppointment({ patientId, patientName, doctor, time, reason, status: "Completed" });
  const session = await openVisitSession(appointment, doctor);

  const rxItems = prescriptionItems(items);
  for (const item of rxItems) {
    item.status = "DISPENSED";
    item.qtyDispensed = item.qtyPrescribed;
    session.lineItems.push({ type: "MEDICATION", description: item.name, qty: item.qtyDispensed, unitPrice: item.unitPrice, amount: item.qtyDispensed * item.unitPrice, refId: item._id });
  }
  await Prescription.create({
    appointmentId: appointment._id, visitSessionId: session._id,
    patientId, patientName, doctorId: doctor._id, doctorName: doctor.name,
    diagnosis, items: rxItems, status: "RESOLVED",
  });
  for (const { medicine, qty } of items) {
    await Medicine.findByIdAndUpdate(medicine._id, { $inc: { stockQuantity: -qty } });
  }

  session.pushStatus("PENDING_PHARMACY", doctor.name);
  session.pushStatus("READY_FOR_PAYMENT", doctor.name);
  await session.save();
  return session;
}

async function buildClosed(opts) {
  const session = await buildDispensedAwaitingPayment(opts);
  const total = session.totalDue();
  session.payments.push({ amount: total, method: "cash", receivedBy: "Billing Test User" });
  session.pushStatus("CLOSED", "Billing Test User");
  await session.save();
  return session;
}

async function buildCanceledOpen({ patientId, patientName, doctor, time, reason }) {
  const appointment = await createAppointment({ patientId, patientName, doctor, time, reason, status: "Cancelled" });
  const session = await openVisitSession(appointment, doctor);
  session.pushStatus("CANCELED", "Reception Test User", "Patient no-show");
  await session.save();
  return session;
}

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Database connected ✅");

  await seedLogins();
  const doctors = await seedDoctors();
  await seedPatients();
  const medicines = await seedMedicines();
  await seedSchedules(doctors);
  await seedChannelingHistory();
  await wipeDemoLedgerData();
  await seedLedgerScenarios(doctors, medicines);

  await mongoose.disconnect();
  console.log("Done ✅ — demo data ready across logins, doctors, patients, inventory, and the full patient ledger.");
};

run().catch((err) => {
  console.error("Seed failed ❌:", err);
  process.exit(1);
});
