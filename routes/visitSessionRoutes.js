const express = require("express");
const router = express.Router();
const visitSessionController = require("../controllers/visitSessionController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.get("/", requirePermission("pharmacy_read", "pharmacy_allow_all"), visitSessionController.listVisitSessions);
router.get("/by-appointment/:appointmentId", visitSessionController.getVisitSessionByAppointment);
router.get("/:id", visitSessionController.getVisitSession);

router.patch("/:id/finalize-consultation", requirePermission("doctor_portal"), visitSessionController.finalizeConsultation);
router.post("/:id/payments", requirePermission("billing_write", "billing_allow_all"), visitSessionController.addPayment);
router.post("/:id/cancel", requirePermission("pharmacy_edit", "pharmacy_allow_all"), visitSessionController.cancelVisitSession);

module.exports = router;
