const { PERMISSIONS } = require("../constants/permissions");

exports.getPermissionCatalog = async (req, res) => {
  res.json(PERMISSIONS);
};
