const express = require("express");
const router = express.Router();
const visitSessionController = require("../controllers/visitSessionController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.get("/", requirePermission("manage_pharmacy"), visitSessionController.listVisitSessions);
router.get("/by-appointment/:appointmentId", visitSessionController.getVisitSessionByAppointment);
router.get("/:id", visitSessionController.getVisitSession);

router.patch("/:id/finalize-consultation", requirePermission("doctor_portal"), visitSessionController.finalizeConsultation);
router.post("/:id/payments", requirePermission("manage_billing"), visitSessionController.addPayment);
router.post("/:id/cancel", requirePermission("manage_pharmacy"), visitSessionController.cancelVisitSession);

module.exports = router;
