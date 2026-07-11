const express = require("express");
const router = express.Router();

const {
  createAdmin,
  getAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin
} = require("../controllers/adminController");

router.post("/", createAdmin);

router.get("/", getAdmins);

router.get("/:id", getAdminById);

router.put("/:id", updateAdmin);

router.delete("/:id", deleteAdmin);

module.exports = router;
