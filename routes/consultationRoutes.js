const express = require("express");
const router = express.Router();
const consultationController = require("../controllers/consultationController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

// Reads are also useful to the patient desk (viewing a patient's clinical
// history), so they allow the patients permissions alongside doctor_portal.
router.get(
  "/by-appointment/:appointmentId",
  requirePermission("doctor_portal", "patients_read", "patients_allow_all"),
  consultationController.getConsultationByAppointment
);

router.get(
  "/patient/:patientId",
  requirePermission("doctor_portal", "patients_read", "patients_allow_all"),
  consultationController.getConsultationsByPatient
);

// Writing a clinical record is the doctor's own act — doctor_portal only, and
// always attributed to the caller's own linked Doctor profile.
router.patch(
  "/by-appointment/:appointmentId",
  requirePermission("doctor_portal"),
  consultationController.saveConsultationDraft
);

router.post(
  "/by-appointment/:appointmentId/complete",
  requirePermission("doctor_portal"),
  consultationController.completeConsultation
);

module.exports = router;
