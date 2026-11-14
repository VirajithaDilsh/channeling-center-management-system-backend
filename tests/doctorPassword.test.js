const test = require("node:test");
const assert = require("node:assert/strict");

const Admin = require("../models/Admin");
const Doctor = require("../models/Doctor");
const { setDoctorPassword, HttpError } = require("../services/doctorAccountService");
const { setDoctorPassword: setDoctorPasswordHandler } = require("../controllers/doctorController");
const { requireAdmin } = require("../middleware/authMiddleware");

function createMockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
}

// Replaces model methods for one test and restores them afterwards.
async function withStubs(stubs, fn) {
  const originals = stubs.map(([obj, key]) => [obj, key, obj[key]]);
  stubs.forEach(([obj, key, impl]) => { obj[key] = impl; });
  try {
    await fn();
  } finally {
    originals.forEach(([obj, key, orig]) => { obj[key] = orig; });
  }
}

const doctorDoc = (extra = {}) => ({
  _id: "d1", name: "Dr A", email: "a@clinic.com", phone: "0771", saved: false,
  async save() { this.saved = true; },
  ...extra,
});

test("rejects passwords shorter than 6 characters", async () => {
  await assert.rejects(() => setDoctorPassword("d1", "123"), (e) => e instanceof HttpError && e.status === 400);
  await assert.rejects(() => setDoctorPassword("d1", undefined), (e) => e.status === 400);
});

test("404 when the doctor does not exist", async () => {
  await withStubs([[Doctor, "findById", async () => null]], async () => {
    await assert.rejects(() => setDoctorPassword("nope", "secret1"), (e) => e.status === 404);
  });
});

test("resets the password of an existing account", async () => {
  const account = { password: "old", saved: false, async save() { this.saved = true; } };
  await withStubs([
    [Doctor, "findById", async () => doctorDoc()],
    [Admin, "findOne", async () => account],
  ], async () => {
    const result = await setDoctorPassword("d1", "newSecret");
    assert.deepEqual(result, { created: false });
    assert.equal(account.password, "newSecret");
    assert.equal(account.saved, true);
  });
});

test("creates a login when the doctor has none", async () => {
  let createdWith = null;
  const doctor = doctorDoc();
  await withStubs([
    [Doctor, "findById", async () => doctor],
    [Admin, "findOne", async () => null],
    [Admin, "create", async (doc) => { createdWith = doc; return { _id: "a1", ...doc }; }],
  ], async () => {
    const result = await setDoctorPassword("d1", "newSecret");
    assert.deepEqual(result, { created: true });
    assert.equal(createdWith.role, "doctor");
    assert.equal(createdWith.email, "a@clinic.com");
    assert.equal(createdWith.password, "newSecret");
    assert.equal(createdWith.doctorId, "d1");
    assert.equal(doctor.userId, "a1");
    assert.equal(doctor.saved, true);
  });
});

test("cannot create a login without a doctor email", async () => {
  await withStubs([
    [Doctor, "findById", async () => doctorDoc({ email: undefined })],
    [Admin, "findOne", async () => null],
  ], async () => {
    await assert.rejects(() => setDoctorPassword("d1", "newSecret"), (e) => e.status === 400 && /email/i.test(e.message));
  });
});

test("cannot create a login when the email is already used by another account", async () => {
  let call = 0;
  await withStubs([
    [Doctor, "findById", async () => doctorDoc()],
    [Admin, "findOne", async () => (call++ === 0 ? null : { _id: "other" })],
  ], async () => {
    await assert.rejects(() => setDoctorPassword("d1", "newSecret"), (e) => e.status === 400);
  });
});

test("handler never returns the password and maps errors to their status", async () => {
  await withStubs([
    [Doctor, "findById", async () => doctorDoc()],
    [Admin, "findOne", async () => ({ async save() {} })],
  ], async () => {
    const res = createMockRes();
    await setDoctorPasswordHandler({ params: { id: "d1" }, body: { newPassword: "newSecret" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, false);
    assert.equal(JSON.stringify(res.body).includes("newSecret"), false);

    const bad = createMockRes();
    await setDoctorPasswordHandler({ params: { id: "d1" }, body: { newPassword: "1" } }, bad);
    assert.equal(bad.statusCode, 400);
  });
});

test("route guard: only admins pass requireAdmin", () => {
  const blocked = createMockRes();
  let nextCalled = false;
  requireAdmin({ user: { role: "receptionist" } }, blocked, () => { nextCalled = true; });
  assert.equal(blocked.statusCode, 403);
  assert.equal(nextCalled, false);

  requireAdmin({ user: { role: " Admin " } }, createMockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
