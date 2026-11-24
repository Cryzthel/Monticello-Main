// One-off recovery script for the accidentally-deleted `users` collection.
//
// Firestore's 1-hour version-history window (the only recovery path that
// would have returned the exact original documents) has already passed, so
// this rebuilds each users/{uid} doc from the sources that are still
// intact:
//   - uid / email / displayName / photoURL come from Firebase Auth
//   - phase / block / lot are backfilled from the surviving `properties`
//     collection (see lib/services/property_storage.dart)
//   - phone, bio, and the notification/biometric toggles have no surviving
//     source and are reset to the same defaults
//     lib/services/user_profile_service.dart's UserProfile constructor
//     uses, so the app behaves exactly as it would for a brand-new profile
//     doc. Residents will need to re-enter/re-toggle those manually.
//
// Usage:
//   1. Firebase Console -> Project Settings -> Service Accounts ->
//      "Generate new private key" -> save as scripts/serviceAccountKey.json
//      (already gitignored, do not commit it)
//   2. cd scripts && npm install && node restore-users.js

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const auth = admin.auth();
const db = admin.firestore();

async function listAllAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function main() {
  const authUsers = await listAllAuthUsers();
  console.log(`Found ${authUsers.length} Firebase Auth users.`);

  let batch = db.batch();
  let opsInBatch = 0;
  let restored = 0;
  let skipped = 0;

  for (const user of authUsers) {
    const uid = user.uid;

    const existing = await db.collection('users').doc(uid).get();
    if (existing.exists) {
      skipped++;
      continue;
    }

    const fallbackName =
      (user.displayName && user.displayName.trim()) ||
      (user.email ? user.email.split('@')[0] : 'Resident');

    const propSnap = await db.collection('properties').doc(uid).get();
    const prop = propSnap.exists ? propSnap.data() : null;

    const doc = {
      fullName: fallbackName,
      name: fallbackName,
      email: user.email || '',
      phone: '',
      bio: '',
      photoUrl: user.photoURL || '',
      notificationsEnabled: true,
      emailAlertsEnabled: true,
      soundAlertsEnabled: true,
      biometricLogin: false,
      ...(prop
        ? { phase: prop.phase || '', block: prop.block || '', lot: prop.lot || '' }
        : {}),
    };

    batch.set(db.collection('users').doc(uid), doc);
    opsInBatch++;
    restored++;

    if (opsInBatch === 450) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) await batch.commit();

  console.log(`Restored ${restored} users/{uid} documents (${skipped} already existed and were left untouched).`);
  console.log('phone, bio, and notification/biometric toggles were reset to defaults — those values could not be recovered.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
