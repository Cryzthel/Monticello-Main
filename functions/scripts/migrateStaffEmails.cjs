#!/usr/bin/env node
/**
 * Moves the two console accounts off their test addresses.
 *
 *   node functions/scripts/migrateStaffEmails.cjs            # dry run (default)
 *   node functions/scripts/migrateStaffEmails.cjs --apply    # writes
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key
 * for monticello-villas-f600e. Firebase Auth and Firestore admin writes work on
 * the Spark plan; nothing here needs Cloud Functions.
 *
 * ── WHAT CHANGES, AND WHAT DOES NOT ─────────────────────────────────────────
 * The sign-in email lives in Firebase Auth, keyed by uid. Changing it there is
 * `updateUser(uid, { email })`, which keeps the uid, the password hash, the
 * second factor and every custom claim exactly as they were. Roles are not
 * keyed by email anywhere — `staff_accounts/{uid}` carries the role — so no
 * permission moves with this either.
 *
 * What does carry the address as data, and is updated to match:
 *   - staff_accounts/{uid}.email   what the consoles and the audit trail show
 *   - users/{uid}.email            only if that document exists and held the
 *                                  old address (a staff member may also have
 *                                  signed in to the resident app)
 *
 * What is deliberately left alone:
 *   - provisioning_logs            append-only; old rows name the address the
 *                                  account had at the time, which is true
 *   - password_reset_otps/{old}    a live code for the OLD address is deleted,
 *                                  not moved: it was sent to a mailbox that is
 *                                  no longer the account's
 *
 * ── WHY IT REFUSES RATHER THAN MERGES ───────────────────────────────────────
 * If the new address already belongs to a DIFFERENT Auth user, the script stops
 * for that pair. Firebase would refuse the update anyway (email-already-exists);
 * stopping first says why in words, and the fix — deciding which of the two
 * accounts is the real one — is a person's call, not a script's.
 *
 * Re-running is safe: a pair whose old address no longer exists and whose new
 * address is a staff account is reported as already migrated.
 */

const MIGRATIONS = [
  { from: "monticellovillas@gmail.com", to: "adminmonticellov@gmail.com", console: "Admin" },
  { from: "guard.test@monticellovillas.ph", to: "riversantos940@gmail.com", console: "Guardhouse" },
];

const PROJECT_ID = "monticello-villas-f600e";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

/**
 * Decides what to do for one pair, from what the lookups found. Pure, so the
 * decision table is testable without a project.
 *
 * @param fromUser  Auth user at the old address, or null
 * @param toUser    Auth user at the new address, or null
 * @param staffAtTo whether `toUser` has a staff_accounts document
 * @returns {{ action: 'migrate'|'done'|'refuse'|'missing', reason: string }}
 */
function planMigration({ fromUser, toUser, staffAtTo }) {
  if (fromUser && toUser && fromUser.uid !== toUser.uid) {
    return {
      action: "refuse",
      reason: `the new address already belongs to a different account (uid ${toUser.uid})`,
    };
  }
  if (fromUser) return { action: "migrate", reason: `uid ${fromUser.uid}` };
  if (toUser && staffAtTo) return { action: "done", reason: `already on the new address (uid ${toUser.uid})` };
  if (toUser) {
    return {
      action: "missing",
      reason: `no account at the old address, and the one at the new address (uid ${toUser.uid}) is not staff`,
    };
  }
  return { action: "missing", reason: "no account at either address" };
}

async function lookup(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return null;
    throw err;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  // Resolved from functions/node_modules, where firebase-admin is installed.
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: PROJECT_ID });
  const auth = admin.auth();
  const db = admin.firestore();

  console.log(apply ? "APPLYING\n" : "DRY RUN — nothing will be written. Re-run with --apply.\n");

  let failures = 0;
  for (const pair of MIGRATIONS) {
    const from = normalizeEmail(pair.from);
    const to = normalizeEmail(pair.to);
    const fromUser = await lookup(auth, from);
    const toUser = await lookup(auth, to);
    const staffAtTo = toUser
      ? (await db.collection("staff_accounts").doc(toUser.uid).get()).exists
      : false;

    const plan = planMigration({ fromUser, toUser, staffAtTo });
    console.log(`${pair.console}: ${from} -> ${to}: ${plan.action} (${plan.reason})`);

    if (plan.action === "refuse" || plan.action === "missing") failures += 1;
    if (plan.action !== "migrate") continue;

    const uid = fromUser.uid;
    const staffRef = db.collection("staff_accounts").doc(uid);
    const staffSnap = await staffRef.get();
    if (!staffSnap.exists) {
      console.log(`  refused: uid ${uid} has no staff_accounts document, so it is not a console account`);
      failures += 1;
      continue;
    }
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const touchUserDoc = userSnap.exists && normalizeEmail(userSnap.data().email) === from;
    const otpRef = db.collection("password_reset_otps").doc(from);
    const otpSnap = await otpRef.get();

    console.log(`  auth: updateUser email, emailVerified=false`);
    console.log(`  firestore: staff_accounts/${uid}.email`);
    if (touchUserDoc) console.log(`  firestore: users/${uid}.email`);
    if (otpSnap.exists) console.log(`  firestore: delete password_reset_otps/${from}`);
    if (!apply) continue;

    // Auth first: it is the change that can be refused (and the one sign-in
    // depends on). If it fails, nothing in Firestore claims an address the
    // account does not have.
    // emailVerified is reset because the new mailbox has not proven itself;
    // nothing in either console gates on it, so sign-in is unaffected.
    await auth.updateUser(uid, { email: to, emailVerified: false });

    const batch = db.batch();
    const stamp = admin.firestore.FieldValue.serverTimestamp();
    batch.update(staffRef, { email: to, updatedAt: stamp });
    if (touchUserDoc) batch.update(userRef, { email: to });
    if (otpSnap.exists) batch.delete(otpRef);
    batch.create(db.collection("provisioning_logs").doc(), {
      category: "security",
      at: stamp,
      action: "security.account.email_changed",
      actorUid: null,
      actorName: "Migration script",
      targetUid: uid,
      targetName: staffSnap.data().name || to,
      targetEmail: to,
      summary: `Changed the ${pair.console} sign-in email from ${from} to ${to}`,
      metadata: { from, to },
    });
    await batch.commit();
    console.log("  done");
  }

  if (failures > 0) {
    console.log(`\n${failures} pair(s) not migrated — see above.`);
    process.exitCode = 1;
  }
}

module.exports = { MIGRATIONS, planMigration, normalizeEmail };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
