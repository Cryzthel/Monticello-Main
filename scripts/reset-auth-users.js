// Deletes the Firebase Auth logins that no longer belong to anybody.
//
// reset-operational-data.js clears Firestore. It deliberately does not touch
// Auth, because a profile and a login are different things: deleting
// `residents/{uid}` removes the record, and the account can still sign in to
// an app that has forgotten them. This finishes that job.
//
// It keeps every uid listed in `staff_accounts` and deletes the rest.
//
// ── WHY THIS IS A SEPARATE SCRIPT ───────────────────────────────────────────
// Firestore documents can be re-seeded. A deleted Auth user cannot: the uid is
// gone, and with it every document in the system still keyed to it. Someone
// running a "data reset" should have to decide about logins separately and on
// purpose, not discover afterwards that it took the accounts too.
//
// Usage:
//   1. scripts/serviceAccountKey.json must exist (see grant-access.js)
//   2. cd scripts && npm install
//   3. node reset-auth-users.js                        # dry run, lists them
//   4. node reset-auth-users.js --confirm <projectId>
//
// Flags:
//   --confirm <projectId>   actually delete; must match the credential's project
//   --keep <email|uid>      spare this account as well; repeatable
//
// Run it AFTER the Firestore purge, not before: `staff_accounts` is the
// keep-list, and this script refuses to run if that collection is empty.

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

function parseArgs(argv) {
  const args = { confirm: null, keep: [] };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--confirm') {
      args.confirm = argv[i + 1] ?? '';
      i += 1;
    } else if (argv[i] === '--keep') {
      const value = argv[i + 1];
      if (!value) {
        console.error('--keep needs an email or uid');
        process.exit(2);
      }
      args.keep.push(value.toLowerCase());
      i += 1;
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

/** Every Auth user, a page at a time. 1000 is the API's maximum. */
async function listAllUsers() {
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

  const staffSnap = await db.collection('staff_accounts').get();

  /**
   * THE GUARD THAT MATTERS MOST HERE.
   *
   * The keep-list is `staff_accounts`. If that collection is empty the list is
   * empty, and "delete everyone who is not staff" becomes "delete everyone" —
   * including the administrator running this, locking the project out of its
   * own console with no way back.
   *
   * An empty staff collection is not a legitimate state to run this in. It
   * means either the credentials point somewhere unexpected, or the Firestore
   * purge was run with the staff collection in scope. Both are reasons to
   * stop rather than proceed carefully.
   */
  if (staffSnap.empty) {
    console.error(
      `\nRefusing to run: staff_accounts is empty in ${projectId}.\n\n` +
        `That collection is the keep-list, so running now would delete every\n` +
        `login in the project, including yours. Seed an admin first\n` +
        `(node grant-access.js --admin you@example.com) and re-run.\n`,
    );
    process.exit(1);
  }

  const keepUids = new Set(staffSnap.docs.map((d) => d.id));
  const keepExtra = new Set(args.keep);

  const users = await listAllUsers();
  const doomed = users.filter(
    (u) =>
      !keepUids.has(u.uid) &&
      !keepExtra.has(u.uid.toLowerCase()) &&
      !keepExtra.has((u.email ?? '').toLowerCase()),
  );

  console.log(`\nProject : ${projectId}`);
  console.log(`Mode    : ${dryRun ? 'DRY RUN — nothing will be deleted' : 'DELETING'}`);
  console.log(`Accounts: ${users.length} total`);
  console.log(`Keeping : ${keepUids.size} staff${keepExtra.size ? ` + ${keepExtra.size} named` : ''}`);
  console.log(`Deleting: ${doomed.length}\n`);

  if (doomed.length === 0) {
    console.log('Nothing to do.\n');
    return;
  }

  // Printed in full, not sampled. This is the last chance to notice a login
  // that should not be on the list, and a truncated list is where the one that
  // mattered hides.
  doomed.forEach((u) => console.log(`  ${u.uid}  ${u.email || '(no email)'}`));

  if (dryRun) {
    console.log(`\nRe-run with --confirm ${projectId} to delete these.\n`);
    return;
  }

  // deleteUsers takes at most 1000 uids and reports per-account failures
  // rather than throwing, so a single protected account cannot abort the rest.
  let deleted = 0;
  const failures = [];
  for (let i = 0; i < doomed.length; i += 1000) {
    const chunk = doomed.slice(i, i + 1000);
    const result = await auth.deleteUsers(chunk.map((u) => u.uid));
    deleted += result.successCount;
    result.errors.forEach((e) =>
      failures.push(`${chunk[e.index]?.email || chunk[e.index]?.uid}: ${e.error.message}`),
    );
  }

  console.log(`\nDeleted ${deleted} account(s).`);
  if (failures.length) {
    console.log(`${failures.length} failed:`);
    failures.forEach((f) => console.log(`  ${f}`));
    process.exitCode = 1;
  }
  console.log('');
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
