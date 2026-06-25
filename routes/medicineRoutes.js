const express = require("express");
const {
    addMedicine,
    getMedicines,
    updateMedicine,
    deleteMedicine
} = require("../controllers/medicineController");

const router = express.Router();

router.post("/", addMedicine);
router.get("/", getMedicines);
router.put("/:id", updateMedicine);
router.delete("/:id", deleteMedicine);

module.exports = router;