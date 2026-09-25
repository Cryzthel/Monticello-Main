/**
 * Security guard account provisioning — the privileged half.
 *
 * Five callables behind the Admin Portal's Security Accounts page:
 *
 *   createSecurityAccount     mint a Guardhouse credential + issue a password
 *   resetSecurityCredential   replace a password and re-flag the account
 *   setSecurityAccountStatus  active / suspended / revoked
 *   updateSecurityAssignment  post, shift, duties, badge, contact, role
 *   deleteSecurityAccount     remove the directory row, disable the sign-in
 *
 * ── WHY ANY OF THIS IS SERVER-SIDE ──────────────────────────────────────────
 * `staff_accounts` is `allow create, update: if false` in firestore.rules. A
 * document in that collection is what every role check in the system reads, so
 * a client that could write one could grant itself any role in the estate. The
 * rule is absolute and these functions do not relax it — they run under the
 * Admin SDK, which bypasses rules, and re-derive the caller's authority from
 * the same collection before touching anything.
 *
 * ── EVERY WRITE IS PAIRED WITH ITS AUDIT ENTRY ──────────────────────────────
 * `writeAudit` is called inside each function rather than by the client
 * afterwards. A log entry the client is responsible for writing is a log entry
 * the client can decline to write — and the action most worth recording
 * (deletion) is precisely the one that destroys its own evidence.
 * `provisioning_logs` grants admins read and create but never update or delete,
 * so no session can edit or erase an entry — including the super_admin whose
 * actions it records.
 *
 * ── PASSWORD HANDLING ───────────────────────────────────────────────────────
 * Passwords arrive from the client, are handed straight to
 * `admin.auth().updateUser`/`createUser`, and are never written to Firestore,
 * never logged, and never echoed back in a response body. Firebase Auth stores
 * them as scrypt hashes with a per-project salt separator — the Admin SDK has
 * no API that returns a password, which is the property being relied on here.
 * See ../db/README.md for how this maps onto the relational schema's
 * `password_hash` / `password_algo` columns in a self-hosted deployment.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

const db = admin.firestore();

const STAFF_COLLECTION = "staff_accounts";
const AUDIT_COLLECTION = "provisioning_logs";

// ── VOCABULARY ──────────────────────────────────────────────────────────────
//
// Mirrors apps/admin-portal/src/lib/securityAccounts.js. The client copy is a
// convenience that puts an error beside the field that caused it; THIS copy is
// the enforcement. They are two statements of one policy, and the server one
// wins — a request naming a post or duty that is not on these lists is
// rejected, whatever the form allowed.

/**
 * The three job titles the provisioning form offers, and what each one MEANS.
 *
 * ── THE CLIENT PICKS A TITLE; THE SERVER DECIDES THE PRIVILEGE ──────────────
 * The request carries `accessRole` — `gate_guard`, `roving_patrol` or
 * `security_supervisor`. The RBAC role written to `staff_accounts.role` is
 * looked up HERE, from this table, and is never read from the request body.
 *
 * That is the whole security property of this mapping. `role` is the value
 * firestore.rules, requireStaff and both portals' AuthContext allowlists
 * compare against; a client that could name it could name `super_admin`. The
 * previous shape accepted `role` from the caller and validated it against a
 * list, which is safe but weaker — it trusts the request and then checks it.
 * This trusts nothing: whatever the caller sends, the stored role is one of
 * exactly two values chosen by this file.
 *
 * The inverse is also load-bearing. Writing the job title straight into `role`
 * would create an account that appears in the admin directory and CANNOT SIGN
 * IN — no allowlist contains `gate_guard`, so AuthProvider signs the session
 * back out and the officer sees only "not authorized for this portal".
 */
const ACCESS_ROLES = {
  gate_guard: { rbacRole: "security_officer", duty: "gate_guard" },
  roving_patrol: { rbacRole: "security_officer", duty: "roving_patrol" },
  // A POST, not a rank: the dispatcher runs the radio for a shift and holds
  // ordinary officer permissions. Only `security_supervisor` below mints a
  // `security_head`.
  lead_dispatcher: { rbacRole: "security_officer", duty: "lead_dispatcher" },
  security_supervisor: { rbacRole: "security_head", duty: "supervisor" },
};

const ACCESS_ROLE_KEYS = Object.keys(ACCESS_ROLES);

/** The RBAC roles this endpoint can produce. `super_admin` is unreachable. */
const PROVISIONABLE_ROLES = [
  ...new Set(Object.values(ACCESS_ROLES).map((r) => r.rbacRole)),
];

const SHIFTS = ["morning", "evening", "night"];
const POSTS = ["main_gate", "secondary_gate", "clubhouse", "perimeter_patrol"];

// THE ONE VALUE THAT GRANTS ACCESS.
//
// firestore.rules, requireStaff below, and the web AuthContext all gate on
// `status == 'approved'`. "Active" is therefore that same string rather than a
// fourth value, and `suspended` / `revoked` are values none of those three
// accept. Suspending an account takes effect through machinery that is already
// deployed, with no rules change and no window in which a half-applied policy
// is in force.
const STATUS = {
  active: "approved",
  suspended: "suspended",
  revoked: "revoked",
};

const STATUS_VALUES = Object.values(STATUS);

const MIN_PASSWORD_LENGTH = 8;

// Firebase Auth's own floor is 6. Eight is this system's, and it is applied
// here rather than only in the browser: the form is one caller of this
// endpoint, and "the client validates it" is not a constraint.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BADGE_RE = /^[A-Za-z0-9-]{2,16}$/;

// ── HELPERS ─────────────────────────────────────────────────────────────────

function fail(code, message) {
  throw new functions.https.HttpsError(code, message);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Resolves the caller and requires `super_admin`.
 *
 * Re-read from Firestore on every call rather than trusted from a custom claim.
 * A claim is minted into an ID token and stays valid for up to an hour after it
 * is withdrawn; an admin whose access is revoked mid-session would keep
 * provisioning guards until their token expired. The read costs one document
 * and closes that window to zero.
 */
async function requireSuperAdmin(context) {
  const uid = context.auth && context.auth.uid;
  if (!uid) fail("unauthenticated", "Sign in required.");

  const snap = await db.collection(STAFF_COLLECTION).doc(uid).get();
  const staff = snap.data();
  if (!snap.exists || staff.status !== STATUS.active) {
    fail("permission-denied", "Not an approved staff account.");
  }
  if (staff.role !== "super_admin") {
    fail("permission-denied", "Only a Super Admin can manage security accounts.");
  }

  return {
    uid,
    name: staff.name || staff.email || "Super Admin",
    email: staff.email || "",
  };
}

/**
 * Appends one immutable entry to the audit trail.
 *
 * `category: 'security'` is a flat field rather than something derived from
 * `action`, because Firestore has no prefix match: the Admin Portal's log view
 * needs an equality filter it can combine with `orderBy('at','desc')`, and a
 * range query on the action string would force the log to sort alphabetically
 * instead of chronologically. The composite index it needs is declared in
 * ../firestore.indexes.json.
 *
 * Failures are swallowed with a console error and never rethrown. This is
 * called AFTER the state change has committed, so throwing here would report a
 * completed suspension as a failure and invite the operator to repeat it — the
 * audit trail is not worth telling an operator a lie about what happened.
 */
async function writeAudit(entry) {
  try {
    await db.collection(AUDIT_COLLECTION).add({
      category: "security",
      at: admin.firestore.FieldValue.serverTimestamp(),
      ...entry,
    });
  } catch (err) {
    console.error("Audit write failed", entry.action, err);
  }
}

/**
 * Validates and normalises the roster half of a request.
 *
 * Returns the fields to merge; throws `invalid-argument` naming the offending
 * field. Every message says which field and what is acceptable, because a
 * callable returns ONE error and the operator has to be able to act on it
 * without a second round trip.
 */
function readAssignment(data, { partial = false } = {}) {
  const out = {};

  const fullName = String(data.fullName || "").trim();
  if (fullName) out.name = fullName;
  else if (!partial) fail("invalid-argument", "A full name is required.");

  const badge = String(data.badgeNumber || "").trim().toUpperCase();
  if (badge) {
    if (!BADGE_RE.test(badge)) {
      fail("invalid-argument", "Badge number must be 2–16 letters, numbers or dashes.");
    }
    out.badgeNumber = badge;
  } else if (!partial) {
    fail("invalid-argument", "A badge number is required.");
  }

  // ── ACCESS ROLE → RBAC ROLE + DUTY ────────────────────────────────────────
  //
  // `data.role` and `data.duties` are IGNORED even if present. The privilege a
  // credential carries is derived from the job title through the table above,
  // never accepted from the request — see the note on ACCESS_ROLES.
  if (data.accessRole !== undefined) {
    const mapping = ACCESS_ROLES[data.accessRole];
    if (!mapping) {
      fail(
          "invalid-argument",
          `accessRole must be one of [${ACCESS_ROLE_KEYS.join(", ")}].`,
      );
    }
    out.accessRole = data.accessRole;
    out.role = mapping.rbacRole;
    // Kept as an array because the roster model is many-to-many
    // (security_user_duties in ../db) even though the form now sets exactly
    // one. Storing a bare string here would mean rewriting every reader the
    // day a second duty is added back.
    out.duties = [mapping.duty];
  } else if (!partial) {
    fail("invalid-argument", "An access role is required.");
  }

  if (data.assignedPost !== undefined) {
    if (!POSTS.includes(data.assignedPost)) {
      fail("invalid-argument", `assignedPost must be one of [${POSTS.join(", ")}].`);
    }
    out.assignedPost = data.assignedPost;
  } else if (!partial) {
    fail("invalid-argument", "An assigned post is required.");
  }

  if (data.shift !== undefined) {
    if (!SHIFTS.includes(data.shift)) {
      fail("invalid-argument", `shift must be one of [${SHIFTS.join(", ")}].`);
    }
    out.shift = data.shift;
  } else if (!partial) {
    fail("invalid-argument", "A shift is required.");
  }

  return out;
}

function requirePassword(password) {
  const value = String(password || "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    fail("invalid-argument", `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return value;
}

/**
 * Rejects a badge number already worn by a different account.
 *
 * A badge is how a guard is identified on the roster sheet, on a filed report
 * and over the radio. Two officers sharing one is not a database problem — it
 * is an operational one, and the moment it happens nobody can tell which of
 * them a report belongs to.
 *
 * Firestore cannot express this as a constraint (there are no unique indexes),
 * so it is a query. That leaves a race between two admins provisioning the same
 * badge in the same instant, which is not worth a transaction here: the window
 * is milliseconds, the collection is tens of documents, and the duplicate is
 * visible and fixable in the directory. The relational schema in ../db does
 * express it properly, as `UNIQUE (badge_number)` — see ../db/README.md.
 */
async function assertBadgeAvailable(badgeNumber, exceptUid) {
  if (!badgeNumber) return;
  const snap = await db
      .collection(STAFF_COLLECTION)
      .where("badgeNumber", "==", badgeNumber)
      .limit(2)
      .get();

  const clash = snap.docs.find((doc) => doc.id !== exceptUid);
  if (clash) {
    fail(
        "already-exists",
        `Badge ${badgeNumber} is already assigned to ${clash.data().name || clash.id}.`,
    );
  }
}

// ── CALLABLES ───────────────────────────────────────────────────────────────

/**
 * createSecurityAccount — mint a Guardhouse credential.
 *
 * ── ON AN EMAIL THAT ALREADY HAS AN AUTH USER ───────────────────────────────
 * The older `createStaffAccount` attaches the staff role to whatever uid the
 * email already has. This one REFUSES, and the difference is deliberate. That
 * email may belong to a resident with an active session, and silently
 * overwriting their password — which is what "provision with this initial
 * password" means for an existing user — locks a homeowner out of the mobile
 * app to onboard a guard. The two paths are not interchangeable, so this one
 * says so and stops.
 */
exports.createSecurityAccount = functions.https.onCall(async (data, context) => {
  const actor = await requireSuperAdmin(context);

  const email = normalizeEmail(data.email);
  if (!email || !EMAIL_RE.test(email)) {
    fail("invalid-argument", "A valid sign-in email is required.");
  }
  const password = requirePassword(data.password);
  const assignment = readAssignment(data);
  await assertBadgeAvailable(assignment.badgeNumber, null);

  let existing = null;
  try {
    existing = await admin.auth().getUserByEmail(email);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }
  if (existing) {
    fail(
        "already-exists",
        `${email} already has an account. Provision a different address, or grant this one a role from the Firebase console if it is genuinely the same person.`,
    );
  }

  const userRecord = await admin.auth().createUser({
    email,
    password,
    displayName: assignment.name,
    emailVerified: false,
    disabled: false,
  });

  const forcePasswordReset = data.forcePasswordReset !== false;

  await db.collection(STAFF_COLLECTION).doc(userRecord.uid).set({
    ...assignment,
    email,
    status: STATUS.active,
    // The FLAG is stored; the password is not. A guardhouse client reads this
    // and blocks the console until a new password is set.
    mustChangePassword: forcePasswordReset,
    onDuty: false,
    statusReason: "",
    provisionedBy: actor.uid,
    provisionedByName: actor.name,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await writeAudit({
    action: "security.account.created",
    actorUid: actor.uid,
    actorName: actor.name,
    targetUid: userRecord.uid,
    targetName: assignment.name,
    targetEmail: email,
    summary: `Provisioned ${assignment.name} (badge ${assignment.badgeNumber}) as ${assignment.accessRole.replace(/_/g, " ")}`,
    metadata: {
      accessRole: assignment.accessRole,
      role: assignment.role,
      assignedPost: assignment.assignedPost,
      shift: assignment.shift,
      duties: assignment.duties,
      forcePasswordReset,
    },
  });

  // The password is NOT echoed back. The client already holds the value it
  // sent; returning it would put a plaintext credential into a response body,
  // a Functions log line and any proxy in between, for no gain.
  return { ok: true, uid: userRecord.uid, email };
});

/**
 * resetSecurityCredential — replace a password and re-flag the account.
 *
 * `mustChangePassword` is set in the same write, so a reset is never just a new
 * shared secret between the admin and the guard: the officer replaces it on
 * first sign-in and the handed-over value stops being valid the moment it has
 * done its job.
 */
exports.resetSecurityCredential = functions.https.onCall(async (data, context) => {
  const actor = await requireSuperAdmin(context);

  const uid = String(data.uid || "").trim();
  if (!uid) fail("invalid-argument", "uid is required.");
  const password = requirePassword(data.password);

  const snap = await db.collection(STAFF_COLLECTION).doc(uid).get();
  if (!snap.exists) fail("not-found", "That security account no longer exists.");
  const staff = snap.data();
  if (!PROVISIONABLE_ROLES.includes(staff.role)) {
    // This endpoint is scoped to the guardhouse roster. An admin password is
    // reset through the emailed link, which is the path that does not require
    // a second admin to be trusted with the value.
    fail("permission-denied", "That account is not a security account.");
  }

  await admin.auth().updateUser(uid, { password });

  const forcePasswordReset = data.forcePasswordReset !== false;
  await db.collection(STAFF_COLLECTION).doc(uid).set({
    mustChangePassword: forcePasswordReset,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeAudit({
    action: "security.credential.reset",
    actorUid: actor.uid,
    actorName: actor.name,
    targetUid: uid,
    targetName: staff.name || "",
    targetEmail: staff.email || "",
    summary: `Issued a new temporary password for ${staff.name || staff.email || uid}`,
    metadata: { forcePasswordReset },
  });

  return { ok: true };
});

/**
 * setSecurityAccountStatus — active / suspended / revoked.
 *
 * ── BOTH LAYERS MOVE TOGETHER ───────────────────────────────────────────────
 * The Firestore status ends AUTHORISATION: every rules check reads it, so a
 * suspended account is refused by Firestore on its next request. The Auth
 * `disabled` flag ends AUTHENTICATION: it invalidates the refresh token, so the
 * session cannot be renewed and the user cannot sign in again.
 *
 * Only the first is strictly required — with `status != 'approved'` the portal
 * signs the session out at the auth boundary and every rule denies. The second
 * is what makes it immediate rather than eventual: an ID token already issued
 * stays cryptographically valid for up to an hour, and until it expires, any
 * request that is authorised by the TOKEN alone still passes. Doing both closes
 * that hour.
 */
exports.setSecurityAccountStatus = functions.https.onCall(async (data, context) => {
  const actor = await requireSuperAdmin(context);

  const uid = String(data.uid || "").trim();
  const status = String(data.status || "").trim();
  if (!uid) fail("invalid-argument", "uid is required.");
  if (!STATUS_VALUES.includes(status)) {
    fail("invalid-argument", `status must be one of [${STATUS_VALUES.join(", ")}].`);
  }
  if (uid === actor.uid) {
    // Not a hypothetical: the caller is a super_admin, and an admin who
    // suspends themselves cannot un-suspend themselves — the only remaining
    // route is the Firebase console.
    fail("invalid-argument", "You cannot change the status of your own account.");
  }

  const snap = await db.collection(STAFF_COLLECTION).doc(uid).get();
  if (!snap.exists) fail("not-found", "That security account no longer exists.");
  const staff = snap.data();

  const active = status === STATUS.active;
  await admin.auth().updateUser(uid, { disabled: !active });
  if (!active) {
    // Kills the refresh token outright, so an open guardhouse tab cannot mint
    // a fresh ID token when its current one expires.
    await admin.auth().revokeRefreshTokens(uid);
  }

  const verb = active ? "Reactivated" : status === STATUS.suspended ? "Suspended" : "Revoked";

  await db.collection(STAFF_COLLECTION).doc(uid).set({
    status,
    statusReason: `${verb} by ${actor.name}`,
    // On-duty is cleared with the access. A revoked credential showing as on
    // post would put a name on the guardhouse board for someone who cannot
    // sign in.
    ...(active ? {} : { onDuty: false }),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeAudit({
    action: active
      ? "security.status.reactivated"
      : status === STATUS.suspended
        ? "security.status.suspended"
        : "security.status.revoked",
    actorUid: actor.uid,
    actorName: actor.name,
    targetUid: uid,
    targetName: staff.name || "",
    targetEmail: staff.email || "",
    summary: `${verb} portal access for ${staff.name || staff.email || uid}`,
    metadata: { from: staff.status || "", to: status },
  });

  return { ok: true, status };
});

/**
 * updateSecurityAssignment — roster and contact details.
 *
 * The sign-in email is NOT accepted here. Changing it means changing the Auth
 * identity, which invalidates the officer's saved credential and every
 * password-reset link already issued for the old address. That is an account
 * migration, not an edit, and it should not share a Save button with "moved to
 * the back gate".
 */
exports.updateSecurityAssignment = functions.https.onCall(async (data, context) => {
  const actor = await requireSuperAdmin(context);

  const uid = String(data.uid || "").trim();
  if (!uid) fail("invalid-argument", "uid is required.");

  const snap = await db.collection(STAFF_COLLECTION).doc(uid).get();
  if (!snap.exists) fail("not-found", "That security account no longer exists.");
  const staff = snap.data();

  const assignment = readAssignment(data);
  await assertBadgeAvailable(assignment.badgeNumber, uid);

  await db.collection(STAFF_COLLECTION).doc(uid).set({
    ...assignment,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Keep the Auth display name in step. It is what `auth.currentUser
  // .displayName` returns, which is the name the guardhouse portal stamps on
  // every report the officer files — so a rename that stopped at Firestore
  // would leave old and new names appearing side by side in the same table.
  if (assignment.name && assignment.name !== staff.name) {
    await admin.auth().updateUser(uid, { displayName: assignment.name });
  }

  // Only the fields that actually moved. An audit line reading "changed post
  // from main_gate to main_gate" is noise that hides the line that matters.
  const changes = Object.keys(assignment)
      .filter((key) => JSON.stringify(assignment[key]) !== JSON.stringify(staff[key]))
      .join(", ");

  await writeAudit({
    action: "security.assignment.updated",
    actorUid: actor.uid,
    actorName: actor.name,
    targetUid: uid,
    targetName: assignment.name || staff.name || "",
    targetEmail: staff.email || "",
    summary: changes
      ? `Updated ${changes} for ${assignment.name || staff.email || uid}`
      : `Saved ${assignment.name || staff.email || uid} with no changes`,
    metadata: { assignedPost: assignment.assignedPost, shift: assignment.shift, duties: assignment.duties },
  });

  return { ok: true };
});

/**
 * deleteSecurityAccount — remove the directory row, disable the sign-in.
 *
 * ── THE AUTH USER IS DISABLED, NOT DELETED ──────────────────────────────────
 * Its uid is stamped on every `guard_shifts` row the officer clocked and every
 * incident they filed. Deleting the user turns a signed timesheet into an
 * orphan reference — and the timesheet is the record an incident response gets
 * judged against, so it must keep pointing at a real identity long after the
 * person has left.
 *
 * Access still ends completely: the staff document is gone, so every
 * `firestore.rules` role check fails, and the Auth user is disabled with its
 * refresh tokens revoked, so no session can be renewed or created.
 */
exports.deleteSecurityAccount = functions.https.onCall(async (data, context) => {
  const actor = await requireSuperAdmin(context);

  const uid = String(data.uid || "").trim();
  if (!uid) fail("invalid-argument", "uid is required.");
  if (uid === actor.uid) fail("invalid-argument", "You cannot delete your own account.");

  const snap = await db.collection(STAFF_COLLECTION).doc(uid).get();
  if (!snap.exists) fail("not-found", "That security account no longer exists.");
  const staff = snap.data();
  if (!PROVISIONABLE_ROLES.includes(staff.role)) {
    fail("permission-denied", "That account is not a security account.");
  }

  // Auth first. If the Firestore delete fails after this, the account is
  // already locked out and the row is still visible to retry from — the safe
  // order. The reverse would leave a signed-out-looking directory and a
  // credential that still works.
  try {
    await admin.auth().updateUser(uid, { disabled: true });
    await admin.auth().revokeRefreshTokens(uid);
  } catch (err) {
    // An Auth user that is already gone is not a reason to leave the directory
    // row behind — that row IS the authorisation.
    if (err.code !== "auth/user-not-found") throw err;
  }

  // Written BEFORE the delete: after it, the document that names this person is
  // gone, and an audit entry assembled from an empty snapshot would record the
  // removal of an unnamed uid.
  await writeAudit({
    action: "security.account.deleted",
    actorUid: actor.uid,
    actorName: actor.name,
    targetUid: uid,
    targetName: staff.name || "",
    targetEmail: staff.email || "",
    summary: `Deleted the security account for ${staff.name || staff.email || uid} (badge ${staff.badgeNumber || "—"})`,
    metadata: { role: staff.role || "", lastStatus: staff.status || "" },
  });

  await db.collection(STAFF_COLLECTION).doc(uid).delete();

  return { ok: true };
});
