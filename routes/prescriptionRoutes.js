const express = require("express");
const router = express.Router();
const prescriptionController = require("../controllers/prescriptionController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.get("/patient/:patientId", prescriptionController.getPrescriptionsByPatient);
router.get("/queue", requirePermission("manage_pharmacy"), prescriptionController.getPharmacyQueue);
router.post("/", requirePermission("doctor_portal"), prescriptionController.createPrescription);

router.post("/:id/items/:itemId/dispense", requirePermission("manage_pharmacy"), prescriptionController.dispenseItem);
router.post("/:id/items/:itemId/reject", requirePermission("manage_pharmacy"), prescriptionController.rejectItem);

module.exports = router;
