const express = require("express");
const router = express.Router();
const appointmentController = require("../controllers/appointmentController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

// doctor_portal alone is scoped to the caller's own appointments inside the
// controller (see doctorIdentityService) — it's not a blanket grant like
// appointments_read/appointments_allow_all.
router.get("/", requirePermission("appointments_read", "appointments_allow_all", "doctor_portal"), appointmentController.getAppointments);
router.get("/:id", requirePermission("appointments_read", "appointments_allow_all", "doctor_portal"), appointmentController.getAppointmentById);
router.post("/", requirePermission("appointments_write", "appointments_allow_all"), appointmentController.createAppointment);
router.put("/:id", requirePermission("appointments_edit", "appointments_allow_all"), appointmentController.updateAppointment);
router.delete("/:id", requirePermission("appointments_edit", "appointments_allow_all"), appointmentController.deleteAppointment);

module.exports = router;
