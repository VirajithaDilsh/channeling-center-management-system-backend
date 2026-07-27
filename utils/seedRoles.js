const Role = require("../models/Role");
const { DEFAULT_ROLE_PERMISSIONS } = require("../constants/permissions");

async function seedDefaultRoles() {
  const count = await Role.estimatedDocumentCount();
  if (count > 0) return;

  const defaults = Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([name, permissions]) => ({
    name,
    permissions,
  }));

  await Role.insertMany(defaults);
  console.log("Seeded default roles:", defaults.map((r) => r.name).join(", "));
}

module.exports = seedDefaultRoles;
