const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // optional timeout
    });
    console.log("Database connected successfully ✅");
  } catch (err) {
    console.error("Database connection failed ❌:", err.message);
    process.exit(1); // Exit process on failure
  }
};

module.exports = connectDB;