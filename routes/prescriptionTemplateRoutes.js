const express = require("express");
const router = express.Router();
const controller = require("../controllers/prescriptionTemplateController");
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

router.use(verifyToken);

// Templates are a doctor's personal library: doctor_portal only, and every
// handler scopes to the caller's own linked Doctor profile.
router.use(requirePermission("doctor_portal"));

router.get("/", controller.listTemplates);
router.post("/", controller.createTemplate);
router.get("/:id", controller.getTemplate);
router.put("/:id", controller.updateTemplate);
router.delete("/:id", controller.deleteTemplate);

module.exports = router;
