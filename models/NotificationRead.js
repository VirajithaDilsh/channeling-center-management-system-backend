const mongoose = require("mongoose");

const notificationReadSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    alertKey: {
      type: String,
      required: true,
      trim: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

notificationReadSchema.index({ adminId: 1, alertKey: 1 }, { unique: true });

module.exports = mongoose.model("NotificationRead", notificationReadSchema);

