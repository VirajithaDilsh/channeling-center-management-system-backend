const test = require("node:test");
const assert = require("node:assert/strict");

const authController = require("../controllers/authController");
const doctorController = require("../controllers/doctorController");
const medicineController = require("../controllers/medicineController");
const Doctor = require("../models/Doctor");
const Medicine = require("../models/Medicine");

function mockRes() {
  let statusCode = 200;
  let responseData = null;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get data() {
      return responseData;
    },
  };
}

test("authController.login rejects non-string and missing email/password (NoSQL injection guard)", async () => {
  const badInputs = [
    { email: { $gt: "" }, password: "123" },
    { email: "admin@test.com", password: { $ne: null } },
    { email: "", password: "123" },
    { email: "admin@test.com", password: "" },
    {},
  ];

  for (const body of badInputs) {
    const res = mockRes();
    await authController.login({ body }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.data, { message: "Invalid credentials" });
  }
});

test("authController.resetPassword rejects non-string and missing inputs", async () => {
  const badInputs = [
    { email: { $ne: null }, newPassword: "hacked" },
    { email: "admin@test.com", newPassword: { $gt: "" } },
    { email: "", newPassword: "password123" },
    { email: "admin@test.com", newPassword: "" },
    {},
  ];

  for (const body of badInputs) {
    const res = mockRes();
    await authController.resetPassword({ body }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.data, { message: "Email and new password are required" });
  }
});

test("doctorController.getDoctorById returns 404 when doctor is not found", async () => {
  const origFindById = Doctor.findById;
  Doctor.findById = async () => null;
  try {
    const res = mockRes();
    await doctorController.getDoctorById({ params: { id: "507f1f77bcf86cd799439011" } }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.data, { message: "Doctor not found" });
  } finally {
    Doctor.findById = origFindById;
  }
});

test("medicineController.addMedicine returns 400 on error", async () => {
  const origSave = Medicine.prototype.save;
  Medicine.prototype.save = async () => {
    throw new Error("Validation failed: name is required");
  };
  try {
    const res = mockRes();
    await medicineController.addMedicine({ body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.data.message, "Validation failed: name is required");
  } finally {
    Medicine.prototype.save = origSave;
  }
});
