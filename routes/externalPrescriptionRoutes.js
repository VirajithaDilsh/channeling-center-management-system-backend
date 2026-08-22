const express = require("express");
const router = express.Router();
const externalPrescriptionController = require("../controllers/externalPrescriptionController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

// Same permission split as the doctor-prescription dispense path: reading the
// log needs pharmacy_read, moving stock and posting charges needs pharmacy_edit.
router.get(
  "/",
  requirePermission("pharmacy_read", "pharmacy_allow_all"),
  externalPrescriptionController.listExternalPrescriptions
);

router.post(
  "/",
  requirePermission("pharmacy_edit", "pharmacy_allow_all"),
  externalPrescriptionController.createExternalPrescription
);

module.exports = router;
