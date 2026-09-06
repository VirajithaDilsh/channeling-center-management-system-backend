const express = require("express");
const router = express.Router();
const visitSessionController = require("../controllers/visitSessionController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

// Readable with either pharmacy or billing permissions: it is the billing
// ledger, and a billing-only role previously reached it only because the seeded
// billing role happens to also carry pharmacy_allow_all — so /dashboard/billing
// rendered but never loaded for any custom billing role.
router.get(
  "/",
  requirePermission("pharmacy_read", "pharmacy_allow_all", "billing_read", "billing_allow_all"),
  visitSessionController.listVisitSessions
);
router.get("/by-appointment/:appointmentId", visitSessionController.getVisitSessionByAppointment);
router.get("/:id", visitSessionController.getVisitSession);

router.patch("/:id/finalize-consultation", requirePermission("doctor_portal"), visitSessionController.finalizeConsultation);
router.post("/:id/payments", requirePermission("billing_write", "billing_allow_all"), visitSessionController.addPayment);
router.post("/:id/cancel", requirePermission("pharmacy_edit", "pharmacy_allow_all"), visitSessionController.cancelVisitSession);

module.exports = router;
