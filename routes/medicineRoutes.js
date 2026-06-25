const express = require("express");
const router = express.Router();
const Medicine = require("../models/Medicine");

router.post("/", async (req, res) => {
    try {
        const medicine = new Medicine(req.body);
        const saved = await medicine.save();
        res.status(201).json(saved);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get("/", async (req, res) => {
    const medicines = await Medicine.find();
    res.json(medicines);
});

module.exports = router;