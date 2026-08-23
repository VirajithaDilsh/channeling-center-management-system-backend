// Load env vars before anything else requires them: config/billingConfig.js
// reads process.env at module load time, so a later dotenv call is too late.
require("dotenv").config();

for (const key of ["MONGO_URI", "JWT_SECRET"]) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key} - copy .env.example to .env`);
    process.exit(1);
  }
}

const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");
const doctorRoutes = require("./routes/doctorRoutes");
const seedDefaultRoles = require("./utils/seedRoles");
const migrateRolePermissions = require("./utils/migratePermissions");
const syncAdminPermissions = require("./utils/syncAdminPermissions");
const seedSystemSettings = require("./utils/seedSettings");

const medicineRoutes = require("./routes/medicineRoutes"); // import routes

const app = express();

// middleware
app.use(cors());
app.use(express.json());
connectDB().then(() =>
  seedDefaultRoles()
    .then(() => migrateRolePermissions())
    .then(() => syncAdminPermissions())
    .then(() => seedSystemSettings())
    .catch((err) => console.error("Role seeding/migration failed:", err))
);

// routes
app.use("/api", require("./routes/authRoute"));
app.use('/patient', require("./routes/patientRoute"));
app.use('/patient', require("./routes/channelingRoute"));
app.use("/api/medicines", medicineRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/roles", require("./routes/roleRoutes"));
app.use("/api/permissions", require("./routes/permissionRoutes"));
app.use("/api/appointments", require("./routes/appointmentRoutes"));
app.use("/api/visit-sessions", require("./routes/visitSessionRoutes"));
app.use("/api/prescriptions", require("./routes/prescriptionRoutes"));
app.use("/api/consultations", require("./routes/consultationRoutes"));
app.use("/api/external-prescriptions", require("./routes/externalPrescriptionRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));

// test route
app.get("/", (req, res) => {
    res.send("API Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
);