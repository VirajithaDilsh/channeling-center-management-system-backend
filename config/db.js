const mongoose = require("mongoose");
const dns = require("dns");

// Force Node.js to use IPv4 first
dns.setDefaultResultOrder("ipv4first");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 3000,
    });

    console.log("Database connected successfully ✅");
  } catch (err) {
    console.error("Database connection failed ❌:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;