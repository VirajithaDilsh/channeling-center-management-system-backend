const Role = require("../models/Role");
const { ALL_PERMISSION_KEYS } = require("../constants/permissions");

// Translates legacy flat permission keys (pre read/write/edit/allow_all scheme)
// into the new per-module keys. seedRoles.js only seeds an empty collection,
// so this is what actually updates already-seeded Role documents.
//
// view_doctors -> doctors_allow_all (not just _read): the original catalog
// labeled this key "View & Manage Doctors", and with no backend enforcement
// ever in place, patient_manager/billing could already fully manage doctors
// via the Doctor Management page. view_appointments -> appointments_allow_all
// for the same reason: there was never a separate "manage appointments" key,
// and booking (AddAppointment.jsx) lives inside the same page these roles
// already access. Narrowing either to read-only here would be a regression,
// not a fix.
const LEGACY_TO_NEW = {
  manage_admins: ["admin_allow_all"],
  view_doctors: ["doctors_allow_all"],
  manage_patients: ["patients_allow_all"],
  view_appointments: ["appointments_allow_all"],
  manage_inventory: ["inventory_allow_all"],
  manage_pharmacy: ["pharmacy_allow_all"],
  manage_billing: ["billing_allow_all"],
  view_reports: ["reports_read"],
};

// inventory_read had no legacy key guarding it either (the medicine picker in
// the prescription flow), so there's nothing in LEGACY_TO_NEW to translate it
// from. Union it in by role name after translation so an existing seeded
// doctor role ends up with the same baseline DEFAULT_ROLE_PERMISSIONS grants
// a fresh database. Deliberately doesn't include appointments_allow_all/
// doctors_read — a doctor is scoped to their own appointments/patients
// server-side (see doctorIdentityService), not given blanket module access.
const ROLE_SUPPLEMENTS = {
  doctor: ["inventory_read"],
};

async function migrateRolePermissions() {
  const roles = await Role.find({ permissions: { $in: Object.keys(LEGACY_TO_NEW) } });
  for (const role of roles) {
    if (role.name === "admin") {
      role.permissions = ALL_PERMISSION_KEYS;
    } else {
      const next = new Set();
      role.permissions.forEach((perm) => (LEGACY_TO_NEW[perm] || [perm]).forEach((key) => next.add(key)));
      (ROLE_SUPPLEMENTS[role.name] || []).forEach((key) => next.add(key));
      role.permissions = [...next];
    }
    await role.save();
  }
  if (roles.length) {
    console.log(`Migrated permission keys for ${roles.length} role(s)`);
  }
}

module.exports = migrateRolePermissions;
