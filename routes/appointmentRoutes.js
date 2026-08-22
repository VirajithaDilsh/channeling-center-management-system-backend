const express = require("express");
const router = express.Router();
const appointmentController = require("../controllers/appointmentController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.get("/", requirePermission("appointments_read", "appointments_allow_all"), appointmentController.getAppointments);
router.post("/", requirePermission("appointments_write", "appointments_allow_all"), appointmentController.createAppointment);
router.put("/:id", requirePermission("appointments_edit", "appointments_allow_all"), appointmentController.updateAppointment);
router.delete("/:id", requirePermission("appointments_edit", "appointments_allow_all"), appointmentController.deleteAppointment);

module.exports = router;
