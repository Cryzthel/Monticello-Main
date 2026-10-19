/**
 * recordPasswordChange: logs a staff member's own password change once, and
 * only when Firebase Auth's own evidence says it just happened.
 *
 *   node scripts/recordPasswordChange.test.cjs      (from functions/)
 */
const assert = require("assert");
const path = require("path");
const Module = require("module");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const store = new Map();
const users = new Map();
function docRef(col, id) {
  const key = `${col}/${id}`;
  return {
    get: async () => ({ exists: store.has(key), data: () => store.get(key) }),
    create: async (data) => {
      if (store.has(key)) {
        const err = new Error("exists");
        err.code = 6;
        throw err;
      }
      store.set(key, data);
    },
    set: async (data) => store.set(key, data),
  };
}
const fakeAdmin = {
  firestore: Object.assign(() => ({ collection: (col) => ({ doc: (id) => docRef(col, id), add: async () => {} }) }), {
    FieldValue: { serverTimestamp: () => "SERVER_TS" },
  }),
  auth: () => ({ getUser: async (uid) => ({ uid, ...users.get(uid) }) }),
};
const fakeFunctions = { https: { HttpsError, onCall: (fn) => fn } };
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "firebase-admin" || request === "firebase-functions") return request;
  return resolve.call(this, request, parent, ...rest);
};
require.cache["firebase-admin"] = { id: "firebase-admin", loaded: true, exports: fakeAdmin };
require.cache["firebase-functions"] = { id: "firebase-functions", loaded: true, exports: fakeFunctions };
const { recordPasswordChange } = require(path.join(__dirname, "..", "accountSync.js"));

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}
const ctx = (uid) => ({ auth: { uid } });
const logs = () => [...store.keys()].filter((k) => k.startsWith("provisioning_logs/"));

(async () => {
  store.set("staff_accounts/a", { status: "approved", name: "Admin" });
  store.set("staff_accounts/s", { status: "suspended", name: "Gone" });
  users.set("a", { email: "a@x.co", tokensValidAfterTime: new Date().toUTCString() });
  users.set("s", { email: "s@x.co", tokensValidAfterTime: new Date().toUTCString() });

  await check("signed-out callers are refused", async () => {
    await assert.rejects(recordPasswordChange({}, {}), /Sign in required/);
  });
  await check("a fresh change is logged, as staff.password.changed", async () => {
    assert.deepStrictEqual(await recordPasswordChange({}, ctx("a")), { ok: true, logged: true });
    const [key] = logs();
    assert.strictEqual(store.get(key).action, "staff.password.changed");
    assert.strictEqual(store.get(key).category, "security");
  });
  await check("the same change is logged once", async () => {
    assert.deepStrictEqual(await recordPasswordChange({}, ctx("a")), { ok: true, logged: false });
    assert.strictEqual(logs().length, 1);
  });
  await check("no recent change, nothing logged", async () => {
    users.set("a", { email: "a@x.co", tokensValidAfterTime: new Date(Date.now() - 3600e3).toUTCString() });
    assert.deepStrictEqual(await recordPasswordChange({}, ctx("a")), { ok: true, logged: false });
    assert.strictEqual(logs().length, 1);
  });
  await check("a suspended account logs nothing", async () => {
    assert.deepStrictEqual(await recordPasswordChange({}, ctx("s")), { ok: true, logged: false });
    assert.strictEqual(logs().length, 1);
  });

  console.log(`\n${passed} passed, ${process.exitCode ? "failures above" : "0 failed"}`);
})();
