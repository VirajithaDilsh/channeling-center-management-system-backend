const Medicine = require("../models/Medicine");

function validateExpiryDate(expiryDate, { required = false } = {}) {
    if (expiryDate === undefined || expiryDate === null || expiryDate === "") {
        return required ? "Expiry date is required" : null;
    }
    const parsed = new Date(expiryDate);
    if (Number.isNaN(parsed.getTime())) {
        return "Invalid expiry date";
    }
    return null;
}

// CREATE
exports.addMedicine = async (req, res) => {
    try {
        const expiryError = validateExpiryDate(req.body.expiryDate, { required: true });
        if (expiryError) {
            return res.status(400).json({ message: expiryError });
        }
        const medicine = new Medicine(req.body);
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
        // Expiry date is mandatory: reject an update that blanks it out.
        const expiryError = "expiryDate" in req.body
            ? validateExpiryDate(req.body.expiryDate, { required: true })
            : null;
        if (expiryError) {
            return res.status(400).json({ message: expiryError });
        }
        const updated = await Medicine.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
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