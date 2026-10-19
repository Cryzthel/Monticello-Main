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
 *
 * ── THE RECORD: password_reset_otps/{email} ────────────────────────────────
 *
 *   field            type        meaning
 *   ───────────────  ──────────  ─────────────────────────────────────────────
 *   (doc id)         string      the normalised email — ONE live code per
 *                                address, so a resend replaces, never stacks
 *   email            string      the same, as a field, so it can be queried
 *   uid              string      Firebase Auth uid the code would reset
 *   hash             string      sha256(salt + ":" + code), hex — never the code
 *   salt             string      16 random bytes, hex, fresh per code
 *   expiresAt        Timestamp   issue + OTP_TTL_MINUTES; refused after
 *   used             boolean     true once verified; a used code never works
 *   usedAt           Timestamp   when it was verified (absent until then)
 *   attempts         number      wrong guesses in the current window
 *   windowStartedAt  Timestamp   start of the OTP_ATTEMPT_WINDOW_MS budget
 *   lastSentAt       Timestamp   when a code last actually reached the inbox
 *   createdAt        Timestamp   when THIS code was issued
 *   requestIp        string      caller IP at issue, for abuse review
 *   usedIp           string      caller IP at verification
 *   purgeAt          Timestamp   Firestore TTL field — see PURGE_AFTER_MS
 *
 * Clients can neither read nor write this collection (firestore.rules names
 * it explicitly); only the Admin SDK here touches it. The relational version
 * of the same table, with the constraints Firestore cannot state, is
 * db/schema.auth.postgres.sql (`password_resets`).
 */

const crypto = require("crypto");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
// Transactional mail: Resend or Gmail SMTP, chosen in functions/.env.
const { sendMail, mailSecrets, buildResetCodeEmail } = require("./mailer");

admin.initializeApp();
const db = admin.firestore();

// Admin Portal › Settings › Push notifications.
const { residentPushEnabled } = require("./systemSettings");

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const COLLECTION = "password_reset_otps";

/**
 * How long a record outlives its code before Firestore's TTL deletes it.
 *
 * NOT `expiresAt`, and the difference matters. The record also carries the
 * attempt window (OTP_ATTEMPT_WINDOW_MS, 30 minutes) and the resend cooldown.
 * A TTL on `expiresAt` would delete it ten minutes in, and with it the count
 * of wrong guesses — handing the next request a fresh budget, which is exactly
 * the reset the window exists to prevent. A day clears both with room to
 * spare and still means an IP address is not kept indefinitely.
 *
 * The TTL policy itself is a one-time console / gcloud setting, not code:
 *   gcloud firestore fields ttls update purgeAt \
 *     --collection-group=password_reset_otps --enable-ttl
 */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The caller's address, for abuse review only — it never gates anything.
 *
 * The first `x-forwarded-for` hop is the client; Google's front end appends
 * itself after it. Falls back to the socket address, then to null rather than
 * a made-up value.
 */
function requestIpOf(context) {
  const req = context && context.rawRequest;
  if (!req) return null;
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.ip || null;
}

// ── HOW MANY DIGITS A RESET CODE HAS ────────────────────────────────────────
//
// FOUR DIGITS, BY DECISION (2026-10-16). It was six; the estate asked for
// four. What that costs, stated so nobody has to rediscover it: 10,000 values
// against the 5-guess, 30-minute budget below is about a 1-in-2,000 chance per
// window per account, against 1-in-200,000 at six. The attempt window and the
// resend cooldown are what keep four survivable — weaken either and four is
// not safe at all.
//
// THIS IS ONE OF THREE. `kOtpLength` in
// lib/features/auth/widgets/otp_pin_input.dart and RESET_CODE_LENGTH in
// web-portal/packages/shared/src/auth/PasswordRecovery.jsx are the others.
// `verifyPasswordOtp` rejects a code of the wrong length before it reaches the
// hash comparison, so a mismatch fails every reset at the same step.
const OTP_LENGTH = 4;
const OTP_MAX_EXCLUSIVE = 10 ** OTP_LENGTH;

/**
 * A resend inside this window is answered with success, but sends nothing and
 * reissues nothing. The code already in the caller's inbox stays live, so the
 * legitimate flow is unaffected — the user types the code they were sent.
 */
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Guesses are counted per ADDRESS over this window, not per issued code.
 *
 * WHY. MAX_ATTEMPTS caps guesses at five, which is a sound cap only if five is
 * all a caller ever gets. `sendPasswordOtp` overwrote the record with
 * `attempts: 0`, so five wrong guesses followed by another send returned a full
 * budget; the call is unauthenticated and was unthrottled, so against the
 * 4-digit code this replaced — 10,000 values — roughly 2,000 send-and-guess
 * cycles walked the entire keyspace. The window makes the cap cumulative and
 * the cooldown bounds the email flood that refilling it required.
 *
 * OTP_LENGTH WENT 4 → 6 → 4. It is four again by the estate's decision, which
 * makes this window the ONLY thing standing between the code and the walk
 * described above. Do not loosen it, and do not reset `attempts` on a send.
 */
const OTP_ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

// Mail credentials live in Google Secret Manager and reach the function as
// environment variables; which ones depends on MAIL_PROVIDER in functions/.env.
// See functions/mailer.js and functions/MAIL_SETUP.md.

function hashOtp(otp, salt) {
  return crypto.createHash("sha256").update(`${salt}:${otp}`).digest("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

exports.sendPasswordOtp = functions
  .runWith({ secrets: mailSecrets() })
  .https.onCall(async (data, context) => {
  const email = normalizeEmail(data.email);
  if (!email || !email.includes("@")) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "A valid email is required."
    );
  }

  // ── AN UNREGISTERED ADDRESS IS TOLD SO (decision, 2026-10-16) ─────────
  // This used to answer `{ ok: true }` for every address so that nobody could
  // learn which emails have accounts. The estate chose the clearer message
  // instead: a resident who mistypes their address is told at once, under the
  // field, rather than waiting for a code that will never come.
  //
  // The trade, on the record: anyone can now ask this function whether an
  // address is registered. The per-address cooldown below does not slow that
  // (it only applies to registered addresses), so the lookup is as fast as
  // the caller can call. If probing is ever seen in the logs, the fix is a
  // per-`requestIp` throttle here — not going back to silence, which the
  // clients no longer expect.
  //
  // `failed-precondition` with `details.reason`, NOT `not-found`: both clients
  // read `not-found` as "the function is not deployed".
  //
  // ONLY `auth/user-not-found` means "not registered". Every other failure (a
  // quota, an IAM or network error) used to be swallowed into the same
  // answer, so an outage told a real admin their address did not exist.
  let uid = null;
  try {
    uid = (await admin.auth().getUserByEmail(email)).uid;
  } catch (err) {
    if (err?.code !== "auth/user-not-found") {
      console.error("sendPasswordOtp: account lookup failed", err?.code, err?.message);
      throw new functions.https.HttpsError("unavailable", "Could not check that address. Try again shortly.");
    }
    uid = null;
  }
  if (!uid) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This email address is not registered.",
      { reason: "not-registered" }
    );
  }
  const userExists = true;

  if (userExists) {
    const ref = db.collection(COLLECTION).doc(email);
    const prev = (await ref.get()).data();

    const now = Date.now();
    const lastSentAt = prev?.lastSentAt?.toMillis?.() ?? 0;

    // Refused silently, and with the same `{ ok: true }` an unknown address
    // gets: a "wait 60 seconds" error would tell a caller which emails are
    // registered, which is the very thing the rest of this function lies to
    // protect. Nothing is reissued, so the code already sent still verifies.
    if (now - lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      return { ok: true };
    }

    // An open window carries its spent guesses onto the new code. This is the
    // line that makes MAX_ATTEMPTS a budget rather than a per-code allowance.
    // `Boolean(prev)` is load-bearing, not belt-and-braces: with no record the
    // start time reads 0, and `now - 0 < WINDOW` is only false because the real
    // clock is an epoch. Under a test or emulator clock that comparison flips
    // and the branch below dereferences an absent document.
    const windowStartedAt = prev?.windowStartedAt?.toMillis?.() ?? 0;
    const windowOpen =
      Boolean(prev) && now - windowStartedAt < OTP_ATTEMPT_WINDOW_MS;

    // `randomInt` is the CSPRNG, not Math.random — a guessable reset code is a
    // guessable account. padStart keeps leading zeros, so 000042 stays a valid
    // six-digit code rather than becoming "42" and failing its own length
    // check on the way back in.
    const otp = String(crypto.randomInt(0, OTP_MAX_EXCLUSIVE)).padStart(
      OTP_LENGTH,
      "0"
    );
    const salt = crypto.randomBytes(16).toString("hex");

    // `lastSentAt` is deliberately NOT written here. It is stamped only once
    // the mail is away, so a failed send does not start a cooldown against a
    // caller who never received anything.
    await ref.set({
      email,
      uid,
      hash: hashOtp(otp, salt),
      salt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(
        now + OTP_TTL_MINUTES * 60 * 1000
      ),
      attempts: windowOpen ? prev?.attempts ?? 0 : 0,
      windowStartedAt: windowOpen
        ? prev.windowStartedAt
        : admin.firestore.Timestamp.fromMillis(now),
      used: false,
      requestIp: requestIpOf(context),
      purgeAt: admin.firestore.Timestamp.fromMillis(now + PURGE_AFTER_MS),
      ...(lastSentAt ? { lastSentAt: prev.lastSentAt } : {}),
    });

    try {
      const mail = buildResetCodeEmail(otp, OTP_TTL_MINUTES);
      await sendMail({
        to: email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        // Gmail threads messages that share a subject and participants, so a
        // resent code would be filed UNDER the first one and the resident
        // would read the stale code. A unique reference per message opts a
        // transactional mail out of that grouping. Its own random value —
        // never the OTP's salt, which protects the stored hash.
        headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
      });
    } catch (err) {
      console.error("Failed to send OTP email", err);
      // `details.reason` so a client can tell "the mail provider refused"
      // from "the function did not run". Both arrive as `internal`, and the
      // web portal used to show this one as "Password reset is unavailable",
      // which on 2026-10-16 hid a rejected Gmail login behind what read as a
      // billing outage. The code stays `internal` so the mobile app's existing
      // handling is unchanged.
      throw new functions.https.HttpsError(
        "internal",
        "Could not send the verification email. Try again later.",
        { reason: "mail-failed" }
      );
    }

    // The cooldown starts when a code actually reaches the caller.
    await ref.update({
      lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { ok: true };
});

exports.verifyPasswordOtp = functions.https.onCall(async (data, context) => {
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

  await ref.update({
    used: true,
    usedAt: admin.firestore.FieldValue.serverTimestamp(),
    usedIp: requestIpOf(context),
  });

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

/**
 * Human-quotable reference for one incident.
 *
 * MIRRORS `incidentReference` in
 * web-portal/apps/security-portal/src/lib/dispatch.js. The resident reads this
 * string in a push and then reads it again on the guard's screen when they
 * ring the guardhouse about it, so the two have to agree character for
 * character. Change one, change the other.
 */
function incidentReference(incidentId) {
  return `INC-${String(incidentId).slice(0, 8).toUpperCase()}`;
}

/**
 * What the resident actually reads, per transition.
 *
 * ── THIS COPY IS MIRRORED ON THE CLIENT ────────────────────────────────────
 * `RESIDENT_NOTIFICATION_COPY` in
 * web-portal/apps/security-portal/src/lib/dispatch.js renders the same three
 * sentences as a preview inside the dispatch drawer, so an officer sees the
 * message before they send it. THIS function is the authority — it is what is
 * actually delivered — and the client copy exists only to show it. The two
 * files point at each other; edit them together.
 *
 * A shared module would be better and is not currently possible: `functions/`
 * is CommonJS on the Firebase runtime and `web-portal/` is ESM built by Vite,
 * with no package spanning them.
 *
 * ── WHY EACH LINE SAYS WHAT IT SAYS ────────────────────────────────────────
 * The old body was one generic sentence for every state — "Your report is now
 * marked as Dispatched." That is a status code read aloud. It tells a resident
 * standing in their driveway nothing about whether anyone is coming, who, or
 * whether it is over. Each transition now answers the question the resident is
 * actually asking at that moment:
 *
 *   Dispatched   is someone coming, and who?
 *   In Progress  are they here yet?
 *   Resolved     is it finished, and what do I quote if it is not?
 *
 * `unit` falls back to "Security" rather than interpolating an empty string,
 * which would produce "Patrol unit  has been dispatched". The field is stamped
 * by updateIncidentStatus on the same write that triggers this call, so in
 * practice it is populated by the time this re-reads the document.
 */
function residentNotification(incident, status, incidentId, stage) {
  const unit = incident.assignedGuardName || "Security";
  const reference = incidentReference(incidentId);

  // ── DISPATCH STAGES ──────────────────────────────────────────────────────
  // The Guardhouse now sends the stage alongside the display status (see
  // notifyResident in web-portal/packages/shared/src/lib/incidents.js). A
  // stage says more than a status can: "Dispatched" covers both "a guard was
  // picked" and "the guard accepted and is on the way", and only the second
  // is worth telling a resident. Mirrored by residentMessageForStage in
  // web-portal/apps/security-portal/src/lib/dispatch.js.
  switch (stage) {
    case "responding":
      return {
        title: "Guard en route",
        body: `Guard ${unit} is en route to your location.`,
      };
    case "on_site":
      return {
        title: "Guard has arrived",
        body: `Guard ${unit} has arrived and is handling your report.`,
      };
    case "resolved":
      return {
        title: "Report resolved",
        body: `Your incident report #${reference} has been resolved. Tap to rate the response.`,
      };
    default:
      break;
  }

  switch (status) {
    case "Dispatched":
      return {
        title: "Patrol unit dispatched",
        body: `Security has verified your report. Patrol unit ${unit} has been dispatched to your location.`,
      };
    // Both spellings, deliberately. The console sends the DISPLAY status, and
    // the web app and this function deploy separately — so between shipping
    // the "On-Site" rename and running `firebase deploy --only functions`
    // there is a window where the browser sends a label this switch has never
    // heard of. That would not error; it would fall to `default` and send the
    // resident a generic "marked as On-Site", which is the wrong sentence at
    // the one moment they most want to know somebody has arrived.
    //
    // "In Progress" can also still arrive from an older cached bundle after
    // the deploy. Accepting both costs one line and closes the window in both
    // directions.
    case "On-Site":
    case "In Progress":
      return {
        title: "Unit on site",
        body: `Security unit ${unit} is currently on-site handling your reported incident.`,
      };
    case "Resolved":
      return {
        title: "Report resolved",
        body: `Your incident report #${reference} has been marked as resolved by security.`,
      };
    default:
      // Verified/Pending are not driven from any console today — see
      // SETTABLE_STATUSES — but a transition reaching here must still say
      // something true rather than throw.
      return {
        title: incident.title || "Report update",
        body: `Your report is now marked as ${status}.`,
      };
  }
}

exports.notifyIncidentUpdate = functions.https.onCall(async (data, context) => {
  await requireStaff(context.auth && context.auth.uid);

  const { incidentId, status, stage } = data;
  if (!incidentId || !status) {
    throw new functions.https.HttpsError("invalid-argument", "incidentId and status are required.");
  }

  const incidentSnap = await db.collection("incidents").doc(incidentId).get();
  if (!incidentSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Incident not found.");
  }
  const incident = incidentSnap.data();

  // Admin › Settings › Push notifications. The status write has already
  // happened; only the push is skipped, and the console is told why so the
  // officer knows the resident was not reached.
  if (!(await residentPushEnabled())) {
    return { ok: true, delivered: false, reason: "disabled" };
  }

  const userSnap = await db.collection("users").doc(incident.reporterUid).get();
  const fcmToken = userSnap.exists ? userSnap.data().fcmToken : null;

  // ── `reason` IS NEW, AND IT IS THE POINT ────────────────────────────────
  //
  // This returned `{ ok: true, delivered: false }` and the caller discarded
  // it, so "the resident has no device registered" and "the push went out"
  // were indistinguishable from the guardhouse — on the one screen where an
  // officer decides whether they still need to knock on the door.
  //
  // No token is still NOT an error: the status change has already been
  // written and is visible in the resident's app whenever they next open it.
  // It is a delivery outcome, and the console now says which one.
  if (!fcmToken) {
    return { ok: true, delivered: false, reason: "no-token" };
  }

  const message = residentNotification(incident, status, incidentId, stage);

  await admin.messaging().send({
    token: fcmToken,
    notification: message,
    // `reference` rides along so the app can deep-link to the report without
    // re-deriving the short form and risking a different answer. `type` tells
    // the app a resolved report wants a 1–5 star rating; the prompt itself
    // is driven by `ratingRequestedAt` on the document, so a resident who
    // missed the push is still asked when they next open the report.
    data: {
      incidentId,
      status,
      stage: stage || "",
      type: stage === "resolved" ? "rating_request" : "status_update",
      reference: incidentReference(incidentId),
    },
  });

  return { ok: true, delivered: true, reason: "sent" };
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
  .runWith({ secrets: mailSecrets() })
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
        await sendMail({
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

    // Admin › Settings › Push notifications covers this resident message too.
    // The officer fan-out below (onPanicAlertCreate) deliberately does not
    // read the switch: it is the alarm itself.
    if (!(await residentPushEnabled())) return null;

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

    // ON DUTY MEANS AN OPEN SHIFT, not a flag on the staff account.
    //
    // This query used to add `.where("onDuty", "==", true)` to the staff
    // lookup. Nothing in the system ever sets that field true:
    // securityProvisioning writes `onDuty: false` when an account is created
    // and again when it is deactivated, and duty itself moved to
    // `guard_shifts` — a row is added on clock-in and stamped with `timeOut`
    // on clock-out (web-portal/packages/shared/src/lib/shifts.js). The
    // guardhouse duty lock, the live unit list and the admin timesheet all
    // read that collection. So the old predicate matched zero documents on
    // every alert ever raised, and this fan-out was unreachable.
    //
    // Both queries are small — one subdivision's security roster, and the
    // shifts currently open — and independent, so they run together and are
    // intersected in memory. Firestore cannot join them, and a composite
    // query on `guard_shifts` would still not carry role or status.
    const [officers, openShifts] = await Promise.all([
      db
        .collection("staff_accounts")
        .where("status", "==", "approved")
        .where("role", "in", SECURITY_STAFF_ROLES)
        .get(),
      db.collection("guard_shifts").where("timeOut", "==", null).get(),
    ]);

    // `staff_accounts` is keyed by uid, which is what a shift row stamps.
    const onDutyUids = new Set(
      openShifts.docs.map((s) => s.data().guardUid).filter(Boolean),
    );

    const tokens = officers.docs
      .filter((o) => onDutyUids.has(o.id))
      .flatMap((o) => o.data().fcmTokens || [])
      .filter(Boolean);

    // Still nothing to send to until officer devices register tokens — no
    // client writes `staff_accounts.fcmTokens` yet. The guardhouse console
    // raises the alarm over its own live listener and siren, which is what
    // actually wakes the guardhouse today; this push is the out-of-console
    // path and stays dormant until registration exists.
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
exports.reconcilePasswordResetFlags = securityProvisioning.reconcilePasswordResetFlags;

/**
 * OFFICER PRESENCE. Mirrors the Realtime Database `presence/{uid}` node the
 * Guardhouse publishes into Firestore `staff_presence/{uid}` for the Admin
 * roster's Online / Last seen column. See ./presence.js.
 */
const presence = require("./presence");

exports.onPresenceWrite = presence.onPresenceWrite;

/**
 * STAFF EMAIL SYNC. Copies the caller's own Auth email and verified flag onto
 * their staff record after a verified email change. See ./accountSync.js.
 */
const accountSync = require("./accountSync");

exports.syncStaffEmail = accountSync.syncStaffEmail;
exports.recordPasswordChange = accountSync.recordPasswordChange;

// The OTP-verified email change (replaces verifyBeforeUpdateEmail; see the file).
const emailChange = require("./emailChange");
exports.requestEmailChange = emailChange.requestEmailChange;
exports.confirmEmailChange = emailChange.confirmEmailChange;

/**
 * THE SCHEDULED OPERATIONS SWEEP.
 *
 * The four Admin > Settings values that describe something happening after a
 * delay — SOS escalation, hazard archiving, SLA targets, audit retention — in
 * one Cloud Scheduler job. Lives in ./operationsSweep.js because its decision
 * logic is split into a pure, tested module (./sweepRules.js) and that
 * separation is easier to see as two files than as one more section here.
 *
 * Needs the Blaze plan: scheduled functions cannot deploy on Spark.
 */
const operationsSweep = require("./operationsSweep");

exports.operationsSweep = operationsSweep.operationsSweep;
