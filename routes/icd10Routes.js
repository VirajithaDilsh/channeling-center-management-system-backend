const express = require("express");
const router = express.Router();
const icd10Controller = require("../controllers/icd10Controller");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

// Read-only shared catalog — same grants as reading consultations.
router.get(
  "/",
  requirePermission("doctor_portal", "patients_read", "patients_allow_all"),
  icd10Controller.searchIcd10
);

module.exports = router;
