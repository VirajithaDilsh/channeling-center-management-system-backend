const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");
const doctorRoutes = require("./routes/doctorRoutes");
const seedDefaultRoles = require("./utils/seedRoles");


require("dotenv").config();

const medicineRoutes = require("./routes/medicineRoutes"); // import routes

const app = express();

// middleware
app.use(cors());
app.use(express.json());
connectDB().then(() => seedDefaultRoles().catch((err) => console.error("Role seeding failed:", err)));

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

// test route
app.get("/", (req, res) => {
    res.send("API Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
);