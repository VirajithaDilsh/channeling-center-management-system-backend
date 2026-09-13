const MODULES = [
  { slug: "admin", label: "Admin" },
  { slug: "doctors", label: "Doctors" },
  { slug: "patients", label: "Patients" },
  { slug: "appointments", label: "Appointments" },
  { slug: "inventory", label: "Inventory" },
  { slug: "pharmacy", label: "Pharmacy" },
  { slug: "billing", label: "Billing" },
  { slug: "reports", label: "Reports" },
  { slug: "settings", label: "Settings" },
];

const ACTIONS = [
  { suffix: "read", label: "Read" },
  { suffix: "write", label: "Write" },
  { suffix: "edit", label: "Edit" },
  { suffix: "allow_all", label: "Allow All" },
];

const PERMISSIONS = [
  ...MODULES.flatMap((m) =>
    ACTIONS.map((a) => ({
      key: `${m.slug}_${a.suffix}`,
      label: `${a.label} — ${m.label}`,
      module: m.label,
      action: a.suffix,
    }))
  ),
  {
    key: "doctor_portal",
    label: "Doctor Portal (Consultations & Prescriptions)",
    module: "Doctor Portal",
    action: "access",
  },
];

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const DEFAULT_ROLE_PERMISSIONS = {
  admin: ALL_PERMISSION_KEYS,
  // A doctor should not browse every patient/appointment/doctor in the
  // system — only doctor_portal is granted, which controllers scope to the
  // caller's own appointments/patients server-side (see doctorIdentityService
  // and getAppointments/getPatientById/getChannelingHistory/consultation
  // reads). inventory_read stays for the prescription medicine picker
  // (getMedicines) — that's a shared catalog, not patient data. A specific
  // doctor can still be granted patients_read/appointments_allow_all/etc. via
  // Role Management for broader access when actually needed.
  doctor: ["inventory_read", "doctor_portal"],
  patient_manager: [
    "doctors_allow_all",
    "patients_allow_all",
    "appointments_allow_all",
    "inventory_allow_all",
    "pharmacy_allow_all",
    "reports_read",
  ],
  billing: [
    "doctors_allow_all",
    "appointments_allow_all",
    "inventory_allow_all",
    "pharmacy_allow_all",
    "billing_allow_all",
    "reports_read",
  ],
  reception: ["doctors_read", "appointments_read"],
};

module.exports = { MODULES, ACTIONS, PERMISSIONS, ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS };
