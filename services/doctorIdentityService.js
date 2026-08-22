const Admin = require("../models/Admin");
const Doctor = require("../models/Doctor");

// Resolves WHICH doctor the authenticated caller is, from the token only.
//
// Anything a doctor authors (consultations, prescriptions) must be attributed
// using this — never a doctorId/doctorName taken from the request body, which
// the client controls and could point at a colleague.
//
// The link is Admin.doctorId, set when the doctor's login account is
// provisioned (see doctorAccountService.js). Mirrors resolveOwnDoctorId in
// doctorController, which resolves the same link for self-service routes.
async function resolveDoctorIdentity(req) {
  const admin = await Admin.findById(req.user?.id);
  if (!admin?.doctorId) return null;

  const doctor = await Doctor.findById(admin.doctorId);
  if (!doctor) return null;

  return { doctorId: doctor._id, doctorName: doctor.name };
}

module.exports = { resolveDoctorIdentity };
