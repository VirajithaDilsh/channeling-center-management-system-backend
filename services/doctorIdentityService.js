const Admin = require("../models/Admin");
const Doctor = require("../models/Doctor");
const Appointment = require("../models/Appointment");

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

// A doctor holding only `doctor_portal` (no *_allow_all/*_read module grant)
// may only reach an appointment/patient they're actually treating. Ownership
// is derived from Appointment.doctorId — the only server-trusted link between
// a doctor and a patient/appointment — never from a client-supplied doctorId.
async function doctorOwnsAppointment(doctorId, appointmentId) {
  if (!doctorId || !appointmentId) return false;
  const appointment = await Appointment.findById(appointmentId).select("doctorId");
  return !!appointment && String(appointment.doctorId) === String(doctorId);
}

async function doctorHasAppointmentWithPatient(doctorId, patientId) {
  if (!doctorId || !patientId) return false;
  return !!(await Appointment.exists({ doctorId, patientId }));
}

module.exports = { resolveDoctorIdentity, doctorOwnsAppointment, doctorHasAppointmentWithPatient };
