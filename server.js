const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");
const doctorRoutes = require("./routes/doctorRoutes");

require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/doctors", doctorRoutes);
connectDB();

// Use routes
app.use("/api", require("./routes/authRoute"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));