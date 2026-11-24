// Clears the operational data and leaves the system's bones standing.
//
// This empties the collections that accumulate while the product is used —
// incidents, SOS alerts, shifts, announcements, audit trails — and does not
// touch the ones that make the product work: staff accounts, residents,
// properties, settings.
//
// ── READ THIS BEFORE RUNNING IT ─────────────────────────────────────────────
// There is no undo. Firestore has no "restore deleted documents"; the only way
// back is a backup you took first. On the Blaze plan:
//
//     gcloud firestore export gs://<bucket>/backups/$(date +%F)
//
// It is DRY RUN BY DEFAULT. Without --confirm it reads, counts and prints what
// it would delete, and writes nothing. Deleting requires naming the project id
// out loud:
//
//     node reset-operational-data.js
//     node reset-operational-data.js --confirm monticello-villas-f600e
//
// The id you type must match the one the service account points at. That is
// the whole safety mechanism: the usual way to destroy the wrong data is to
// run a cleanup script against prod while believing it is staging, and a
// --force flag does nothing to stop that because it does not know which
// project it is. Naming it does.
//
// Usage:
//   1. scripts/serviceAccountKey.json must exist (see grant-access.js)
//   2. cd scripts && npm install
//   3. node reset-operational-data.js                      # dry run
//   4. node reset-operational-data.js --confirm <projectId>
//
// Flags:
//   --confirm <projectId>   actually delete; must match the credential's project
//   --include-residents     ALSO wipe resident accounts: the `residents` and
//                           `properties` collections, plus every `users`
//                           profile that is not a staff account
//
// ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────────
// FIREBASE AUTH. Deleting a Firestore profile does not delete the account that
// signs in, and this script deliberately leaves Auth alone — removing a login
// is a different, more dangerous operation that belongs in its own script with
// its own confirmation. If residents are purged, their Auth users survive and
// will sign in to an app that no longer has a profile for them.
//
// CLOUD STORAGE. Incident photos stay in the bucket. They are orphaned once the
// incidents referencing them are gone, so clearing Storage is a separate step
// in the console (or `gsutil -m rm`). Given this project has already hit the
// Storage quota, emptying that bucket is probably the point of the exercise —
// but a Firestore script quietly deleting files is not something to discover
// after the fact.

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

/**
 * Emptied. Everything here is a record of something that happened, and the
 * product regenerates it from use.
 *
 * `status_log` is NOT listed because it is a SUBCOLLECTION of incidents, and
 * this is the trap in every Firestore cleanup script: deleting a document does
 * NOT delete its subcollections. Delete `incidents/{id}` the obvious way and
 * `incidents/{id}/status_log/*` survives — invisible in the console, still
 * stored, still billed, and still returned by a collection-group query. The
 * recursive delete below is what makes the purge actually complete.
 */
const PURGE = [
  'incidents',          // tickets and dispatches, with their status_log subcollection
  'panic_alerts',       // SOS
  'guard_shifts',       // duty sessions, clock in/out
  'guard_telemetry',    // last known guard positions
  'announcements',      // broadcasts
  'audit_dismissals',   // which audit entries an admin has cleared
  'provisioning_logs',  // the account-provisioning audit trail
];

/**
 * Kept. Deleting any of these does not reset the system, it breaks it.
 *
 * `residents` is in here BY DEFAULT and that is a judgement call worth
 * knowing about: a resident row is a person's account, not test data, and its
 * uid is what every incident, property and verification state is keyed on.
 * Wiping it strands their Auth login and their property record. Pass
 * --include-residents if the intent really is to clear sign-ups too.
 *
 * `operations_state` is the scheduled sweep's bookkeeping. Harmless to lose,
 * kept because losing it makes the next sweep re-process a window it already
 * handled, which is noise nobody asked for.
 */
const PRESERVE = [
  'staff_accounts',   // admin + guard credentials and roles
  'system_settings',  // operations configuration
  'operations_state', // sweep bookkeeping
];

/**
 * Resident-scoped, and only cleared with --include-residents.
 *
 * ── `properties` IS NOT THE SUBDIVISION SCHEMA ──────────────────────────────
 * It looks like it, and the brief that asked for this script assumed it was.
 * It is not: the rules say `match /properties/{userId}` and the portal reads
 * `doc(db, 'properties', uid)`, so a document here is ONE RESIDENT'S claim on
 * a lot, keyed by their uid. Preserving it while deleting residents leaves a
 * claim pointing at an account that no longer exists.
 *
 * The real Phase / Block / Lot schedule is not in Firestore at all. It is Dart
 * source — lib/features/property/data/subdivision_directory.dart — which
 * scripts/export-subdivision-lots.js parses precisely so the two can never
 * drift. No database purge can reach it, and nothing here needs to protect it.
 *
 * `users` is handled separately below: staff have profile documents in there
 * too, so it cannot be emptied wholesale.
 */
const RESIDENT_SCOPED = ['residents', 'properties'];

function parseArgs(argv) {
  const args = { confirm: null, includeResidents: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--confirm') {
      args.confirm = argv[i + 1] ?? '';
      i += 1;
    } else if (argv[i] === '--include-residents') {
      args.includeResidents = true;
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

/**
 * Delete a collection and everything beneath it, in batches.
 *
 * 500 is Firestore's hard cap on writes per batch. Re-querying from the top
 * each round rather than paginating is deliberate: the documents from the last
 * round are gone, so the "first 500" is always fresh work and the loop cannot
 * skip a document that shifted position.
 */
async function deleteCollection(ref, counters, dryRun) {
  const BATCH = 500;

  if (dryRun) {
    // Count the collection exactly, then sample one page to learn which
    // subcollections hang off it. Only the names are reported, not a count:
    // tallying every child of every document would mean reading the entire
    // tree to print a number nobody acts on, and the names are what actually
    // answer "will status_log go too?".
    const all = await ref.count().get();
    counters.documents += all.data().count;

    const sample = await ref.limit(BATCH).get();
    for (const docSnap of sample.docs) {
      const subs = await docSnap.ref.listCollections();
      subs.forEach((sub) => counters.subcollections.add(`${ref.id}/*/${sub.id}`));
    }
    return;
  }

  for (;;) {
    const snap = await ref.limit(BATCH).get();
    if (snap.empty) return;

    for (const docSnap of snap.docs) {
      // Depth-first: a parent removed before its children leaves the children
      // unreachable by path, which is exactly the orphan this guards against.
      const subs = await docSnap.ref.listCollections();
      for (const sub of subs) {
        counters.subcollections.add(`${ref.id}/*/${sub.id}`);
        await deleteCollection(sub, counters, dryRun);
      }
    }

    counters.documents += snap.size;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    process.stdout.write('.');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = serviceAccount.project_id;
  const dryRun = !args.confirm;

  if (!dryRun && args.confirm !== projectId) {
    console.error(
      `\nRefusing to run.\n` +
        `  --confirm said : ${args.confirm || '(empty)'}\n` +
        `  credentials are: ${projectId}\n\n` +
        `Pass the project id the service account belongs to.\n`,
    );
    process.exit(1);
  }

  const targets = [...PURGE];
  if (args.includeResidents) targets.push(...RESIDENT_SCOPED);

  console.log(`\nProject : ${projectId}`);
  console.log(`Mode    : ${dryRun ? 'DRY RUN — nothing will be written' : 'DELETING'}`);
  console.log(`Purging : ${targets.join(', ')}`);
  console.log(
    `Keeping : ${PRESERVE.filter((c) => !targets.includes(c)).join(', ')}\n`,
  );

  const totals = {};
  for (const name of targets) {
    const counters = { documents: 0, subcollections: new Set() };
    process.stdout.write(`${name.padEnd(20)}`);
    await deleteCollection(db.collection(name), counters, dryRun);
    totals[name] = counters;
    const subs = counters.subcollections.size
      ? `  (+ ${[...counters.subcollections].join(', ')})`
      : '';
    console.log(` ${counters.documents} document(s)${subs}`);
  }

  /**
   * `users` by subtraction: everyone who is not staff.
   *
   * Staff keep profile documents in the same collection as residents, so this
   * is the one place the script cannot delete a whole collection. The staff
   * uids are read first and used as a keep-list — derived from
   * `staff_accounts`, which is the thing that actually decides who is staff,
   * rather than from a flag on the profile that could be stale.
   */
  if (args.includeResidents) {
    const staff = await db.collection('staff_accounts').get();
    const keep = new Set(staff.docs.map((d) => d.id));
    const counters = { documents: 0, subcollections: new Set() };

    process.stdout.write(`${'users'.padEnd(20)}`);
    for (;;) {
      const snap = await db.collection('users').limit(500).get();
      if (snap.empty) break;
      const doomed = snap.docs.filter((d) => !keep.has(d.id));
      counters.documents += doomed.length;

      if (dryRun || doomed.length === 0) {
        // Dry run reads the same page forever, and a page that is entirely
        // staff would too. Count what is there and stop either way.
        if (dryRun) {
          const all = await db.collection('users').count().get();
          counters.documents = Math.max(0, all.data().count - keep.size);
        }
        break;
      }

      const batch = db.batch();
      doomed.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      process.stdout.write('.');
    }
    totals.users = counters;
    console.log(` ${counters.documents} document(s)  (kept ${keep.size} staff profile(s))`);
  }

  const grand = Object.values(totals).reduce((n, c) => n + c.documents, 0);
  const anySubs = Object.values(totals).some((c) => c.subcollections.size);
  console.log(
    dryRun
      ? `\n${grand} top-level document(s) would be deleted` +
          (anySubs
            ? `, plus everything inside the subcollections named above.\n` +
              `(Those are listed, not counted — see deleteCollection.)\n`
            : `.\n`) +
          `Re-run with --confirm ${projectId} to do it.\n`
      : `\nDone. ${grand} document(s) deleted, subcollections included.\n` +
          `Firebase Auth users and Cloud Storage files are untouched — see the header.\n`,
  );
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
