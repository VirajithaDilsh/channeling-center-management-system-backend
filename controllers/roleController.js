const Role = require("../models/Role");
const { ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS } = require("../constants/permissions");

const PROTECTED_ROLE_NAMES = ["doctor", "admin"];

function validatePermissions(permissions) {
  if (permissions === undefined) return null;
  if (!Array.isArray(permissions)) return "Permissions must be an array";
  const unknown = permissions.filter((p) => !ALL_PERMISSION_KEYS.includes(p));
  if (unknown.length) return `Unknown permission key(s): ${unknown.join(", ")}`;
  return null;
}

// The app relies on doctor/admin always retaining a baseline permission set
// (e.g. Consultation.jsx needs patients_allow_all) — block edits that would
// strip a protected role below what the app actually needs to function.
function validateProtectedRoleBaseline(roleName, permissions) {
  const baseline = DEFAULT_ROLE_PERMISSIONS[roleName.toLowerCase()];
  if (!baseline) return null;
  const missing = baseline.filter((p) => !permissions.includes(p));
  if (missing.length) {
    return `The ${roleName} role must keep these permissions: ${missing.join(", ")}`;
  }
  return null;
}

exports.createRole = async (req, res) => {
  try {
    const error = validatePermissions(req.body.permissions);
    if (error) return res.status(400).json({ message: error });

    const role = new Role(req.body);
    await role.save();
    res.status(201).json(role);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ name: 1 });
    res.json(roles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRoleById = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });
    res.json(role);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const error = validatePermissions(req.body.permissions);
    if (error) return res.status(400).json({ message: error });

    const existingRole = await Role.findById(req.params.id);
    if (!existingRole) return res.status(404).json({ message: "Role not found" });

    if (req.body.permissions !== undefined && PROTECTED_ROLE_NAMES.includes(existingRole.name.toLowerCase())) {
      const baselineError = validateProtectedRoleBaseline(existingRole.name, req.body.permissions);
      if (baselineError) return res.status(400).json({ message: baselineError });
    }

    const role = await Role.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(role);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });

    if (PROTECTED_ROLE_NAMES.includes(role.name.toLowerCase())) {
      return res.status(400).json({ message: `The ${role.name} role cannot be deleted` });
    }

    await role.deleteOne();
    res.json({ message: "Role deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
