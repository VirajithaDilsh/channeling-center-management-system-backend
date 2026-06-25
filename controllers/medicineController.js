const Medicine = require("../models/Medicine");

// CREATE
exports.addMedicine = async (req, res) => {
    try {
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