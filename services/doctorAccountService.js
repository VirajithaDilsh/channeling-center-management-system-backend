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

exports.HttpError = HttpError;
