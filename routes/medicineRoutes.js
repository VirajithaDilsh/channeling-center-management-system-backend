const express = require("express");
const {
    addMedicine,
    getMedicines,
    updateMedicine,
    deleteMedicine,
    getStockoutPredictions
} = require("../controllers/medicineController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(verifyToken);

router.post("/", requirePermission("inventory_write", "inventory_allow_all"), addMedicine);
router.get("/", requirePermission("inventory_read", "inventory_allow_all"), getMedicines);
router.get("/stockout-predictions", requirePermission("inventory_read", "inventory_allow_all"), getStockoutPredictions);
router.put("/:id", requirePermission("inventory_edit", "inventory_allow_all"), updateMedicine);
router.delete("/:id", requirePermission("inventory_edit", "inventory_allow_all"), deleteMedicine);

module.exports = router;
