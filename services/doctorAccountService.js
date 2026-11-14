const mongoose = require("mongoose");
const Admin = require("../models/Admin");
const Doctor = require("../models/Doctor");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Shared by adminController.createAdmin (Add User -> role: doctor) and
// doctorController.createDoctor (Doctor page -> Add Doctor), so both flows
// create the same Doctor profile + Admin login account, linked together.
exports.createDoctorAccount = async ({ name, email, password, phone, specialization, qualifications, fee, experience, status }) => {
  if (!name || !email || !password || !specialization || !fee) {
    throw new HttpError(400, "Name, email, password, specialization and fee are required");
  }

  const existing = await Admin.findOne({ email });
  if (existing) {
    throw new HttpError(400, "An account with this email already exists");
  }

  const dbSession = await mongoose.startSession();
  try {
    let result;
    await dbSession.withTransaction(async () => {
      const [doctor] = await Doctor.create(
        [{ name, specialization, qualifications, fee, phone, email, experience, status }],
        { session: dbSession }
      );

      const [admin] = await Admin.create(
        [{
          adminId: `A-DOC-${Date.now()}`,
          name,
          email,
          role: "doctor",
          contact: phone,
          password,
          doctorId: doctor._id,
        }],
        { session: dbSession }
      );

      doctor.userId = admin._id;
      await doctor.save({ session: dbSession });

      const adminObj = admin.toObject();
      delete adminObj.password;
      result = { doctor, admin: adminObj };
    });
    return result;
  } finally {
    dbSession.endSession();
  }
};

// Admin-set password for a doctor's login. Resets the password when the doctor
// already has an account, otherwise creates the account with it. The caller
// never sees an existing password (only the bcrypt hash is stored).
exports.setDoctorPassword = async (doctorId, password) => {
  if (typeof password !== "string" || password.length < 6) {
    throw new HttpError(400, "Password must be at least 6 characters");
  }

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) throw new HttpError(404, "Doctor not found");

  // Admin.doctorId is authoritative; Doctor.userId can be missing on legacy data.
  const account = await Admin.findOne({ doctorId: doctor._id });
  if (account) {
    // Assign + save so the pre("save") hook hashes it (updateOne would skip it).
    account.password = password;
    await account.save();
    return { created: false };
  }

  if (!doctor.email) {
    throw new HttpError(400, "Add an email to this doctor first, then set a password");
  }
  if (await Admin.findOne({ email: doctor.email })) {
    throw new HttpError(400, "Another account already uses this doctor's email");
  }

  const admin = await Admin.create({
    adminId: `A-DOC-${Date.now()}`,
    name: doctor.name,
    email: doctor.email,
    role: "doctor",
    contact: doctor.phone,
    password,
    doctorId: doctor._id,
  });
  doctor.userId = admin._id;
  await doctor.save();
  return { created: true };
};

exports.HttpError = HttpError;
