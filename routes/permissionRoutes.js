const express = require("express");
const router = express.Router();

const { getPermissionCatalog } = require("../controllers/permissionController");

router.get("/", getPermissionCatalog);

module.exports = router;
