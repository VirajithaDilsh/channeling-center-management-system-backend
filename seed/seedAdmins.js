// One-off seed script: creates a default admin plus one test user per role.
// Run with: node seed/seedAdmins.js
require("dotenv").config();
const mongoose = require("mongoose");
const dns = require("dns");
const Admin = require("../models/Admin");

dns.setDefaultResultOrder("ipv4first");

const users = [
  {
    adminId: "A-ADMIN-001",
    name: "Default Admin",
    email: "admin@clinicconnect.com",
    role: "admin",
    contact: "",
    password: "ChangeMe123!",
  },
  {
    adminId: "A-RECEPTION-001",
    name: "Reception Test User",
    email: "reception@clinicconnect.com",
    role: "reception",
    contact: "",
    password: "ChangeMe123!",
  },
  {
    adminId: "A-BILLING-001",
    name: "Billing Test User",
    email: "billing@clinicconnect.com",
    role: "billing",
    contact: "",
    password: "ChangeMe123!",
  },
  {
    adminId: "A-PATIENTMGR-001",
    name: "Patient Manager Test User",
    email: "patientmanager@clinicconnect.com",
    role: "patient_manager",
    contact: "",
    password: "ChangeMe123!",
  },
  {
    adminId: "A-DOCTOR-001",
    name: "Doctor Test User",
    email: "doctor@clinicconnect.com",
    role: "doctor",
    contact: "",
    password: "ChangeMe123!",
  },
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  console.log("Database connected ✅");

  for (const user of users) {
    await Admin.findOneAndUpdate(
      { email: user.email },
      user,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Seeded ${user.role}: ${user.email}`);
  }

  await mongoose.disconnect();
  console.log("Done ✅");
};

run().catch((err) => {
  console.error("Seed failed ❌:", err.message);
  process.exit(1);
});
