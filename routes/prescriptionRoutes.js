const express = require("express");
const router = express.Router();
const prescriptionController = require("../controllers/prescriptionController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.get("/patient/:patientId", prescriptionController.getPrescriptionsByPatient);
router.get("/queue", requirePermission("pharmacy_read", "pharmacy_allow_all"), prescriptionController.getPharmacyQueue);
router.post("/", requirePermission("doctor_portal"), prescriptionController.createPrescription);

router.post("/:id/items/:itemId/dispense", requirePermission("pharmacy_edit", "pharmacy_allow_all"), prescriptionController.dispenseItem);
router.post("/:id/items/:itemId/reject", requirePermission("pharmacy_edit", "pharmacy_allow_all"), prescriptionController.rejectItem);

module.exports = router;
