// Creates a security account WITHOUT the Cloud Function.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// `createSecurityAccount` is deployed and correct, but the project's functions
// cannot currently serve a request: invocations come back as a Google Frontend
// 500 with no execution log, and nothing has run since 2026-09-28. That is what
// a project whose billing has been disabled looks like — the functions stay
// listed, and every call fails before reaching the code. Enabling Blaze is the
// real fix; this script is how accounts get created until then.
//
// It is a FAITHFUL MIRROR of the callable, not a shortcut. Same validation,
// same refusal on an existing email, same badge-uniqueness check, same
// staff_accounts shape, same provisioning_logs entry. An account created here
// is indistinguishable from one created by the portal — which matters, because
// the directory, the role checks and the audit history all read those writes.
//
// Running with the Admin SDK is what makes it possible at all: firestore.rules
// has `allow write: if false` on staff_accounts, so no client can seed one.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//   1. Firebase Console -> Project Settings -> Service Accounts ->
//      "Generate new private key" -> save as scripts/serviceAccountKey.json
//      (already gitignored — do not commit it)
//   2. cd scripts && npm install
//   3. node provision-guard.js \
//        --name "Roberto D. Santos" \
//        --badge MV-0142 \
//        --email roberto.santos@example.com
//
//   Options:
//     --password <value>   Use this initial password instead of generating one.
//     --supervisor         Provision a Security Supervisor (security_head)
//                          rather than a Security Officer. This is the ONLY
//                          flag that changes what the credential can do.
//     --actor <email|uid>  Who to record as the provisioner in the audit log.
//                          Defaults to the first super_admin found.
//     --dry-run            Validate and print the plan; write nothing.
//
// The generated password is printed ONCE, at the end. It is never stored — the
// account is flagged `mustChangePassword`, so the guard sets their own on first
// sign-in.

const crypto = require('crypto');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const auth = admin.auth();
const db = admin.firestore();

// ── Mirrored from functions/securityProvisioning.js. Kept as literals rather
//    than imported because that file is a Functions module (firebase-functions
//    at import time) and this script must run without that dependency.
const STAFF_COLLECTION = 'staff_accounts';
const AUDIT_COLLECTION = 'provisioning_logs';
const MIN_PASSWORD_LENGTH = 8;
const BADGE_RE = /^[A-Za-z0-9-]{2,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ACCESS_ROLES = {
  gate_guard: { rbacRole: 'security_officer', duty: 'gate_guard' },
  roving_patrol: { rbacRole: 'security_officer', duty: 'roving_patrol' },
  lead_dispatcher: { rbacRole: 'security_officer', duty: 'lead_dispatcher' },
  security_supervisor: { rbacRole: 'security_head', duty: 'supervisor' },
};

// The same constants the simplified ProvisionAccountModal sends. The callable
// still REQUIRES all three on a create, so they are supplied here too.
const OFFICER_ACCESS_ROLE = 'gate_guard';
const SUPERVISOR_ACCESS_ROLE = 'security_supervisor';
const DEFAULT_POST = 'perimeter_patrol';
const ROSTER_SHIFT = 'morning';

function parseArgs(argv) {
  const args = {
    name: null, badge: null, email: null, password: null,
    supervisor: false, actor: null, dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--supervisor') args.supervisor = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--name') args.name = argv[++i];
    else if (flag === '--badge') args.badge = argv[++i];
    else if (flag === '--email') args.email = argv[++i];
    else if (flag === '--password') args.password = argv[++i];
    else if (flag === '--actor') args.actor = argv[++i];
    else {
      console.error(`Unknown option: ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

/**
 * A readable, high-entropy initial password.
 *
 * `crypto.randomInt` rather than Math.random: this value is a real credential
 * for the window between provisioning and the guard's first sign-in.
 */
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 14; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

/** Resolve the provisioning actor, so the audit row names a real person. */
async function resolveActor(ref) {
  if (ref) {
    let uid = ref;
    if (ref.includes('@')) {
      const user = await auth.getUserByEmail(ref);
      uid = user.uid;
    }
    const doc = await db.collection(STAFF_COLLECTION).doc(uid).get();
    if (!doc.exists) throw new Error(`${ref} has no staff_accounts row.`);
    return { uid, name: doc.data().name || ref };
  }
  const snap = await db
    .collection(STAFF_COLLECTION)
    .where('role', '==', 'super_admin')
    .limit(1)
    .get();
  if (snap.empty) {
    throw new Error('No super_admin found. Pass --actor <email> explicitly.');
  }
  return { uid: snap.docs[0].id, name: snap.docs[0].data().name || 'Super admin' };
}

async function assertBadgeAvailable(badgeNumber) {
  const snap = await db
    .collection(STAFF_COLLECTION)
    .where('badgeNumber', '==', badgeNumber)
    .limit(2)
    .get();
  const clash = snap.docs[0];
  if (clash) {
    throw new Error(
      `Badge ${badgeNumber} is already assigned to ${clash.data().name || clash.id}.`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const name = String(args.name || '').trim();
  if (!name) throw new Error('--name is required.');

  const badgeNumber = String(args.badge || '').trim().toUpperCase();
  if (!badgeNumber) throw new Error('--badge is required.');
  if (!BADGE_RE.test(badgeNumber)) {
    throw new Error('Badge number must be 2–16 letters, numbers or dashes.');
  }

  const email = String(args.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('--email must be a valid address.');

  const password = args.password || generatePassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const accessRole = args.supervisor ? SUPERVISOR_ACCESS_ROLE : OFFICER_ACCESS_ROLE;
  const mapping = ACCESS_ROLES[accessRole];

  const assignment = {
    name,
    badgeNumber,
    accessRole,
    role: mapping.rbacRole,
    duties: [mapping.duty],
    assignedPost: DEFAULT_POST,
    shift: ROSTER_SHIFT,
  };

  await assertBadgeAvailable(badgeNumber);

  // Refuses rather than attaching a role to an existing uid — the same
  // reasoning as the callable: that address may belong to a resident with an
  // active session, and overwriting their password to onboard a guard locks a
  // homeowner out of the mobile app.
  let existing = null;
  try {
    existing = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }
  if (existing) {
    throw new Error(
      `${email} already has an account. Provision a different address, or grant ` +
      'this one a role from the Firebase console if it is genuinely the same person.',
    );
  }

  const actor = await resolveActor(args.actor);

  if (args.dryRun) {
    console.log('\nDRY RUN — nothing written.\n');
    console.log(JSON.stringify({ assignment, email, actor }, null, 2));
    return;
  }

  const userRecord = await auth.createUser({
    email,
    password,
    displayName: name,
    emailVerified: false,
    disabled: false,
  });

  await db.collection(STAFF_COLLECTION).doc(userRecord.uid).set({
    ...assignment,
    email,
    status: 'approved',
    mustChangePassword: true,
    onDuty: false,
    statusReason: '',
    provisionedBy: actor.uid,
    provisionedByName: actor.name,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection(AUDIT_COLLECTION).add({
    category: 'security',
    at: admin.firestore.FieldValue.serverTimestamp(),
    action: 'security.account.created',
    actorUid: actor.uid,
    actorName: actor.name,
    targetUid: userRecord.uid,
    targetName: name,
    targetEmail: email,
    summary: `Provisioned ${name} (badge ${badgeNumber}) as ${accessRole.replace(/_/g, ' ')}`,
    metadata: {
      accessRole,
      role: assignment.role,
      assignedPost: assignment.assignedPost,
      shift: assignment.shift,
      duties: assignment.duties,
      forcePasswordReset: true,
      provisionedVia: 'scripts/provision-guard.js',
    },
  });

  console.log('\n  Account created.\n');
  console.log(`  Name      ${name}`);
  console.log(`  Badge     ${badgeNumber}`);
  console.log(`  Role      ${args.supervisor ? 'Security supervisor' : 'Security officer'}`);
  console.log(`  Email     ${email}`);
  console.log(`  Password  ${password}`);
  console.log('\n  Hand these over securely. The password is shown once and is not stored —');
  console.log('  the account must set its own on first sign-in.\n');
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
