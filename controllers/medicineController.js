import Medicine from "../models/Medicine.js";

export const addMedicine = async (req, res) => {
    try {
        const medicine = new Medicine(req.body);

        const savedMedicine = await medicine.save();

        res.status(201).json(savedMedicine);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getMedicines = async (req, res) => {
    try {
        const medicines = await Medicine.find();

        res.json(medicines);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteMedicine = async (req, res) => {
    try {
        await Medicine.findByIdAndDelete(req.params.id);

        res.json({ message: "Medicine deleted" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};