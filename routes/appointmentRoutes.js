const express = require("express");
const router = express.Router();
const appointmentController = require("../controllers/appointmentController");
const { verifyToken } = require("../middleware/authMiddleware");

router.use(verifyToken);

router.get("/", appointmentController.getAppointments);
router.post("/", appointmentController.createAppointment);
router.put("/:id", appointmentController.updateAppointment);
router.delete("/:id", appointmentController.deleteAppointment);

module.exports = router;
