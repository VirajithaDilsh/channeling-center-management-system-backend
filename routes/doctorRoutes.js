const express = require("express");
const router = express.Router();
const { verifyToken, requirePermission } = require("../middleware/authMiddleware");

const {
  createDoctor,
  getDoctors,
  getDoctorById,
  updateDoctor,
  deleteDoctor,
  getSchedulesByDoctor,  // 👈 add these
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getMyProfile,
  updateMyProfile,
  getMySchedules,
  createMySchedule,
  updateMySchedule,
  deleteMySchedule
} = require("../controllers/doctorController");

router.use(verifyToken);

// Doctor self-service (Settings page) — must be registered before "/:id" and
// "/:doctorId/schedules" below, since "me" would otherwise be matched as a
// doctor id. Gated by doctor_portal only, and always scoped server-side to
// the caller's own doctorId (see resolveOwnDoctorId in the controller) so a
// doctor can never touch another doctor's profile or schedule.
router.get("/me", requirePermission("doctor_portal"), getMyProfile);
router.patch("/me", requirePermission("doctor_portal"), updateMyProfile);
router.get("/me/schedules", requirePermission("doctor_portal"), getMySchedules);
router.post("/me/schedules", requirePermission("doctor_portal"), createMySchedule);
router.put("/me/schedules/:id", requirePermission("doctor_portal"), updateMySchedule);
router.delete("/me/schedules/:id", requirePermission("doctor_portal"), deleteMySchedule);

// Doctor routes
router.post("/", requirePermission("doctors_write", "doctors_allow_all"), createDoctor);
router.get("/", requirePermission("doctors_read", "doctors_allow_all"), getDoctors);
router.get("/:id", requirePermission("doctors_read", "doctors_allow_all"), getDoctorById);
router.put("/:id", requirePermission("doctors_edit", "doctors_allow_all"), updateDoctor);
router.delete("/:id", requirePermission("doctors_edit", "doctors_allow_all"), deleteDoctor);


// Schedule routes
router.get("/:doctorId/schedules", requirePermission("doctors_read", "doctors_allow_all"), getSchedulesByDoctor);  // 👈 get schedules for a doctor
router.post("/schedules", requirePermission("doctors_write", "doctors_allow_all"), createSchedule);                  // 👈 add schedule
router.put("/schedules/:id", requirePermission("doctors_edit", "doctors_allow_all"), updateSchedule);               // 👈 update schedule
router.delete("/schedules/:id", requirePermission("doctors_edit", "doctors_allow_all"), deleteSchedule);            // 👈 delete schedule



module.exports = router;
