const mongoose = require("mongoose");

const medicineSchema = new mongoose.Schema(
    {
        name: String,
        genericName: String,
        manufacturer: String,
        category: String,
        description: String,
        stockQuantity: Number,
        unitType: String,
        unitPrice: Number,
        reorderLevel: Number,
        batchNumber: String,
        expiryDate: Date,
        storageCondition: String,
        prescriptionRequired: Boolean,
    },
    { timestamps: true }
);

module.exports = mongoose.model("Medicine", medicineSchema);