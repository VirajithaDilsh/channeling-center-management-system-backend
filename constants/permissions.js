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
  // patients_allow_all/appointments_allow_all/doctors_read/inventory_read:
  // Consultation.jsx and DoctorHome.jsx call getAppointments/updateAppointment/
  // getMedicines/getDoctors directly, so the doctor role needs read access to
  // all of those, not just the doctor_portal gate itself.
  doctor: ["patients_allow_all", "appointments_allow_all", "doctors_read", "inventory_read", "doctor_portal"],
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
