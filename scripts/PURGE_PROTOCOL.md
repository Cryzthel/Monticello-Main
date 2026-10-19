# Pre-production purge protocol

Removes every test account and all test content before launch, keeping only the
administrator account(s) you name and the system configuration. Script:
[`purge-test-data.js`](purge-test-data.js).

## What it does

| Area | Action |
|------|--------|
| Firebase Auth | Deletes every account except the kept admin. The admin's password, claims and MFA are never written. |
| Firestore — purged | `incidents` (+ `status_log`), `panic_alerts`, `guard_shifts`, `announcements`, `audit_dismissals`, `provisioning_logs`, `settings_changes`, `password_reset_otps`, `password_reset_ip_throttle` |
| Firestore — all but the admin's doc | `staff_accounts`, `users`, `staff_presence`, `residents`, `properties`, `guard_telemetry`, `email_change_otps` |
| Firestore — untouched | `system_settings`, `operations_state` |
| Cloud Storage | Empties `incidents/`, `verification_ids/`, `announcements/`, `profile_photos/` — except files owned by the kept admin |
| Realtime Database | Removes `presence/{uid}` for everyone but the admin |
| Never touched | Security rules, indexes, Cloud Functions, the bucket itself |

Emptied collections need no recreation: Firestore has no schema to lose, the
indexes and rules are unaffected, and live listeners simply see an empty result
until the app writes again.

## Safety built in

- **Dry run by default.** Nothing is written without `--confirm <projectId>`, and the id must match the credentials.
- **Whitelist is verified first.** Each `--keep` address must exist in Firebase Auth, and at least one must be an approved admin in `staff_accounts`, or the run stops before reading anything else.
- **Unknown collections stop the run.** Any collection not classified in `POLICY` must be given a policy first.
- **Batches of 500** with a pause between commits, and retries with backoff on quota, contention and network errors.
- **Orphans included.** Subcollections are found with `listDocuments`/`listCollections`, so status entries under a missing parent are deleted too.
- **Logins last.** Data goes first, Auth accounts last, and the kept admin is re-verified at the end.
- **A manifest** of everything in scope is written to `scripts/purge-manifest-<project>-<time>.json` (git-ignored; it lists emails).

## Steps

1. **Confirm the admin address.** The live dry run on 2026-10-20 found that `adminmonticello@gmail.com` does not exist; the only super-admin is **`adminmonticellov@gmail.com`**. Re-check in Firebase Console → Authentication if time has passed. The script refuses a non-existent address, but naming the right one is on you.
2. **Back up.** Point-in-time recovery and scheduled backups are off on this project. Take an export first:
   `gcloud firestore export gs://<bucket>/backups/pre-launch-$(date +%F)`
   (Storage files and Auth users are not in that export — download anything you need to keep.)
3. **Credentials.** Firebase Console → Project settings → Service accounts → *Generate new private key*, saved as `scripts/serviceAccountKey.json` (git-ignored). Delete the key afterwards.
4. **Install.** `cd scripts && npm install`
5. **Dry run.** `node purge-test-data.js --keep <admin email>` — read the whole output and the manifest. Every listed Auth account will be deleted.
6. **Execute.** Close the portals and app sessions you control, then:
   `node purge-test-data.js --keep <admin email> --confirm monticello-villas-f600e`
7. **Verify.** Sign in to the Admin portal as the admin; check Settings loads and that the Residents, Incidents and SOS pages are empty. Re-run the dry run: it should report nothing to delete.
8. **Clean up.** Delete `scripts/serviceAccountKey.json` and revoke that key in the console.

Flags: `--keep <email|uid>` (repeatable), `--confirm <projectId>`, `--bucket <name>`,
`--database-url <url>`, `--project <id>`, `--skip-storage`, `--skip-rtdb`.

Related, narrower tools: `reset-operational-data.js` (clears operations, keeps all staff and residents) and `reset-auth-users.js` (removes logins not in `staff_accounts`).
