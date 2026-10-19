// Pre-production purge: removes every test account and every piece of test
// content, and leaves exactly one thing standing — the administrator account(s)
// you name — plus the system's configuration.
//
// Unlike reset-operational-data.js (which keeps all staff, residents and
// properties) and reset-auth-users.js (which keeps all staff logins), this is
// the "go live with a clean slate" tool: guards, residents, their logins,
// incidents, SOS alerts, shifts, announcements, audit trails, uploaded files
// and presence are all removed. Only the whitelisted admin survives.
//
// ── READ THIS BEFORE RUNNING IT ─────────────────────────────────────────────
// There is no undo. Firestore keeps nothing once deleted, and on this project
// point-in-time recovery and scheduled backups are OFF (see SECURITY_AUDIT.md).
// Take an export first:
//
//     gcloud firestore export gs://<bucket>/backups/pre-launch-$(date +%F)
//
// DRY RUN BY DEFAULT. Without --confirm it reads, counts and lists everything
// it would delete, writes a manifest file, and changes nothing. Deleting
// requires naming the project id, which must match the credentials:
//
//     node purge-test-data.js
//     node purge-test-data.js --confirm monticello-villas-f600e
//
// ── THE WHITELIST ───────────────────────────────────────────────────────────
// `--keep <email>` (repeatable) names the accounts to preserve. Each one is
// resolved to a uid through Firebase Auth BEFORE anything else happens, and the
// script refuses to run if any of them does not exist, or if none of them is an
// approved admin in staff_accounts. A mistyped address therefore stops the run
// instead of quietly deleting the real admin. With no --keep, it uses
// DEFAULT_KEEP below.
//
// For each kept uid it preserves: the Auth user (password, claims, MFA
// untouched), staff_accounts/{uid}, users/{uid}, staff_presence/{uid},
// presence/{uid} in the Realtime Database, and profile_photos/{uid}.* in
// Storage. It never writes to any of them.
//
// ── WHAT IS NEVER TOUCHED ───────────────────────────────────────────────────
// Security rules, indexes, Cloud Functions, the Storage bucket itself, and the
// configuration documents in PRESERVE. A collection that is emptied still
// exists the moment the app writes to it again; Firestore has no schema to
// lose, and listeners simply see an empty result.
//
// Usage:
//   1. Credentials: scripts/serviceAccountKey.json (see grant-access.js), or
//      GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.
//   2. cd scripts && npm install
//   3. node purge-test-data.js [--keep admin@example.com]           # dry run
//   4. node purge-test-data.js --keep admin@example.com --confirm <projectId>
//
// Flags:
//   --confirm <projectId>   actually delete; must match the credential's project
//   --keep <email|uid>      preserve this account (repeatable)
//   --bucket <name>         Storage bucket (default: <projectId>.firebasestorage.app,
//                           falling back to <projectId>.appspot.com)
//   --database-url <url>    Realtime Database URL (default: the project's default)
//   --project <id>          project id when the credentials do not carry one
//                           (emulators, application-default user credentials)
//   --skip-storage          leave Cloud Storage alone
//   --skip-rtdb             leave the Realtime Database alone

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

/** Used when no --keep is given. Resolved and verified before anything runs. */
const DEFAULT_KEEP = ['adminmonticellov@gmail.com'];

/** Firestore's hard cap on writes per batch. */
const BATCH_SIZE = 500;
/** Pause between batch commits, so a large purge stays well under write quotas. */
const BATCH_PAUSE_MS = 250;

/**
 * Every top-level collection the system uses, and what happens to it. A
 * collection found in the database that is NOT listed here stops the run: a
 * new collection needs a human decision, not a default.
 *
 *   purge       every document, and every subcollection beneath it
 *   keep-admin  every document except those whose id is a kept uid
 *   preserve    untouched (configuration, not data)
 */
const POLICY = {
  // Operations and their audit trails — all test content before launch.
  incidents: 'purge', // with the status_log subcollection
  panic_alerts: 'purge',
  guard_shifts: 'purge',
  announcements: 'purge',
  audit_dismissals: 'purge',
  provisioning_logs: 'purge',
  settings_changes: 'purge',
  password_reset_otps: 'purge',
  password_reset_ip_throttle: 'purge',

  // Keyed by uid: everyone but the kept admin.
  staff_accounts: 'keep-admin',
  users: 'keep-admin',
  staff_presence: 'keep-admin',
  residents: 'keep-admin',
  properties: 'keep-admin',
  guard_telemetry: 'keep-admin',
  email_change_otps: 'keep-admin',
  // Legacy sign-up records from early resident-app builds (last written
  // 2026-07). No current code or rule uses it; found by the live dry run.
  resident_accounts: 'keep-admin',

  // Configuration and scheduler bookkeeping — not test data.
  system_settings: 'preserve',
  operations_state: 'preserve',
};

/** Storage folders emptied. Kept uids' profile photos survive. */
const STORAGE_PREFIXES = ['incidents/', 'verification_ids/', 'announcements/', 'profile_photos/'];

// ── setup ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { confirm: null, keep: [], bucket: null, databaseUrl: null, project: null, skipStorage: false, skipRtdb: false };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) fail(`${flag} needs a value`);
    return v;
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--confirm') { args.confirm = value(i, a); i += 1; }
    else if (a === '--keep') { args.keep.push(value(i, a)); i += 1; }
    else if (a === '--bucket') { args.bucket = value(i, a); i += 1; }
    else if (a === '--database-url') { args.databaseUrl = value(i, a); i += 1; }
    else if (a === '--project') { args.project = value(i, a); i += 1; }
    else if (a === '--skip-storage') args.skipStorage = true;
    else if (a === '--skip-rtdb') args.skipRtdb = true;
    else fail(`Unknown argument: ${a}`);
  }
  if (!args.keep.length) args.keep = [...DEFAULT_KEEP];
  return args;
}

function fail(message) {
  console.error(`\nRefusing to run.\n${message}\n`);
  process.exit(1);
}

function initApp(args) {
  const keyPath = path.join(__dirname, 'serviceAccountKey.json');
  let credential;
  let projectId = args.project;
  if (fs.existsSync(keyPath)) {
    const key = require(keyPath);
    credential = admin.credential.cert(key);
    projectId = projectId || key.project_id;
  } else {
    credential = admin.credential.applicationDefault();
    projectId = projectId || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  }
  if (!projectId) fail('Could not tell which project the credentials belong to. Pass --project <id>.');
  admin.initializeApp({
    credential,
    projectId,
    databaseURL: args.databaseUrl || `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`,
  });
  return projectId;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retries the transient failures a long purge meets (quota, contention, network). */
async function withRetry(label, fn) {
  const transient = new Set([4, 8, 10, 13, 14, 'resource-exhausted', 'aborted', 'unavailable', 'deadline-exceeded', 'internal']);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 5 || !transient.has(err.code)) throw err;
      const wait = Math.min(30_000, 500 * 2 ** attempt);
      console.warn(`\n  ${label}: ${err.code}, retrying in ${wait} ms`);
      await sleep(wait);
    }
  }
}

// ── the whitelist ────────────────────────────────────────────────────────────

/**
 * Resolves every --keep to a real Auth user, and proves at least one of them
 * is an approved administrator. Any failure stops the run before a single
 * read of the data to be deleted.
 */
async function resolveKeepList(keep) {
  const auth = admin.auth();
  const db = admin.firestore();
  const kept = [];
  for (const entry of keep) {
    let user;
    try {
      user = entry.includes('@') ? await auth.getUserByEmail(entry.toLowerCase()) : await auth.getUser(entry);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        fail(
          `The account to keep, "${entry}", does not exist in Firebase Auth.\n` +
            `Nothing was read or deleted. Check the address (an admin email may have been\n` +
            `changed) and pass the right one with --keep.`,
        );
      }
      throw err;
    }
    const staff = await db.collection('staff_accounts').doc(user.uid).get();
    kept.push({
      uid: user.uid,
      email: user.email || '',
      role: staff.exists ? staff.data().role : null,
      status: staff.exists ? staff.data().status : null,
    });
  }
  const admins = kept.filter((k) => k.status === 'approved' && ['super_admin', 'hoa_admin'].includes(k.role));
  if (!admins.length) {
    fail(
      `None of the kept accounts is an approved administrator in staff_accounts:\n` +
        kept.map((k) => `  ${k.email || k.uid}: role=${k.role ?? '(no staff record)'} status=${k.status ?? '-'}`).join('\n') +
        `\nPurging now would leave nobody able to sign in to the Admin portal.`,
    );
  }
  return kept;
}

// ── Firestore ────────────────────────────────────────────────────────────────

/** Deletes refs in commits of BATCH_SIZE, pausing between them. */
async function deleteRefs(refs, onCommit) {
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const chunk = refs.slice(i, i + BATCH_SIZE);
    await withRetry('batch commit', async () => {
      const batch = admin.firestore().batch();
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
    });
    onCommit(chunk.length);
    await sleep(BATCH_PAUSE_MS);
  }
}

/**
 * Every document reference under `collectionRef` that should go, depth-first
 * (children before their parent), skipping top-level ids in `keepIds`.
 *
 * `listDocuments` rather than a query: it also returns "missing" parent
 * documents — ids that exist only because a subcollection lives under them —
 * which a query would never see, leaving their subcollections orphaned.
 */
async function collectDoomed(collectionRef, keepIds, out, subNames) {
  const docs = await withRetry(`list ${collectionRef.path}`, () => collectionRef.listDocuments());
  for (const ref of docs) {
    if (keepIds && keepIds.has(ref.id)) continue;
    const subs = await withRetry(`subcollections of ${ref.path}`, () => ref.listCollections());
    for (const sub of subs) {
      subNames.add(`${collectionRef.id}/*/${sub.id}`);
      await collectDoomed(sub, null, out, subNames);
    }
    out.push(ref);
  }
}

async function planFirestore(keptUids) {
  const db = admin.firestore();
  const live = (await db.listCollections()).map((c) => c.id).sort();
  const unknown = live.filter((id) => !(id in POLICY));
  if (unknown.length) {
    fail(
      `The database has collection(s) this script has no policy for:\n  ${unknown.join(', ')}\n` +
        `Add each one to POLICY in purge-test-data.js (purge, keep-admin or preserve) and re-run.`,
    );
  }
  const plan = [];
  for (const id of live) {
    const policy = POLICY[id];
    if (policy === 'preserve') {
      const count = (await db.collection(id).count().get()).data().count;
      plan.push({ collection: id, policy, refs: [], kept: count, subNames: new Set() });
      continue;
    }
    const refs = [];
    const subNames = new Set();
    const keepIds = policy === 'keep-admin' ? keptUids : null;
    await collectDoomed(db.collection(id), keepIds, refs, subNames);
    const kept = keepIds ? (await db.collection(id).listDocuments()).filter((r) => keepIds.has(r.id)).length : 0;
    plan.push({ collection: id, policy, refs, kept, subNames });
  }
  return plan;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function planAuth(keptUids) {
  const users = [];
  let pageToken;
  do {
    const page = await withRetry('listUsers', () => admin.auth().listUsers(1000, pageToken));
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return { total: users.length, doomed: users.filter((u) => !keptUids.has(u.uid)) };
}

// ── Storage ──────────────────────────────────────────────────────────────────

async function resolveBucket(args, projectId) {
  const candidates = args.bucket ? [args.bucket] : [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];
  const errors = [];
  for (const name of candidates) {
    const bucket = admin.storage().bucket(name);
    try {
      // Listing one object rather than `exists()`: it proves the credentials
      // can list the bucket (which the purge needs anyway), and the Storage
      // emulator does not implement the bucket-metadata call `exists()` makes.
      await bucket.getFiles({ maxResults: 1, autoPaginate: false });
      return bucket;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  fail(`No Storage bucket found:\n  ${errors.join('\n  ')}\nPass --bucket <name>, or --skip-storage.`);
  return null;
}

async function planStorage(bucket, keptUids) {
  const doomed = [];
  for (const prefix of STORAGE_PREFIXES) {
    const [files] = await withRetry(`list ${prefix}`, () => bucket.getFiles({ prefix }));
    for (const file of files) {
      const base = file.name.slice(prefix.length);
      // Kept: an admin's own profile photo (`profile_photos/<uid>.jpg`) and
      // anything in a folder named for a kept uid.
      const owner = prefix === 'profile_photos/' ? base.split('.')[0] : base.split('/')[0];
      if (keptUids.has(owner)) continue;
      doomed.push(file);
    }
  }
  return doomed;
}

// ── Realtime Database ────────────────────────────────────────────────────────

async function planRtdb(keptUids) {
  const snap = await withRetry('read presence', () => admin.database().ref('presence').once('value'));
  const ids = Object.keys(snap.val() || {});
  return ids.filter((uid) => !keptUids.has(uid));
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const projectId = initApp(args);
  const dryRun = !args.confirm;

  if (!dryRun && args.confirm !== projectId) {
    fail(`  --confirm said : ${args.confirm}\n  credentials are: ${projectId}\nPass the project id the credentials belong to.`);
  }

  console.log(`\nProject : ${projectId}`);
  console.log(`Mode    : ${dryRun ? 'DRY RUN — nothing will be written' : 'DELETING'}`);

  const kept = await resolveKeepList(args.keep);
  const keptUids = new Set(kept.map((k) => k.uid));
  console.log('Keeping :');
  kept.forEach((k) => console.log(`  ${k.uid}  ${k.email}  (${k.role ?? 'no staff record'}, ${k.status ?? '-'})`));

  console.log('\nReading what would be deleted…');
  const firestorePlan = await planFirestore(keptUids);
  const authPlan = await planAuth(keptUids);
  const bucket = args.skipStorage ? null : await resolveBucket(args, projectId);
  const storagePlan = bucket ? await planStorage(bucket, keptUids) : [];
  const rtdbPlan = args.skipRtdb ? [] : await planRtdb(keptUids);

  console.log('\nFirestore');
  for (const p of firestorePlan) {
    const subs = p.subNames.size ? `  (incl. ${[...p.subNames].join(', ')})` : '';
    const keep = p.kept ? `, keep ${p.kept}` : '';
    console.log(`  ${p.collection.padEnd(28)} ${p.policy.padEnd(11)} delete ${String(p.refs.length).padStart(5)}${keep}${subs}`);
  }
  console.log(`\nAuth     : delete ${authPlan.doomed.length} of ${authPlan.total} account(s)`);
  authPlan.doomed.forEach((u) => console.log(`  ${u.uid}  ${u.email || '(no email)'}`));
  console.log(`\nStorage  : ${bucket ? `delete ${storagePlan.length} file(s) in ${bucket.name}` : 'skipped'}`);
  console.log(`RTDB     : ${args.skipRtdb ? 'skipped' : `delete presence for ${rtdbPlan.length} uid(s)`}`);

  const manifest = {
    project: projectId,
    mode: dryRun ? 'dry-run' : 'execute',
    at: new Date().toISOString(),
    kept,
    firestore: firestorePlan.map((p) => ({ collection: p.collection, policy: p.policy, delete: p.refs.length, kept: p.kept, subcollections: [...p.subNames] })),
    auth: authPlan.doomed.map((u) => ({ uid: u.uid, email: u.email || null })),
    storage: storagePlan.map((f) => f.name),
    rtdbPresence: rtdbPlan,
  };
  const manifestPath = path.join(__dirname, `purge-manifest-${projectId}-${manifest.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest: ${manifestPath}`);

  if (dryRun) {
    console.log(`\nNothing was deleted. To run it:\n  node purge-test-data.js ${args.keep.map((k) => `--keep ${k}`).join(' ')} --confirm ${projectId}\n`);
    return;
  }

  // ── EXECUTE ── Firestore first (data), then files and presence, then the
  // logins last, so a failure part-way leaves accounts able to sign in to an
  // app whose data is gone rather than data pointing at accounts that are.
  // staff_accounts FIRST. The rules decide "is this staff" from that
  // collection, so removing it cuts off every still-open guard console before
  // anything else is emptied. Alphabetical order emptied guard_telemetry first
  // on the live run (2026-10-20), and an open Guardhouse tab re-published its
  // position into it before its staff record was gone.
  const ordered = [...firestorePlan].sort((a, b) => (b.collection === 'staff_accounts') - (a.collection === 'staff_accounts'));
  let deleted = 0;
  for (const p of ordered) {
    if (!p.refs.length) continue;
    process.stdout.write(`\nFirestore ${p.collection} `);
    await deleteRefs(p.refs, (n) => {
      deleted += n;
      process.stdout.write('.');
    });
  }
  console.log(`\n${deleted} Firestore document(s) deleted.`);

  for (let i = 0; i < storagePlan.length; i += 100) {
    await Promise.all(storagePlan.slice(i, i + 100).map((f) => withRetry(`delete ${f.name}`, () => f.delete({ ignoreNotFound: true }))));
  }
  if (bucket) console.log(`${storagePlan.length} Storage file(s) deleted.`);

  if (rtdbPlan.length) {
    const updates = Object.fromEntries(rtdbPlan.map((uid) => [uid, null]));
    await withRetry('rtdb presence', () => admin.database().ref('presence').update(updates));
    console.log(`${rtdbPlan.length} presence node(s) deleted.`);
  }

  let authDeleted = 0;
  const failures = [];
  for (let i = 0; i < authPlan.doomed.length; i += 1000) {
    const chunk = authPlan.doomed.slice(i, i + 1000);
    const result = await withRetry('deleteUsers', () => admin.auth().deleteUsers(chunk.map((u) => u.uid)));
    authDeleted += result.successCount;
    result.errors.forEach((e) => failures.push(`${chunk[e.index]?.email || chunk[e.index]?.uid}: ${e.error.message}`));
    await sleep(1000); // deleteUsers is rate-limited to ~1 call/s
  }
  console.log(`${authDeleted} Auth account(s) deleted.`);
  if (failures.length) {
    console.log(`${failures.length} Auth deletion(s) failed:`);
    failures.forEach((f) => console.log(`  ${f}`));
    process.exitCode = 1;
  }

  // Prove the kept accounts are still exactly there.
  for (const k of kept) {
    await admin.auth().getUser(k.uid);
    const staff = await admin.firestore().collection('staff_accounts').doc(k.uid).get();
    if (!staff.exists) throw new Error(`Kept account ${k.email} lost its staff record — investigate before launch.`);
  }
  console.log(`\nDone. Kept account(s) verified: ${kept.map((k) => k.email || k.uid).join(', ')}\n`);
}

// Close the app on the way out. Reading the Realtime Database opens a live
// connection that keeps Node running forever otherwise — the script finished
// its work and then sat there looking hung.
main()
  .catch((err) => {
    console.error('\nFailed:', err);
    process.exitCode = 1;
  })
  .finally(() => Promise.all(admin.apps.map((app) => app.delete())).then(() => process.exit()));
