/**
 * The OTP-verified email change, end to end against in-memory fakes.
 *
 *   node scripts/emailChange.test.cjs      (from functions/)
 *
 * firebase-admin, firebase-functions and ./mailer are replaced in the module
 * cache before ../emailChange is loaded, so the REAL handlers run: the
 * re-auth window, the code hash, the attempt budget, and above all the rule
 * that Firebase Auth's email does not change until the right code arrives.
 */
const assert = require("assert");
const path = require("path");
const Module = require("module");

// ── fakes ────────────────────────────────────────────────────────────────────
class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
const store = new Map(); // "collection/id" -> data
const logs = [];
const users = new Map(); // uid -> { email, emailVerified }
const mail = [];

const ts = (ms) => ({ toMillis: () => ms });
function docRef(col, id) {
  const key = `${col}/${id}`;
  return {
    get: async () => ({ exists: store.has(key), data: () => store.get(key) }),
    set: async (data, opts) => store.set(key, opts && opts.merge ? { ...(store.get(key) || {}), ...data } : data),
    update: async (patch) => store.set(key, { ...store.get(key), ...patch }),
    delete: async () => store.delete(key),
  };
}
const fakeAdmin = {
  firestore: Object.assign(
    () => ({
      collection: (col) => ({
        doc: (id) => docRef(col, id),
        add: async (data) => (col === "provisioning_logs" ? logs.push(data) : null),
      }),
    }),
    { Timestamp: { fromMillis: ts }, FieldValue: { serverTimestamp: () => "SERVER_TS" } },
  ),
  auth: () => ({
    getUser: async (uid) => ({ uid, ...users.get(uid) }),
    getUserByEmail: async (email) => {
      for (const [uid, u] of users) if (u.email === email) return { uid, ...u };
      const err = new Error("no user");
      err.code = "auth/user-not-found";
      throw err;
    },
    updateUser: async (uid, patch) => users.set(uid, { ...users.get(uid), ...patch }),
  }),
};
const fakeFunctions = {
  https: { HttpsError, onCall: (fn) => fn },
  runWith: () => ({ https: { onCall: (fn) => fn } }),
};
const fakeMailer = {
  sendMail: async (m) => mail.push(m),
  mailSecrets: () => [],
  buildEmailChangeCodeEmail: (code) => ({ subject: "code", text: `${code} is your code`, html: "" }),
  buildEmailChangedNotice: (from, to) => ({ subject: "changed", text: `${from} -> ${to}`, html: "" }),
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "firebase-admin" || request === "firebase-functions" || request === "./mailer") return request;
  return resolve.call(this, request, parent, ...rest);
};
require.cache["firebase-admin"] = { id: "firebase-admin", loaded: true, exports: fakeAdmin };
require.cache["firebase-functions"] = { id: "firebase-functions", loaded: true, exports: fakeFunctions };
require.cache["./mailer"] = { id: "./mailer", loaded: true, exports: fakeMailer };
const { requestEmailChange, confirmEmailChange } = require(path.join(__dirname, "..", "emailChange.js"));

// ── the run ──────────────────────────────────────────────────────────────────
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
async function rejects(promise, reason) {
  try {
    await promise;
  } catch (err) {
    if (reason && err.details?.reason !== reason) throw new Error(`expected ${reason}, got ${err.details?.reason ?? err.code}`);
    return err;
  }
  throw new Error(`expected a refusal (${reason})`);
}
const now = () => Math.floor(Date.now() / 1000);
const ctx = (uid, authAgeS = 5) => ({ auth: { uid, token: { auth_time: now() - authAgeS } } });
const lastCode = () => mail.filter((m) => m.subject === "code").pop().text.slice(0, 6);

(async () => {
  users.set("admin1", { email: "villanueva.kristine@example.com", emailVerified: true });
  users.set("other", { email: "taken@example.com", emailVerified: true });
  store.set("staff_accounts/admin1", { status: "approved", name: "Admin", email: "villanueva.kristine@example.com" });
  store.set("staff_accounts/gone", { status: "suspended" });

  await check("signed-out callers are refused", async () => {
    await assert.rejects(requestEmailChange({ newEmail: "a@b.co" }, {}), /Sign in required/);
  });
  await check("a stale sign-in must re-authenticate first", async () => {
    await rejects(requestEmailChange({ newEmail: "adminmonticellov@gmail.com" }, ctx("admin1", 3600)), "reauth-required");
  });
  await check("a suspended staff account is refused", async () => {
    await assert.rejects(requestEmailChange({ newEmail: "a@b.co" }, ctx("gone")), /active staff/);
  });
  await check("invalid, same and taken addresses are refused with their reason", async () => {
    await rejects(requestEmailChange({ newEmail: "villanueva.kristine" }, ctx("admin1")), "invalid-email");
    await rejects(requestEmailChange({ newEmail: "Villanueva.Kristine@example.com " }, ctx("admin1")), "same-email");
    await rejects(requestEmailChange({ newEmail: "taken@example.com" }, ctx("admin1")), "email-in-use");
  });

  await check("a request mails a 6-digit code to the NEW address and changes nothing", async () => {
    const res = await requestEmailChange({ newEmail: " AdminMonticelloV@gmail.com " }, ctx("admin1"));
    assert.strictEqual(res.sentTo, "adminmonticellov@gmail.com");
    assert.strictEqual(mail.at(-1).to, "adminmonticellov@gmail.com");
    assert.match(lastCode(), /^\d{6}$/);
    assert.strictEqual(users.get("admin1").email, "villanueva.kristine@example.com");
    const record = store.get("email_change_otps/admin1");
    assert.ok(record.hash && record.salt && !JSON.stringify(record).includes(lastCode()), "code stored hashed only");
  });

  await check("a wrong code is refused and counted; the account is untouched", async () => {
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    await rejects(confirmEmailChange({ otp: wrong }, ctx("admin1")), "wrong-code");
    assert.strictEqual(store.get("email_change_otps/admin1").attempts, 1);
    assert.strictEqual(users.get("admin1").email, "villanueva.kristine@example.com");
  });

  await check("the right code from a stale session still needs re-auth", async () => {
    await rejects(confirmEmailChange({ otp: lastCode() }, ctx("admin1", 3600)), "reauth-required");
  });

  await check("the right code commits: Auth, staff record, audit log, old-address notice", async () => {
    const code = lastCode();
    const res = await confirmEmailChange({ otp: code }, ctx("admin1"));
    assert.deepStrictEqual(res, { ok: true, email: "adminmonticellov@gmail.com" });
    assert.deepStrictEqual(users.get("admin1"), { email: "adminmonticellov@gmail.com", emailVerified: true });
    assert.strictEqual(store.get("staff_accounts/admin1").email, "adminmonticellov@gmail.com");
    assert.strictEqual(logs.at(-1).action, "staff.email.changed");
    assert.deepStrictEqual(logs.at(-1).metadata, {
      from: "villanueva.kristine@example.com",
      to: "adminmonticellov@gmail.com",
      emailVerified: true,
      method: "otp",
    });
    assert.strictEqual(mail.at(-1).to, "villanueva.kristine@example.com");
    assert.ok(!store.has("email_change_otps/admin1"), "the code is single-use");
  });

  await check("a used code cannot be replayed", async () => {
    await rejects(confirmEmailChange({ otp: "123456" }, ctx("admin1")), "no-request");
  });

  await check("five wrong codes lock the request, and a resend keeps the count", async () => {
    await requestEmailChange({ newEmail: "next@example.com" }, ctx("admin1"));
    for (let i = 0; i < 5; i += 1) {
      await rejects(confirmEmailChange({ otp: "999999" === lastCode() ? "888888" : "999999" }, ctx("admin1")));
    }
    await rejects(confirmEmailChange({ otp: lastCode() }, ctx("admin1")), "locked");
    // Different address: a fresh send, but the window's attempts carry over.
    await requestEmailChange({ newEmail: "next2@example.com" }, ctx("admin1"));
    await rejects(confirmEmailChange({ otp: lastCode() }, ctx("admin1")), "locked");
    assert.strictEqual(users.get("admin1").email, "adminmonticellov@gmail.com");
  });

  console.log(`\n${passed} passed, ${process.exitCode ? "failures above" : "0 failed"}`);
})();
