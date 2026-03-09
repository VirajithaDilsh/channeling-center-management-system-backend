const express = require("express");
const router = express.Router();

const {
  createDoctor,
  getDoctors,
  getDoctorById,
  updateDoctor,
  deleteDoctor,
  addDoctor
} = require("../controllers/doctorController");



router.post("/", createDoctor);

router.get("/", getDoctors);

router.get("/:id", getDoctorById);

router.put("/:id", updateDoctor);

router.delete("/:id", deleteDoctor);

router.post("/", addDoctor);


module.exports = router;