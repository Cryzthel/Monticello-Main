/**
 * Officer presence — the Realtime Database → Firestore mirror.
 *
 * The Guardhouse console publishes `presence/{uid}` in the Realtime Database
 * (web-portal/packages/shared/src/lib/presence.js): one child under
 * `connections` per open tab, each removed by the server when that tab
 * disconnects, and `lastSeenAt` stamped on every disconnect.
 *
 * The Admin roster cannot read that node: RTDB rules have no way to look up the
 * Firestore staff record that says who is an admin. So every write to it is
 * mirrored here into `staff_presence/{uid}`, which firestore.rules gates on
 * isAdminStaff().
 *
 * ── THE MIRROR RE-READS, IT DOES NOT TRUST THE EVENT ───────────────────────
 * Trigger deliveries are not ordered. A tab that connects and disconnects in
 * quick succession can deliver "offline" before "online", and writing each
 * event's `after` would leave the roster showing the wrong one. Each run reads
 * the node as it is NOW, so whichever run finishes last writes the truth.
 *
 * ── ONLY SECURITY ACCOUNTS ─────────────────────────────────────────────────
 * The RTDB rules let any signed-in user write their own node — they cannot
 * check a role. A resident or admin who did so gets no mirror document: the
 * staff record is checked here, and anything that is not a security account
 * has its mirror removed.
 *
 * Needs a Realtime Database instance: create one (Firebase console → Realtime
 * Database) before deploying this function.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");

const db = admin.firestore();

const PRESENCE_COLLECTION = "staff_presence";
const SECURITY_ROLES = ["security_head", "security_officer"];

exports.onPresenceWrite = functions.database
    .ref("/presence/{uid}")
    .onWrite(async (change, context) => {
      const uid = context.params.uid;
      const mirror = db.collection(PRESENCE_COLLECTION).doc(uid);

      const staff = await db.collection("staff_accounts").doc(uid).get();
      if (!staff.exists || !SECURITY_ROLES.includes(staff.data().role)) {
        await mirror.delete();
        return;
      }

      const current = (await change.after.ref.once("value")).val() || {};
      const online = Object.keys(current.connections || {}).length > 0;
      const lastSeenAt = typeof current.lastSeenAt === "number" ?
        admin.firestore.Timestamp.fromMillis(current.lastSeenAt) :
        null;

      const previous = await mirror.get();
      const wasOnline = previous.exists && previous.data().online === true;

      await mirror.set({
        uid,
        online,
        lastSeenAt,
        // When the officer came online: set on the offline → online edge only,
        // so a second tab opening does not reset it.
        ...(online && !wasOnline ?
          { onlineSince: admin.firestore.FieldValue.serverTimestamp() } :
          {}),
        ...(online ? {} : { onlineSince: null }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

/**
 * Removes an account's presence everywhere. Called when a security account is
 * deleted, so the roster never shows a removed officer as connected.
 */
exports.clearPresence = async function clearPresence(uid) {
  await db.collection(PRESENCE_COLLECTION).doc(uid).delete();
  try {
    await admin.database().ref(`presence/${uid}`).remove();
  } catch (err) {
    // No Realtime Database instance configured: there is nothing to remove.
    functions.logger.warn("presence: RTDB node not cleared", { uid, error: String(err && err.message || err) });
  }
};
