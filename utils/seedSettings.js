const SystemSettings = require("../models/SystemSettings");
const { CENTER_FEE } = require("../config/billingConfig");

// Only seeds if the collection is empty, mirroring seedRoles.js. The default
// center fee is seeded from the existing env-driven constant so behavior
// doesn't change for deployments that already set CENTER_FEE.
async function seedSystemSettings() {
  const count = await SystemSettings.estimatedDocumentCount();
  if (count > 0) return;

  await SystemSettings.create({ payments: { centerFee: CENTER_FEE } });
  console.log("Seeded default system settings");
}

module.exports = seedSystemSettings;
