// Breaks the access bootstrap deadlock.
//
// The system has a deliberate chicken-and-egg at first setup, noted in
// functions/index.js: `provisionStaffAccount` can grant a staff_accounts row,
// but it refuses unless an approved admin is already calling it. And
// firestore.rules has `match /staff_accounts/{userId} { allow write: if false }`,
// so nothing client-side can create that first row either.
//
// Meanwhile a resident cannot reach the dashboard until an admin flips
// residents/{uid}.verificationStatus to 'verified' (see
// AccountVerificationGate). With no admin in existence, nobody can ever be
// approved and every account sits on "Account Pending Verification" forever.
//
// This script runs with the Admin SDK, which bypasses security rules, and does
// exactly two things:
//   * seeds the FIRST admin staff account, and/or
//   * marks a resident verified
//
// Usage:
//   1. Firebase Console -> Project Settings -> Service Accounts ->
//      "Generate new private key" -> save as scripts/serviceAccountKey.json
//      (already gitignored — do not commit it)
//   2. cd scripts && npm install
//   3. node grant-access.js --admin you@example.com
//      node grant-access.js --verify resident@example.com
//      node grant-access.js --admin you@example.com --verify you@example.com
//      node grant-access.js --list
//
// Both flags accept an email OR a raw uid.

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const auth = admin.auth();
const db = admin.firestore();

function parseArgs(argv) {
  const args = { admin: null, verify: null, list: false, role: 'super_admin' };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--list') args.list = true;
    else if (flag === '--admin') args.admin = argv[++i];
    else if (flag === '--verify') args.verify = argv[++i];
    else if (flag === '--role') args.role = argv[++i];
    else {
      console.error(`Unknown argument: ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

/** Accepts an email or a uid and returns the Auth user record. */
async function resolveUser(identifier) {
  if (!identifier.includes('@')) return auth.getUser(identifier);
  return auth.getUserByEmail(identifier);
}

async function seedAdmin(identifier, role) {
  const user = await resolveUser(identifier);

  // Mirrors the shape firestore.rules checks: isAdminStaff() requires
  // status == 'approved' and a role in the admin set.
  await db.collection('staff_accounts').doc(user.uid).set(
    {
      uid: user.uid,
      email: user.email ?? '',
      name: user.displayName || (user.email ?? '').split('@')[0] || 'Admin',
      role,
      status: 'approved',
      source: 'bootstrap_script',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.log(`  ✓ staff_accounts/${user.uid}  role=${role}  status=approved`);
  console.log(`    ${user.email} can now sign in to the Admin portal.`);
}

async function verifyResident(identifier) {
  const user = await resolveUser(identifier);
  const ref = db.collection('residents').doc(user.uid);
  const snap = await ref.get();

  if (!snap.exists) {
    // The mobile signup writes this doc; if it is missing, the signup-time
    // write failed. Creating it here with identity fields keeps the resident
    // from showing as blank in the Admin table.
    console.log(`  ! residents/${user.uid} did not exist — creating it`);
  }

  await ref.set(
    {
      uid: user.uid,
      email: user.email ?? '',
      ...(snap.exists ? {} : { name: user.displayName ?? '' }),
      verificationStatus: 'verified',
      rejectionReason: '',
      reviewedByName: 'Bootstrap script',
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.log(`  ✓ residents/${user.uid}  verificationStatus=verified`);
  console.log(`    ${user.email} will reach the dashboard — the app listens`);
  console.log(`    live, so no restart is needed.`);
}

async function list() {
  const [staff, residents] = await Promise.all([
    db.collection('staff_accounts').get(),
    db.collection('residents').get(),
  ]);

  console.log(`\nstaff_accounts (${staff.size}):`);
  if (staff.empty) {
    console.log('  (none — nobody can sign in to the web portals yet)');
  }
  staff.forEach((doc) => {
    const d = doc.data();
    console.log(`  ${d.email ?? doc.id}  role=${d.role}  status=${d.status}`);
  });

  console.log(`\nresidents (${residents.size}):`);
  residents.forEach((doc) => {
    const d = doc.data();
    console.log(`  ${d.email ?? doc.id}  status=${d.verificationStatus ?? '(unset)'}`);
  });
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.admin && !args.verify && !args.list) {
    console.log('Nothing to do. Pass --admin <email>, --verify <email>, or --list.');
    process.exit(1);
  }

  if (args.list) await list();
  if (args.admin) {
    console.log(`\nSeeding admin: ${args.admin}`);
    await seedAdmin(args.admin, args.role);
  }
  if (args.verify) {
    console.log(`\nVerifying resident: ${args.verify}`);
    await verifyResident(args.verify);
  }
  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    if (err.code === 'auth/user-not-found') {
      console.error('That email has no Firebase Auth account. Sign up in the');
      console.error('mobile app first, then re-run this.');
    }
    process.exit(1);
  });
