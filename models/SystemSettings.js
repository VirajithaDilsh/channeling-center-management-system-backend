const mongoose = require("mongoose");

// Singleton document — there is only ever one SystemSettings row, fetched via
// getSingleton()/updateSingleton() below rather than by id.
const systemSettingsSchema = new mongoose.Schema(
  {
    general: {
      centerName: { type: String, default: "ClinicConnect" },
      contactNumber: { type: String, default: "" },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
      website: { type: String, default: "" },
      logoUrl: { type: String, default: "" },
    },
    appointments: {
      defaultDurationMinutes: { type: Number, default: 30, min: 5 },
      maxAdvanceBookingDays: { type: Number, default: 60, min: 1 },
      cancellationWindowHours: { type: Number, default: 2, min: 0 },
    },
    payments: {
      currencySymbol: { type: String, default: "Rs." },
      centerFee: { type: Number, default: 300, min: 0 },
      enabledPaymentMethods: {
        type: [String],
        enum: ["cash", "card", "insurance"],
        default: ["cash", "card", "insurance"],
      },
    },
    doctorDefaults: {
      defaultConsultationDurationMinutes: { type: Number, default: 15, min: 5 },
    },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

systemSettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({});
  return doc;
};

module.exports = mongoose.model("SystemSettings", systemSettingsSchema);
