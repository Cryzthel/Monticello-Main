/**
 * syncStaffEmail — bring the caller's staff record in line with Firebase Auth.
 *
 * An administrator changes their own sign-in email from Settings with
 * `verifyBeforeUpdateEmail`: Auth sends a link to the NEW address and only
 * switches the account once that link is opened. Nothing tells Firestore, and
 * `staff_accounts` is not client-writable (it is what every role check reads),
 * so the record kept the old address — which is the one the directory, the
 * audit trail and the password-recovery lookup show.
 *
 * The client calls this after sign-in and when Settings regains focus. It is
 * deliberately argument-free: the server reads the email and its verified flag
 * from the Auth record itself, so a caller can only ever copy THEIR OWN,
 * already-verified state onto THEIR OWN record. There is nothing to forge.
 *
 * A change is written to `provisioning_logs`, so the trail shows when an
 * account's address moved and from what.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");

const db = admin.firestore();

exports.syncStaffEmail = functions.https.onCall(async (data, context) => {
  const uid = context.auth && context.auth.uid;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }

  const ref = db.collection("staff_accounts").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, changed: false };
  const staff = snap.data();

  const user = await admin.auth().getUser(uid);
  const email = String(user.email || "").toLowerCase();
  const emailVerified = Boolean(user.emailVerified);
  if (!email) return { ok: true, changed: false };

  const emailChanged = email !== String(staff.email || "").toLowerCase();
  const verifiedChanged = emailVerified !== Boolean(staff.emailVerified);
  if (!emailChanged && !verifiedChanged) {
    return { ok: true, changed: false, email, emailVerified };
  }

  await ref.set({
    email,
    emailVerified,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  if (emailChanged) {
    await db.collection("provisioning_logs").add({
      action: "staff.email.changed",
      category: "security",
      actorUid: uid,
      actorName: staff.name || email,
      targetUid: uid,
      targetName: staff.name || "",
      targetEmail: email,
      summary: `${staff.name || "A staff member"} changed their sign-in email from ${staff.email || "(none)"} to ${email}`,
      metadata: { from: staff.email || "", to: email, emailVerified },
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { ok: true, changed: true, email, emailVerified };
});

/**
 * recordPasswordChange — put a staff member's own password change in the
 * audit trail (2026-10-19). Settings calls it right after `updatePassword`.
 *
 * Argument-free, like syncStaffEmail: the evidence is the server's own.
 * Firebase Auth moves `tokensValidAfterTime` forward on a password change, so
 * an entry is written only when that moved within the last RECENT_MS, and at
 * most once per change — the log document's id is the uid plus that instant,
 * written with `create()`, so a repeated call is refused by Firestore itself.
 */
const RECENT_MS = 10 * 60 * 1000;

exports.recordPasswordChange = functions.https.onCall(async (data, context) => {
  const uid = context.auth && context.auth.uid;
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  const snap = await db.collection("staff_accounts").doc(uid).get();
  if (!snap.exists || snap.data().status !== "approved") return { ok: true, logged: false };
  const staff = snap.data();

  const user = await admin.auth().getUser(uid);
  const changedAt = Date.parse(user.tokensValidAfterTime || "");
  if (!Number.isFinite(changedAt) || Date.now() - changedAt > RECENT_MS) {
    return { ok: true, logged: false };
  }

  try {
    await db.collection("provisioning_logs").doc(`pw_${uid}_${changedAt}`).create({
      action: "staff.password.changed",
      category: "security",
      actorUid: uid,
      actorName: staff.name || user.email || "",
      targetUid: uid,
      targetName: staff.name || "",
      targetEmail: user.email || "",
      summary: `${staff.name || user.email || "A staff member"} changed their password`,
      metadata: { changedAt: new Date(changedAt).toISOString() },
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // ALREADY_EXISTS (6): this change is logged already.
    if (err && (err.code === 6 || err.code === "already-exists")) return { ok: true, logged: false };
    throw err;
  }
  return { ok: true, logged: true };
});
