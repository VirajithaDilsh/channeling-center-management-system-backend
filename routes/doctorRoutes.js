const express = require("express");
const router = express.Router();

const {
  createDoctor,
  getDoctors,
  getDoctorById,
  updateDoctor,
  deleteDoctor,
  getSchedulesByDoctor,  // 👈 add these
  createSchedule,
  updateSchedule,
  deleteSchedule
} = require("../controllers/doctorController");



// Doctor routes
router.post("/", createDoctor);
router.get("/", getDoctors);
router.get("/:id", getDoctorById);
router.put("/:id", updateDoctor);
router.delete("/:id", deleteDoctor);


// Schedule routes
router.get("/:doctorId/schedules", getSchedulesByDoctor);  // 👈 get schedules for a doctor
router.post("/schedules", createSchedule);                  // 👈 add schedule
router.put("/schedules/:id", updateSchedule);               // 👈 update schedule
router.delete("/schedules/:id", deleteSchedule);            // 👈 delete schedule



module.exports = router;