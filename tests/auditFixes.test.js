const test = require("node:test");
const assert = require("node:assert/strict");

const Admin = require("../models/Admin");
const VisitSession = require("../models/VisitSession");
const { getAdmins, getAdminById } = require("../controllers/adminController");
const { getVisitSession, getVisitSessionByAppointment } = require("../controllers/visitSessionController");
const { sanitizeMedicinePayload } = require("../controllers/medicineController");
const { requirePermission, requireAdmin } = require("../middleware/authMiddleware");

function createMockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
}

test("sanitizeMedicinePayload whitelists fields and rejects negative values or invalid dates", () => {
  const valid = sanitizeMedicinePayload({
    name: "Paracetamol",
    stockQuantity: "25",
    unitPrice: 15.5,
    reorderLevel: 5,
    expiryDate: "2027-01-01",
    __proto__: {},
    extraMaliciousField: "drop",
    _id: "fakeid",
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.payload.name, "Paracetamol");
  assert.equal(valid.payload.stockQuantity, 25);
  assert.equal("extraMaliciousField" in valid.payload, false);
  assert.equal("_id" in valid.payload, false);

  assert.match(sanitizeMedicinePayload({ stockQuantity: -1 }).error, /Stock quantity/);
  assert.match(sanitizeMedicinePayload({ unitPrice: -0.01 }).error, /Unit price/);
  assert.match(sanitizeMedicinePayload({ reorderLevel: "abc" }).error, /Reorder level/);
  assert.match(sanitizeMedicinePayload({ expiryDate: "not-a-date" }).error, /Invalid expiry date/);
});

test("adminController getAdmins and getAdminById always exclude password field", async () => {
  const origFind = Admin.find;
  const origFindById = Admin.findById;
  let findSelectArg = null;
  let findByIdSelectArg = null;

  Admin.find = () => ({
    select: async (arg) => {
      findSelectArg = arg;
      return [{ _id: "1", name: "Admin", email: "a@test.com", role: "admin" }];
    },
  });
  Admin.findById = () => ({
    select: async (arg) => {
      findByIdSelectArg = arg;
      return { _id: "1", name: "Admin", email: "a@test.com", role: "admin" };
    },
  });

  try {
    const resList = createMockRes();
    await getAdmins({}, resList);
    assert.equal(findSelectArg, "-password");
    assert.equal(resList.statusCode, 200);
    assert.equal("password" in resList.body[0], false);

    const resOne = createMockRes();
    await getAdminById({ params: { id: "1" } }, resOne);
    assert.equal(findByIdSelectArg, "-password");
    assert.equal(resOne.statusCode, 200);
    assert.equal("password" in resOne.body, false);
  } finally {
    Admin.find = origFind;
    Admin.findById = origFindById;
  }
});

test("visitSessionController blocks unauthorized doctor access and allows billing/pharmacy/owning doctor", async () => {
  const origFindById = VisitSession.findById;
  const origFindOne = VisitSession.findOne;
  const origAdminFindById = Admin.findById;

  const sampleSession = { _id: "vs1", appointmentId: "apt1", doctorId: "docA" };
  VisitSession.findById = async () => sampleSession;
  VisitSession.findOne = async () => sampleSession;
  Admin.findById = async () => ({ doctorId: null });

  try {
    // Unlinked doctor_portal user cannot read another doctor's session
    const resForbidden = createMockRes();
    await getVisitSession(
      { params: { id: "vs1" }, user: { id: "u1", permissions: ["doctor_portal"] } },
      resForbidden
    );
    assert.equal(resForbidden.statusCode, 403);

    const resForbiddenApt = createMockRes();
    await getVisitSessionByAppointment(
      { params: { appointmentId: "apt1" }, user: { id: "u1", permissions: ["doctor_portal"] } },
      resForbiddenApt
    );
    assert.equal(resForbiddenApt.statusCode, 403);

    // Billing user can read
    const resAllowed = createMockRes();
    await getVisitSession(
      { params: { id: "vs1" }, user: { id: "u2", permissions: ["billing_read"] } },
      resAllowed
    );
    assert.equal(resAllowed.statusCode, 200);
    assert.equal(resAllowed.body._id, "vs1");
  } finally {
    VisitSession.findById = origFindById;
    VisitSession.findOne = origFindOne;
    Admin.findById = origAdminFindById;
  }
});

test("RBAC middleware enforces admin-only access and permission checks", () => {
  const res403 = createMockRes();
  let nextCalled = false;
  requireAdmin({ user: { role: "reception", permissions: ["inventory_read"] } }, res403, () => {
    nextCalled = true;
  });
  assert.equal(res403.statusCode, 403);
  assert.equal(nextCalled, false);

  const res200 = createMockRes();
  requireAdmin({ user: { role: "Admin" } }, res200, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  const resPerm = createMockRes();
  nextCalled = false;
  requirePermission("billing_read", "pharmacy_read")({ user: { permissions: ["reception_read"] } }, resPerm, () => {
    nextCalled = true;
  });
  assert.equal(resPerm.statusCode, 403);
  assert.equal(nextCalled, false);
});

