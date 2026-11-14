const Medicine = require("../models/Medicine");

const ALLOWED_MEDICINE_FIELDS = [
    "name",
    "genericName",
    "manufacturer",
    "category",
    "description",
    "stockQuantity",
    "unitType",
    "unitPrice",
    "reorderLevel",
    "batchNumber",
    "expiryDate",
    "storageCondition",
    "prescriptionRequired",
];

const NON_NEGATIVE_NUMERIC_FIELDS = [
    { key: "stockQuantity", label: "Stock quantity" },
    { key: "unitPrice", label: "Unit price" },
    { key: "reorderLevel", label: "Reorder level" },
];

function validateExpiryDate(expiryDate) {
    if (expiryDate === undefined || expiryDate === null || expiryDate === "") {
        return null;
    }
    const parsed = new Date(expiryDate);
    if (Number.isNaN(parsed.getTime())) {
        return "Invalid expiry date";
    }
    return null;
}

function sanitizeMedicinePayload(body = {}) {
    const payload = {};
    for (const field of ALLOWED_MEDICINE_FIELDS) {
        if (body[field] !== undefined) {
            payload[field] = body[field];
        }
    }

    const expiryError = validateExpiryDate(payload.expiryDate);
    if (expiryError) {
        return { error: expiryError };
    }

    for (const { key, label } of NON_NEGATIVE_NUMERIC_FIELDS) {
        if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") {
            const num = Number(payload[key]);
            if (!Number.isFinite(num) || num < 0) {
                return { error: `${label} must be a non-negative number` };
            }
            payload[key] = num;
        }
    }

    return { payload };
}

exports.sanitizeMedicinePayload = sanitizeMedicinePayload;

// CREATE
exports.addMedicine = async (req, res) => {
    try {
        const { payload, error } = sanitizeMedicinePayload(req.body);
        if (error) {
            return res.status(400).json({ message: error });
        }
        const medicine = new Medicine(payload);
        const savedMedicine = await medicine.save();
        res.status(201).json(savedMedicine);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// READ
exports.getMedicines = async (req, res) => {
    try {
        const medicines = await Medicine.find();
        res.json(medicines);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// UPDATE
exports.updateMedicine = async (req, res) => {
    try {
        const { payload, error } = sanitizeMedicinePayload(req.body);
        if (error) {
            return res.status(400).json({ message: error });
        }
        const updated = await Medicine.findByIdAndUpdate(
            req.params.id,
            payload,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Medicine not found" });
        }

        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// DELETE
exports.deleteMedicine = async (req, res) => {
    try {
        const deleted = await Medicine.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({ message: "Medicine not found" });
        }

        res.json({ message: "Medicine deleted" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};