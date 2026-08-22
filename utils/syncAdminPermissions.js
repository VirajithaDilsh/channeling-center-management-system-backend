const Role = require("../models/Role");
const { ALL_PERMISSION_KEYS } = require("../constants/permissions");

// migratePermissions.js only rewrites roles still holding legacy flat keys,
// so it doesn't catch roles that were already migrated once but are now
// missing keys from a module added to MODULES afterwards (e.g. "settings").
// The admin role's documented invariant is "always ALL_PERMISSION_KEYS", so
// self-heal it on every boot rather than requiring a one-off migration per
// new module.
async function syncAdminPermissions() {
  const adminRole = await Role.findOne({ name: "admin" });
  if (!adminRole) return;

  const missing = ALL_PERMISSION_KEYS.filter((key) => !adminRole.permissions.includes(key));
  if (missing.length === 0) return;

  adminRole.permissions = ALL_PERMISSION_KEYS;
  await adminRole.save();
  console.log(`Synced admin role with ${missing.length} new permission key(s): ${missing.join(", ")}`);
}

module.exports = syncAdminPermissions;
