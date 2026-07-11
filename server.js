const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");
const doctorRoutes = require("./routes/doctorRoutes");


require("dotenv").config();

const medicineRoutes = require("./routes/medicineRoutes"); // import routes

const app = express();

// middleware
app.use(cors());
app.use(express.json());
connectDB();

// routes
app.use("/api", require("./routes/authRoute"));
app.use('/patient', require("./routes/patientRoute"));
app.use("/api/medicines", medicineRoutes);
app.use("/api/doctors", doctorRoutes);

// test route
app.get("/", (req, res) => {
    res.send("API Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
);