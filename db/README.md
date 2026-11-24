# Security Personnel Access Control — Relational Schema

The database design behind the Admin Portal's **Security Accounts** console
(`web-portal/apps/admin-portal/src/pages/SecurityAccountsPage.jsx`).

| File                                             | Target                    |
| ------------------------------------------------ | ------------------------- |
| [`schema.postgres.sql`](./schema.postgres.sql)   | PostgreSQL 14+            |
| [`schema.mysql.sql`](./schema.mysql.sql)         | MySQL 8.0.16+             |

Both files are idempotent — re-running one is safe — and each seeds its own
reference data (roles, permissions, shifts, posts, duties). That data is part of
the schema, not of the dataset: application code compares against `role_key`
strings, so an empty `security_roles` is a broken install rather than an empty
one.

## Read this first: which database is actually running

**The application runs on Firestore today.** These files are the relational
model of the same system, and they are not connected to a live server in this
repository.

That is worth stating plainly rather than leaving to be discovered. The
provisioning console, the Cloud Functions in
[`../functions/securityProvisioning.js`](../functions/securityProvisioning.js),
and `firestore.rules` are all working code against Firestore collections. The
schema here is the design these files would migrate onto, and it is where the
constraints Firestore cannot express are written down.

Two reasons it exists as a deliverable rather than as a diagram:

1. **It is the specification for the invariants.** Several rules the running
   system enforces in application code — a badge number is unique, an officer
   has at most one open shift, an audit row cannot be edited — are `UNIQUE`,
   partial-`UNIQUE` and trigger constraints here. Writing them as SQL is what
   makes them checkable rather than aspirational.
2. **The migration path is real.** `security_users.external_uid` holds the
   Firebase Auth uid, so the two can run side by side during a cutover: the
   relational side owns the roster and the audit trail while Firebase Auth keeps
   owning the credential, and the uid is the join key.

## The tables

```
                 ┌──────────────────────┐
                 │  security_permissions│
                 └──────────┬───────────┘
                            │  N:M
                 ┌──────────┴───────────┐
                 │security_role_perms   │
                 └──────────┬───────────┘
                            │
   ┌─────────────────┐      │       ┌──────────────────┐
   │ security_roles  ├──────┘       │  security_shifts │
   └────────┬────────┘              └────────┬─────────┘
            │ 1:N                            │ 1:N
            │        ┌───────────────────┐   │
            └───────►│  security_users   │◄──┘
                     │                   │◄──── security_posts (1:N)
                     └───┬────────┬──────┘
              N:M        │        │        1:N
       ┌─────────────────┘        └──────────────┐
       ▼                                         ▼
┌──────────────────┐                ┌──────────────────────────┐
│security_user_    │                │security_shift_assignments│
│duties            │                │  (the timesheet)         │
└────────┬─────────┘                └──────────────────────────┘
         │ N:1
         ▼
┌──────────────────┐                ┌──────────────────────────┐
│ security_duties  │                │   provisioning_logs      │
└──────────────────┘                │  (append-only; FKs to    │
                                    │   users, SET NULL)       │
                                    └──────────────────────────┘
```

| Table                        | Holds                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| `security_roles`             | RBAC roles — what a credential is **permitted** to do           |
| `security_permissions`       | Atomic capabilities (`incident.file`, `roster.manage`, …)        |
| `security_role_permissions`  | The grants. Authorisation is a JOIN, not an `if` statement       |
| `security_shifts`            | The shift catalogue (Morning / Evening / Night)       |
| `security_posts`             | Gates, checkpoints and routes                                    |
| `security_duties`            | Operational duties — what an officer is **rostered** to do        |
| `security_users`             | The accounts, credentials and lockout state                      |
| `security_user_duties`       | Officers ↔ duties (many-to-many)                                 |
| `security_shift_assignments` | One row per worked shift — the timesheet                         |
| `provisioning_logs`          | Append-only trail of every provisioning action                   |

### Role is not duty

The single most load-bearing separation in the design, and the one most likely
to be "simplified" away by a later hand.

- A **role** is authorisation. `security_officer` opens the Guardhouse Portal;
  `hoa_admin` does not. Every permission check reads it.
- A **duty** is the roster. `lead_dispatcher` means the officer is on the radio
  tonight. It grants nothing.

Collapsing them is tempting because both are lists of labels attached to a
person. The reason not to is that the moment they share a table, somebody writes
a permission check against a duty — and "Lead Dispatcher" silently becomes a
privilege that a shift supervisor can hand out.

**The form collapses them; the storage does not.** The provisioning UI now
presents a single **Access Role** selector holding three job titles — Gate
Guard, Roving Patrol, Security Supervisor — because that is the vocabulary a
guardhouse roster actually uses, and asking an operator to set a "role" and a
"duty" that only ever had one sensible combination was a control with no real
choice in it.

What that selection produces is still two separate values, resolved
**server-side** in `functions/securityProvisioning.js#ACCESS_ROLES`:

| Selected             | `role` (RBAC)      | `duties[]`          |
| -------------------- | ------------------ | ------------------- |
| Gate Guard           | `security_officer` | `gate_guard`        |
| Roving Patrol        | `security_officer` | `roving_patrol`     |
| Security Supervisor  | `security_head`    | `lead_dispatcher`   |

The client sends only the job title. The RBAC role is looked up from that table
and never read from the request, which is stronger than the previous shape —
that one accepted a `role` from the caller and validated it against a list.
Here the browser cannot name its own privilege level at all.

This mapping is also what stops the obvious literal reading from shipping a
broken system: writing `role: 'gate_guard'` would create an account visible in
the admin directory that **cannot sign in**, because no portal allowlist
contains that value and `AuthProvider` signs the session straight back out.

## Security controls

### Passwords

`security_users.password_hash` stores a **PHC-format string** —
`$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>` or `$2b$12$<salt+hash>` — which
carries its own salt and cost parameters. There is deliberately no separate salt
column: a PHC string split across columns can be re-assembled wrongly, and every
library in use emits and parses the combined form.

**Argon2id is the default**; bcrypt at cost ≥ 12 is accepted for rows migrated
from an older system. `password_algo` records which, so an algorithm change can
be gradual — on a successful sign-in the application re-hashes with the current
algorithm and updates both columns. Without that column, changing algorithm
means invalidating every password in the estate on one day.

**Hashing happens in the application, never in SQL.** A hash computed by the
database arrives as plaintext in the query text, which puts it in
`pg_stat_activity`, in the statement log, and in any proxy or query analyser on
the connection. MySQL's own `PASSWORD()` and `MD5()` are additionally unsalted
single-pass hashes and are not an option at all.

**In the Firebase deployment, none of these three columns is used.** Firebase
Auth owns the credential and hashes it with scrypt using a per-project salt
separator; the Admin SDK has no API that returns a password, which is the
property `functions/securityProvisioning.js` relies on. `password_algo` includes
a `scrypt_firebase` value so a migrated row can record where its hash came from.

### The temporary password is never stored

The provisioning console generates it client-side with `crypto.getRandomValues`,
sends it once to create the account, and displays it once at handover. It is not
written to the database, not returned in the response body, and not logged. The
only stored trace is `must_change_password`, which forces the officer to replace
it on first sign-in.

### Lockout

`failed_login_attempts` plus `locked_until`, rather than a boolean. A deadline
expires by itself; a boolean needs something to come along and clear it, and if
that something fails the officer is locked out permanently.

### The audit trail is append-only

`provisioning_logs` is enforced immutable in two layers:

1. A trigger refuses `UPDATE` and `DELETE` for **every** role, including the
   table owner. Privileges can be granted; this cannot be granted around.
2. The (commented) `GRANT` block gives the application role `INSERT` and
   `SELECT` only, so a bug surfaces as a permission error at the call site
   rather than as a trigger exception mid-transaction.

Neither stops an account holding `ALTER` from dropping the trigger, and nothing
in-database can. Shipping the table off-box is what covers that; it is named
here so its absence is a decision rather than an oversight.

`actor_label` and `target_label` are **denormalised on purpose**. Both foreign
keys are `ON DELETE SET NULL`, so after a purge a joined row would read "someone
did something to someone". The snapshots also record the name the person had
*when it happened*, which a join cannot.

## What the relational schema enforces that Firestore cannot

This is the practical argument for the migration, and each row is a real
constraint the running system currently defends in application code.

| Invariant                              | Relational                                  | Firestore today                                                                 |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| Badge number is unique                 | `UNIQUE (badge_number) WHERE deleted_at IS NULL` | A query in `assertBadgeAvailable()`, with a millisecond race between two admins |
| Email is unique per live account       | Partial `UNIQUE`                             | Firebase Auth enforces it for the credential; nothing enforces it for the row    |
| At most one open shift per officer     | `UNIQUE (user_id) WHERE ended_at IS NULL`    | Impossible. `useSecurityAccounts.js` keeps the earliest open clock-in *because* two can exist |
| An audit row cannot be edited          | Trigger + `GRANT`                            | `allow write: if false` — equivalent, and the one control that does transfer     |
| A retired badge can be re-issued       | Partial unique index skips soft-deleted rows | No concept of soft delete                                                        |
| Shift duration matches its timestamps  | Generated column                             | Computed per client, in `mapShiftDoc`                                            |
| Role must exist                        | `FOREIGN KEY ... ON DELETE RESTRICT`         | Nothing. A typo'd role string is a valid document                                |

The reverse is also true and worth stating: Firestore gives real-time
`onSnapshot` fan-out that the whole console is built on, and no amount of SQL
replaces it. A migration means adding a change-feed (`LISTEN/NOTIFY`, logical
replication, or polling) — that cost belongs in the decision.

## PostgreSQL vs MySQL

The two files are the same design. Where MySQL cannot express something, the
workaround is in the file and the difference is here:

| Concern              | PostgreSQL                                  | MySQL 8                                                                  |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| Soft-delete-aware uniqueness | `UNIQUE ... WHERE deleted_at IS NULL` | Generated column that is `NULL` when deleted, then `UNIQUE` (unique ignores NULLs) |
| One open shift       | Partial `UNIQUE`                             | Same NULL-ignoring generated-column trick                                 |
| Free-text search     | `pg_trgm` GIN — **infix** match ("0142" finds "MV-0142") | `FULLTEXT` — whole words and prefixes only, **no suffix match**   |
| Timestamps           | `TIMESTAMPTZ` — zone-aware                   | `DATETIME(3)`, application writes UTC. `TIMESTAMP` was rejected: 2038 ceiling |
| IP addresses         | `INET`                                       | `VARCHAR(45)`                                                             |
| JSON indexing        | `GIN (metadata jsonb_path_ops)` over the whole document | Generated column extracting the one queried path                |
| Time-series index    | `BRIN` on `started_at` — tiny                | Plain B-tree, larger on the same data                                     |
| `updated_at`         | Trigger                                      | `ON UPDATE CURRENT_TIMESTAMP(3)`, native                                  |
| Append-only trail    | One `BEFORE UPDATE OR DELETE` trigger        | Two triggers; MySQL has no combined event                                 |
| Public id default    | `DEFAULT gen_random_uuid()`                  | None possible — MySQL rejects non-deterministic defaults, so the app supplies it |
| Reserved words       | `rank`, `action`                             | Both reserved → `rank_order`, `action_key`                                |

The MySQL file uses `DELIMITER`, which is a `mysql` **client** command. Apply it
with `mysql < schema.mysql.sql`, not through a driver that sends the file as one
statement.

## Field mapping: Firestore → SQL

For anyone reading the console code alongside these files.

| Firestore                                  | SQL                                                     |
| ------------------------------------------ | ------------------------------------------------------- |
| `staff_accounts/{uid}`                     | `security_users` (`external_uid` = the document id)      |
| `.status: 'approved'`                      | `status = 'active'` — see below                          |
| `.status: 'suspended' \| 'revoked'`        | Same values                                              |
| `.accessRole` (job title)                  | derived; `role_id` + `security_user_duties`               |
| `.role` (RBAC)                             | `role_id` → `security_roles.role_key`                    |
| `.duties[]`                                | `security_user_duties` (junction)                        |
| `.assignedPost` / `.shift`                 | `post_id` / `shift_id`                                   |
| `.badgeNumber`                             | `badge_number`                                           |
| `.mustChangePassword`                      | `must_change_password`                                   |
| `guard_shifts/{id}`                        | `security_shift_assignments`                             |
| `provisioning_logs/{id}`                   | `provisioning_logs` (`action` → `action_key` on MySQL)   |
| *(no equivalent — Firebase Auth owns it)*  | `password_hash`, `password_algo`, `last_login_at`        |

### Why `active` is stored as `approved` in Firestore

Three places gate on the literal string `'approved'`: `firestore.rules`
(`isStaff` / `isAdminStaff` / `isSecurityStaff`),
`functions/index.js#requireStaff`, and `AuthContext#resolvePortalRole`.
Introducing a fourth status value would have meant editing all three in
lockstep, and any one missed is a silent authorisation hole.

So **Active is `approved`** — the value those three already accept — and
`suspended` / `revoked` are values none of them accept. Suspension takes effect
through machinery that was already deployed, with no rules change and no window
in which a half-applied policy is in force. `!== 'approved'` is a closed set:
anything that is not the one permitted value is denied, including values
invented later.

The SQL schema has no such history, so it names the state `active` directly.
That rename is the only intentional divergence between the two models.

---

# Resident Accounts & Authentication — Relational Schema

| File                                                       | Target          |
| ---------------------------------------------------------- | --------------- |
| [`schema.auth.postgres.sql`](./schema.auth.postgres.sql)   | PostgreSQL 14+  |
| [`schema.auth.mysql.sql`](./schema.auth.mysql.sql)         | MySQL 8.0.19+   |
| [`test/schema.auth.test.mjs`](./test/schema.auth.test.mjs) | runs the PostgreSQL file in PGlite and checks every constraint |

Resident registration, HOA verification, the HOA ID / proof-of-residency
documents, and the password-reset OTP flow. Independent of the personnel schema
above; either can be applied first. As with that one, **Firestore is what runs**;
this is the specification and the migration target.

## Mapping onto Firebase

| Firebase today                                         | Table / column                                      |
| ------------------------------------------------------ | --------------------------------------------------- |
| `residents/{uid}`                                      | `residents` (`firebase_uid` = the document id)      |
| `.verificationStatus`                                  | `verification_status`; `is_verified` is derived from it |
| `.phase` `.block` `.lot`, `properties/{uid}`           | `resident_properties`, FK to `subdivision_lots`     |
| `.documentUrls[]` + Storage `verification_ids/{uid}/*` | `verification_documents`                            |
| `password_reset_otps/{email}`                          | `password_resets`                                   |
| `SubdivisionDirectory` (Dart)                          | `subdivision_lots`, seeded with all 1,444 lots      |
| *(Firebase Auth owns it)*                              | no resident password column at all                  |

## The reset-token table, field by field

| Asked for              | Here                       | Note |
| ---------------------- | -------------------------- | ---- |
| `id`                   | `id` UUID                  | Firestore keys by email instead: one live doc per address |
| `user_id`              | `user_id` (Firebase uid)   | not an FK to `residents` — staff use the same flow |
| `email`                | `email`, lower-cased by CHECK | the function normalises before it reads or writes |
| `token_hash` / `otp_code` | `otp_hash` + `otp_salt` | **never the code.** sha256(salt:code), computed in the function |
| `expires_at`           | `expires_at`               | CHECK caps it at issue + 10 minutes |
| `is_used`              | `is_used` + `used_at`      | CHECK ties the two together |
| `created_at`           | `created_at`               | |
| `ip_address`           | `ip_address`, `used_ip`    | abuse review only, never a gate; purged after 24 h |

Two rules carry the security, and both are easy to "simplify" away:

1. **One live code per address.** A partial unique index (PostgreSQL) or a
   NULL-when-spent generated column (MySQL). `issue_password_reset()` revokes
   the old code and inserts the new one together.
2. **The attempt budget is per address, not per code.** Five wrong guesses per
   30 minutes across every code issued (`password_reset_attempts_in_window`).
   Resetting the count on each resend once made the cap meaningless.

Retention is 24 hours from issue (`purge_password_resets()`; in Firestore, a TTL
policy on `purgeAt`). It deliberately outlives the 30-minute attempt window:
deleting a row early would refund the guesses spent against it.
