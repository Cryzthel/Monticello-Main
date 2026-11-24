/**
 * requestEmailChange / confirmEmailChange — a staff member's own sign-in email,
 * changed only after a 6-digit code sent to the NEW address is typed back.
 *
 * ── WHY IT REPLACED verifyBeforeUpdateEmail (2026-10-19) ───────────────────
 * The link flow changed the account the moment the link was opened, from any
 * inbox, in any browser — no console, no password, no record of who asked. On
 * 2026-10-19 the primary admin address moved to a test inbox that way, and
 * the password-reset lookup then reported the real address as "not
 * registered". This flow keeps every step inside the console that started it:
 *
 *   1. requestEmailChange({ newEmail })
 *        • caller signed in, an approved staff account, and RE-AUTHENTICATED
 *          within the last REAUTH_WINDOW_S (the console asks for the password
 *          and refreshes the ID token first; `auth_time` proves it here);
 *        • the new address is valid, different, and not already an account;
 *        • a 6-digit code (hashed + salted, never stored in clear) is mailed
 *          to the NEW address, which is what proves the admin owns it.
 *   2. confirmEmailChange({ otp })
 *        • same caller, still within the re-auth window, code unexpired and
 *          inside its attempt budget;
 *        • THEN, and only then, Firebase Auth's email is changed (verified,
 *          since the code just proved the inbox), the staff record is synced,
 *          a `staff.email.changed` entry lands in provisioning_logs (Audit
 *          History), and the OLD address is told, so a takeover is noticed.
 *
 * Nothing about the account changes before step 2 succeeds. Codes live in
 * `email_change_otps/{uid}`, which firestore.rules closes to every client.
 */
const crypto = require("crypto");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { sendMail, mailSecrets, buildEmailChangeCodeEmail, buildEmailChangedNotice } = require("./mailer");

const db = admin.firestore();

const COLLECTION = "email_change_otps";
const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
/** Guesses accumulate across resends inside this window (see sendPasswordOtp). */
const ATTEMPT_WINDOW_MS = 30 * 60 * 1000;
/** How recent the password check must be, in seconds. */
const REAUTH_WINDOW_S = 10 * 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashCode(code, salt) {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function sameHash(a, b) {
  const x = Buffer.from(String(a), "hex");
  const y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function fail(code, message, reason) {
  return new functions.https.HttpsError(code, message, reason ? { reason } : undefined);
}

/** The caller's uid and staff record, after the re-auth check. Pure checks first. */
async function authorise(context, nowS = Math.floor(Date.now() / 1000)) {
  const uid = context.auth && context.auth.uid;
  if (!uid) throw fail("unauthenticated", "Sign in required.");
  const authTime = Number(context.auth.token && context.auth.token.auth_time);
  if (!Number.isFinite(authTime) || nowS - authTime > REAUTH_WINDOW_S) {
    throw fail("failed-precondition", "Confirm your password again to continue.", "reauth-required");
  }
  const snap = await db.collection("staff_accounts").doc(uid).get();
  if (!snap.exists || snap.data().status !== "approved") {
    throw fail("permission-denied", "Only active staff accounts can change their email here.");
  }
  return { uid, staff: snap.data() };
}

exports.requestEmailChange = functions
  .runWith({ secrets: mailSecrets() })
  .https.onCall(async (data, context) => {
    const { uid } = await authorise(context);
    const user = await admin.auth().getUser(uid);
    const current = normalizeEmail(user.email);
    const next = normalizeEmail(data && data.newEmail);

    if (!EMAIL_RE.test(next)) throw fail("invalid-argument", "Enter a valid email address.", "invalid-email");
    if (next === current) throw fail("invalid-argument", "That is already your sign-in email.", "same-email");
    try {
      await admin.auth().getUserByEmail(next);
      throw fail("already-exists", "That address already belongs to another account.", "email-in-use");
    } catch (err) {
      if (err instanceof functions.https.HttpsError) throw err;
      if (err && err.code !== "auth/user-not-found") {
        console.error("requestEmailChange: lookup failed", err.code, err.message);
        throw fail("unavailable", "Could not check that address. Try again shortly.");
      }
    }

    const ref = db.collection(COLLECTION).doc(uid);
    const prev = (await ref.get()).data();
    const now = Date.now();
    const lastSentAt = (prev && prev.lastSentAt && prev.lastSentAt.toMillis()) || 0;
    // Same address inside the cooldown: the code already sent stays live.
    if (prev && prev.newEmail === next && now - lastSentAt < RESEND_COOLDOWN_MS) {
      return { ok: true, sentTo: next, resent: false, length: CODE_LENGTH };
    }

    const windowStartedAt = (prev && prev.windowStartedAt && prev.windowStartedAt.toMillis()) || 0;
    const inWindow = Boolean(prev) && now - windowStartedAt < ATTEMPT_WINDOW_MS;
    const code = String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
    const salt = crypto.randomBytes(16).toString("hex");

    await ref.set({
      newEmail: next,
      fromEmail: current,
      hash: hashCode(code, salt),
      salt,
      expiresAt: admin.firestore.Timestamp.fromMillis(now + CODE_TTL_MINUTES * 60 * 1000),
      attempts: inWindow ? prev.attempts || 0 : 0,
      windowStartedAt: inWindow ? prev.windowStartedAt : admin.firestore.Timestamp.fromMillis(now),
      lastSentAt: admin.firestore.Timestamp.fromMillis(now),
    });

    try {
      const mail = buildEmailChangeCodeEmail(code, CODE_TTL_MINUTES);
      await sendMail({ to: next, ...mail, headers: { "X-Entity-Ref-ID": crypto.randomUUID() } });
    } catch (err) {
      console.error("requestEmailChange: mail failed", err);
      throw fail("internal", "Could not send the code email.", "mail-failed");
    }
    return { ok: true, sentTo: next, resent: Boolean(prev), length: CODE_LENGTH };
  });

exports.confirmEmailChange = functions
  .runWith({ secrets: mailSecrets() })
  .https.onCall(async (data, context) => {
    const { uid, staff } = await authorise(context);
    const code = String((data && data.otp) || "").replace(/\D/g, "");
    if (code.length !== CODE_LENGTH) throw fail("invalid-argument", `Enter the ${CODE_LENGTH}-digit code.`, "bad-code");

    const ref = db.collection(COLLECTION).doc(uid);
    const record = (await ref.get()).data();
    if (!record) throw fail("failed-precondition", "Request a new code to continue.", "no-request");
    if (record.expiresAt.toMillis() < Date.now()) {
      throw fail("deadline-exceeded", "That code has expired. Send a new one.", "expired");
    }
    if ((record.attempts || 0) >= MAX_ATTEMPTS) {
      throw fail("resource-exhausted", "Too many wrong codes. Wait a while and request a new one.", "locked");
    }
    if (!sameHash(hashCode(code, record.salt), record.hash)) {
      const attempts = (record.attempts || 0) + 1;
      await ref.update({ attempts });
      throw fail("permission-denied", "That code is not right.", attempts >= MAX_ATTEMPTS ? "locked" : "wrong-code");
    }

    const before = await admin.auth().getUser(uid);
    const from = normalizeEmail(before.email);
    const to = record.newEmail;
    try {
      await admin.auth().updateUser(uid, { email: to, emailVerified: true });
    } catch (err) {
      if (err && err.code === "auth/email-already-exists") {
        throw fail("already-exists", "That address already belongs to another account.", "email-in-use");
      }
      throw err;
    }
    await ref.delete();

    await db.collection("staff_accounts").doc(uid).set(
      { email: to, emailVerified: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    await db.collection("provisioning_logs").add({
      action: "staff.email.changed",
      category: "security",
      actorUid: uid,
      actorName: staff.name || to,
      targetUid: uid,
      targetName: staff.name || "",
      targetEmail: to,
      summary: `${staff.name || "A staff member"} changed their sign-in email from ${from || "(none)"} to ${to}`,
      metadata: { from, to, emailVerified: true, method: "otp" },
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Best-effort: the change has happened, and a failed notice must not undo it.
    if (from) {
      try {
        await sendMail({ to: from, ...buildEmailChangedNotice(from, to) });
      } catch (err) {
        console.error("confirmEmailChange: notice to old address failed", err);
      }
    }
    return { ok: true, email: to };
  });

// For tests.
exports._internals = { hashCode, sameHash, normalizeEmail, CODE_LENGTH, REAUTH_WINDOW_S, authorise };
