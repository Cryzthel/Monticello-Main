/**
 * Monticello Villas — password-reset OTP Cloud Functions.
 *
 * Two callable functions:
 *   - sendPasswordOtp({ email })  -> generates a 6-digit OTP, stores a HASHED
 *     copy server-side, and emails the plaintext code to the user.
 *   - verifyPasswordOtp({ email, otp }) -> checks the code, and on success
 *     returns a Firebase password-reset link the client can complete.
 *
 * Security notes:
 *   - The OTP is generated and verified ONLY here (Admin SDK), never on the
 *     client. Clients have no read access to the `password_reset_otps`
 *     collection (Firestore rules deny it; Admin SDK bypasses rules).
 *   - Only a salted SHA-256 hash of the code is stored, so a leaked document
 *     does not reveal the code.
 *   - Codes expire after 10 minutes and are single-use, with a small
 *     attempt counter to throttle brute force.
 */

const crypto = require("crypto");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const COLLECTION = "password_reset_otps";

// ── HOW MANY DIGITS A RESET CODE HAS ────────────────────────────────────────
//
// Was 4. Six is what every mail-delivered code a resident has ever typed looks
// like, and it is what iOS and Android's one-time-code autofill expects to
// find in the message — but the reason to change it is the search space. A
// 4-digit code is 10,000 possibilities; six is a million, against the same
// 5-attempt limit and the same 10-minute window.
//
// THIS IS HALF OF A PAIR. `kOtpLength` in
// lib/features/auth/widgets/otp_pin_input.dart is the other, and the two must
// be deployed together: `verifyPasswordOtp` rejects a code of the wrong length
// before it ever reaches the hash comparison, so a client sending 6 against a
// deployed 4 (or the reverse) fails every reset in the estate at the same step
// with "Email and a 6-digit code are required."
const OTP_LENGTH = 6;
const OTP_MAX_EXCLUSIVE = 10 ** OTP_LENGTH;

// SMTP credentials are stored in Google Secret Manager (encrypted,
// access-controlled) and injected at runtime as environment variables.
// Set them with an interactive prompt (the value is never typed in a command):
//   firebase functions:secrets:set SMTP_USER   -> paste you@gmail.com
//   firebase functions:secrets:set SMTP_PASS   -> paste the 16-char App Password
// (For Gmail, use an App Password, not your account password.)
function buildTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function hashOtp(otp, salt) {
  return crypto.createHash("sha256").update(`${salt}:${otp}`).digest("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

exports.sendPasswordOtp = functions
  .runWith({ secrets: ["SMTP_USER", "SMTP_PASS"] })
  .https.onCall(async (data) => {
  const email = normalizeEmail(data.email);
  if (!email || !email.includes("@")) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "A valid email is required."
    );
  }

  // Confirm the account exists. We do NOT reveal the result to the caller to
  // avoid account enumeration — we always respond success.
  let userExists = true;
  try {
    await admin.auth().getUserByEmail(email);
  } catch (_) {
    userExists = false;
  }

  if (userExists) {
    // `randomInt` is the CSPRNG, not Math.random — a guessable reset code is a
    // guessable account. padStart keeps leading zeros, so 000042 stays a valid
    // six-digit code rather than becoming "42" and failing its own length
    // check on the way back in.
    const otp = String(crypto.randomInt(0, OTP_MAX_EXCLUSIVE)).padStart(
      OTP_LENGTH,
      "0"
    );
    const salt = crypto.randomBytes(16).toString("hex");

    await db.collection(COLLECTION).doc(email).set({
      hash: hashOtp(otp, salt),
      salt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + OTP_TTL_MINUTES * 60 * 1000
      ),
      attempts: 0,
      used: false,
    });

    try {
      await buildTransport().sendMail({
        from: `"Monticello Villas" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Your password reset code",
        text:
          `Your Monticello Villas password reset code is ${otp}. ` +
          `It expires in ${OTP_TTL_MINUTES} minutes. ` +
          `If you didn't request this, you can ignore this email.`,
        html:
          `<p>Your Monticello Villas password reset code is:</p>` +
          `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p>` +
          `<p>It expires in ${OTP_TTL_MINUTES} minutes. ` +
          `If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (err) {
      console.error("Failed to send OTP email", err);
      throw new functions.https.HttpsError(
        "internal",
        "Could not send the verification email. Try again later."
      );
    }
  }

  return { ok: true };
});

exports.verifyPasswordOtp = functions.https.onCall(async (data) => {
  const email = normalizeEmail(data.email);
  const otp = String(data.otp || "").trim();

  if (!email || otp.length !== OTP_LENGTH) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Email and a ${OTP_LENGTH}-digit code are required.`
    );
  }

  const ref = db.collection(COLLECTION).doc(email);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "No active code. Please request a new one."
    );
  }

  const rec = snap.data();
  if (rec.used) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This code was already used. Request a new one."
    );
  }
  if (rec.expiresAt && rec.expiresAt.toMillis() < Date.now()) {
    throw new functions.https.HttpsError(
      "deadline-exceeded",
      "Code expired. Please request a new one."
    );
  }
  if ((rec.attempts || 0) >= MAX_ATTEMPTS) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      "Too many attempts. Please request a new code."
    );
  }

  if (hashOtp(otp, rec.salt) !== rec.hash) {
    await ref.update({ attempts: admin.firestore.FieldValue.increment(1) });
    throw new functions.https.HttpsError(
      "permission-denied",
      "Incorrect code. Please try again."
    );
  }

  await ref.update({ used: true });

  // Hand the client a one-time reset link so they can set a new password.
  const link = await admin.auth().generatePasswordResetLink(email);
  return { ok: true, resetLink: link };
});

/**
 * Admin/Security web dashboard support.
 *
 *   - onIncidentWrite    -> stores an authoritative wpdaScore on every
 *     incident so every client (web dashboard today, others later) sorts
 *     the same way instead of duplicating the ranking logic per-client.
 *   - onPanicAlertDispatched -> pushes "help is on the way" to the
 *     resident when their SOS is marked acknowledged, from either portal.
 *   - notifyIncidentUpdate -> staff-only callable that pushes an FCM
 *     status-update notification to the resident who filed the incident.
 *   - provisionStaffAccount -> admin-only callable that grants another
 *     user a staff_accounts row (admin/security). The very first admin
 *     must still be seeded by hand in the Firebase Console, since this
 *     function itself requires an existing approved admin to call it.
 */

const PRIORITY_SCORE = { critical: 100, high: 70, medium: 40, low: 15 };
const CATEGORY_SCORE = {
  fire: 100,
  medical: 95,
  security: 70,
  hazard: 60,
  flooding: 55,
  noise: 20,
  maintenance: 15,
};
const WPDA_WEIGHTS = { priority: 0.6, age: 0.25, category: 0.15 };
const WPDA_MAX_AGE_MINUTES = 180;

function computeWpdaScore(data) {
  const priorityScore = PRIORITY_SCORE[data.priority] ?? 40;
  const categoryScore = CATEGORY_SCORE[String(data.category).toLowerCase()] ?? 30;
  const reportedAtMs = data.reportedAt?.toMillis?.() ?? Date.now();
  const ageMinutes = Math.min(
    (Date.now() - reportedAtMs) / 60000,
    WPDA_MAX_AGE_MINUTES
  );
  const ageScore = (ageMinutes / WPDA_MAX_AGE_MINUTES) * 100;

  return (
    priorityScore * WPDA_WEIGHTS.priority +
    ageScore * WPDA_WEIGHTS.age +
    categoryScore * WPDA_WEIGHTS.category
  );
}

exports.onIncidentWrite = functions.firestore
  .document("incidents/{incidentId}")
  .onWrite(async (change) => {
    if (!change.after.exists) return null;
    const data = change.after.data();
    const score = computeWpdaScore(data);
    if (data.wpdaScore === score) return null;
    return change.after.ref.update({ wpdaScore: score });
  });

async function requireStaff(uid, role) {
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  const snap = await db.collection("staff_accounts").doc(uid).get();
  const staff = snap.data();
  if (!snap.exists || staff.status !== "approved") {
    throw new functions.https.HttpsError("permission-denied", "Not an approved staff account.");
  }
  if (role && staff.role !== role) {
    throw new functions.https.HttpsError("permission-denied", `Requires ${role} role.`);
  }
  return staff;
}

exports.notifyIncidentUpdate = functions.https.onCall(async (data, context) => {
  await requireStaff(context.auth && context.auth.uid);

  const { incidentId, status } = data;
  if (!incidentId || !status) {
    throw new functions.https.HttpsError("invalid-argument", "incidentId and status are required.");
  }

  const incidentSnap = await db.collection("incidents").doc(incidentId).get();
  if (!incidentSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Incident not found.");
  }
  const incident = incidentSnap.data();

  const userSnap = await db.collection("users").doc(incident.reporterUid).get();
  const fcmToken = userSnap.exists ? userSnap.data().fcmToken : null;
  if (!fcmToken) return { ok: true, delivered: false };

  await admin.messaging().send({
    token: fcmToken,
    notification: {
      title: incident.title,
      body: `Your report is now marked as ${status}.`,
    },
    data: { incidentId, status },
  });

  return { ok: true, delivered: true };
});

const STAFF_ROLES = ["super_admin", "hoa_admin", "security_head", "security_officer"];
const SECURITY_STAFF_ROLES = ["super_admin", "security_head", "security_officer"];

exports.provisionStaffAccount = functions.https.onCall(async (data, context) => {
  await requireStaff(context.auth && context.auth.uid, "super_admin");

  const { uid, role, name } = data;
  if (!uid || !STAFF_ROLES.includes(role)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `uid and a role of one of [${STAFF_ROLES.join(", ")}] are required.`
    );
  }

  await db.collection("staff_accounts").doc(uid).set(
    {
      role,
      name: name || "",
      status: "approved",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
});

// Roles a super_admin may hand out from the "Invite staff" dashboard form.
// Deliberately excludes super_admin itself: minting more super admins stays a
// Console/provisionStaffAccount-by-uid action so a single compromised or
// careless admin session can't self-replicate top-level access from the UI.
const INVITE_ROLES = STAFF_ROLES.filter((role) => role !== "super_admin");

/**
 * createStaffAccount -> super_admin-only callable used by the "Invite staff"
 * form on the Admin dashboard. If the email has no Firebase Auth user yet,
 * creates one with a random (never transmitted) password and emails the new
 * staff member a link to set their own — the admin never sees or chooses
 * their password, mirroring sendPasswordOtp/verifyPasswordOtp above. If the
 * email already belongs to an existing user (e.g. a resident account), the
 * staff_accounts role is simply attached to that uid.
 */
exports.createStaffAccount = functions
  .runWith({ secrets: ["SMTP_USER", "SMTP_PASS"] })
  .https.onCall(async (data, context) => {
    await requireStaff(context.auth && context.auth.uid, "super_admin");

    const email = normalizeEmail(data.email);
    const name = String(data.name || "").trim();
    const role = data.role;

    if (!email || !email.includes("@")) {
      throw new functions.https.HttpsError("invalid-argument", "A valid email is required.");
    }
    if (!INVITE_ROLES.includes(role)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `role must be one of [${INVITE_ROLES.join(", ")}].`
      );
    }

    let userRecord;
    let created = false;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (_) {
      const tempPassword = crypto.randomBytes(24).toString("base64");
      userRecord = await admin.auth().createUser({
        email,
        password: tempPassword,
        displayName: name || undefined,
      });
      created = true;
    }

    await db.collection("staff_accounts").doc(userRecord.uid).set(
      {
        role,
        name: name || userRecord.displayName || "",
        email,
        status: "approved",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (created) {
      const link = await admin.auth().generatePasswordResetLink(email);
      try {
        await buildTransport().sendMail({
          from: `"Monticello Villas" <${process.env.SMTP_USER}>`,
          to: email,
          subject: "You've been added to the Monticello Villas dashboard",
          text:
            `You've been granted ${role.replace("_", " ")} access to the Monticello Villas ` +
            `dashboard. Set your password to sign in: ${link}`,
          html:
            `<p>You've been granted <b>${role.replace("_", " ")}</b> access to the Monticello ` +
            `Villas dashboard.</p>` +
            `<p><a href="${link}">Set your password to sign in</a></p>`,
        });
      } catch (err) {
        console.error("Failed to send staff invite email", err);
        // The account and role are already saved; the admin can tell the
        // new hire to use "Forgot password" on the login screen instead.
      }
    }

    return { ok: true, uid: userRecord.uid, created };
  });

/**
 * onPanicAlertCreate -> fans out a high-priority FCM push to every on-duty
 * security staff member the moment a resident's SOS write lands
 * (panic_alerts/{alertId}, created client-side from
 * lib/screens/panic_button_screen.dart). Mirrors onIncidentWrite's pattern
 * of doing privileged fan-out server-side instead of trusting the client.
 */
/**
 * onPanicAlertDispatched -> tells the resident help is coming, the moment an
 * operator marks their SOS as responded to.
 *
 * ── WHY A DOCUMENT TRIGGER AND NOT A CALLABLE ─────────────────────────────
 * `notifyIncidentUpdate` is a callable the client invokes after its own write,
 * which means the push only happens if that second call is made and succeeds.
 * Two consoles can dispatch this alert — Admin and Security — and a resident
 * who pressed a panic button must not be left in silence because whichever one
 * responded forgot to fire the notification, lost connectivity between the two
 * calls, or was closed mid-action.
 *
 * Triggering off the document makes the write itself the event. Any client,
 * any portal, even a hand edit in the Console, produces the same push.
 *
 * ── FIRES ONCE, ON THE TRANSITION ─────────────────────────────────────────
 * Guarded on before !== after. `onUpdate` runs for every field change, and an
 * acknowledged alert is written again when it is resolved, when notes are
 * added, whenever `updatedAt` moves — without the guard a resident would get
 * "help is on the way" repeatedly, including after it had already arrived.
 */
exports.onPanicAlertDispatched = functions.firestore
  .document("panic_alerts/{alertId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // The one transition worth a push: nothing -> responding.
    if (before.status === after.status) return null;
    if (after.status !== "acknowledged") return null;

    const residentUid = after.residentUid;
    if (!residentUid) return null;

    const userSnap = await db.collection("users").doc(residentUid).get();
    const fcmToken = userSnap.exists ? userSnap.data().fcmToken : null;
    // No token is not an error. A resident who has never opened the app since
    // notifications were added still has a live alert on every guard console;
    // failing here would only add noise to the function logs.
    if (!fcmToken) return null;

    return admin.messaging().send({
      token: fcmToken,
      notification: {
        title: "Help is on the way!",
        body: "Security personnel have been dispatched to your location.",
      },
      data: {
        type: "panic_dispatched",
        alertId: context.params.alertId,
        status: after.status,
      },
      // Same delivery class as the SOS fan-out itself. This is the answer to
      // an emergency the resident raised — it must not be held behind Doze or
      // batched with routine traffic.
      android: { priority: "high" },
      apns: { headers: { "apns-priority": "10" } },
    });
  });

exports.onPanicAlertCreate = functions.firestore
  .document("panic_alerts/{alertId}")
  .onCreate(async (snap) => {
    const alert = snap.data();

    const officers = await db
      .collection("staff_accounts")
      .where("status", "==", "approved")
      .where("role", "in", SECURITY_STAFF_ROLES)
      .where("onDuty", "==", true)
      .get();

    const tokens = officers.docs
      .flatMap((o) => o.data().fcmTokens || [])
      .filter(Boolean);

    if (tokens.length === 0) return null;

    return admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: "PANIC ALERT",
        body: `${alert.residentName || "A resident"} · ${alert.propertyLabel || "Unknown address"}`,
      },
      data: { type: "panic", alertId: snap.id },
      android: { priority: "high" },
      apns: { headers: { "apns-priority": "10" } },
    });
  });

/**
 * ── SECURITY ACCOUNT PROVISIONING ───────────────────────────────────────────
 *
 * The Admin Portal's Security Accounts page. Five callables, in
 * ./securityProvisioning.js rather than inline here, because this file is
 * already five unrelated concerns long and the provisioning set shares a
 * vocabulary (roles, posts, shifts, duties, statuses) that is meaningless to
 * the rest of it.
 *
 * REQUIRED AFTER `admin.initializeApp()`, and that is why this block sits at
 * the bottom of the file rather than with the other requires at the top. The
 * module calls `admin.firestore()` at import time; hoisting it above the
 * initialisation throws "The default Firebase app does not exist" during
 * deployment analysis, before any function has run.
 *
 * Re-exported by name rather than `Object.assign(exports, …)` so
 * `firebase deploy --only functions:createSecurityAccount` works and so the
 * deployable surface of this file can be read from this file.
 */
const securityProvisioning = require("./securityProvisioning");

exports.createSecurityAccount = securityProvisioning.createSecurityAccount;
exports.resetSecurityCredential = securityProvisioning.resetSecurityCredential;
exports.setSecurityAccountStatus = securityProvisioning.setSecurityAccountStatus;
exports.updateSecurityAssignment = securityProvisioning.updateSecurityAssignment;
exports.deleteSecurityAccount = securityProvisioning.deleteSecurityAccount;
