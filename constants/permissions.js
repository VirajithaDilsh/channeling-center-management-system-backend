const PERMISSIONS = [
  { key: "manage_admins", label: "Manage Admins & Roles", module: "Admin" },
  { key: "view_doctors", label: "View & Manage Doctors", module: "Doctors" },
  { key: "manage_patients", label: "Manage Patients", module: "Patients" },
  { key: "view_appointments", label: "View Appointments", module: "Appointments" },
  { key: "manage_inventory", label: "Manage Inventory", module: "Inventory" },
  { key: "manage_pharmacy", label: "Manage Pharmacy Queue", module: "Pharmacy" },
  { key: "manage_billing", label: "Manage Billing & Payments", module: "Billing" },
  { key: "view_reports", label: "View Reports", module: "Reports" },
  { key: "doctor_portal", label: "Doctor Portal (Consultations & Prescriptions)", module: "Doctor Portal" },
];

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const DEFAULT_ROLE_PERMISSIONS = {
  admin: ALL_PERMISSION_KEYS,
  doctor: ["manage_patients", "doctor_portal"],
  patient_manager: [
    "view_doctors",
    "manage_patients",
    "view_appointments",
    "manage_inventory",
    "manage_pharmacy",
    "view_reports",
  ],
  billing: [
    "view_doctors",
    "view_appointments",
    "manage_inventory",
    "manage_pharmacy",
    "manage_billing",
    "view_reports",
  ],
  reception: ["view_doctors", "view_appointments"],
};

module.exports = { PERMISSIONS, ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS };
