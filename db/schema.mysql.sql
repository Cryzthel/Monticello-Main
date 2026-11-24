-- =============================================================================
--  Monticello Villas — Security Personnel Access Control Schema (MySQL 8.0.16+)
-- =============================================================================
--
--  The MySQL rendering of ./schema.postgres.sql. Same tables, same constraints,
--  same indexes — where MySQL can express them. Where it cannot, the workaround
--  is written out and the difference is stated rather than quietly dropped;
--  ./README.md#postgresql-vs-mysql collects them in one list.
--
--  8.0.16 is the floor because CHECK constraints are PARSED AND IGNORED before
--  it. A schema whose integrity rules silently do nothing is worse than one
--  without them: it reads as protected.
--
--  Apply with:  mysql --user=root --database=monticello < schema.mysql.sql
--
--  utf8mb4 throughout. `utf8` in MySQL is a three-byte subset that cannot store
--  an emoji or several CJK characters, and a name it cannot store is rejected
--  at INSERT with a "string value incorrect" error nobody expects from a name
--  field.
-- =============================================================================

SET NAMES utf8mb4;


-- ── ON TIMESTAMP vs DATETIME ────────────────────────────────────────────────
--
--  Every point-in-time column below is DATETIME(3), not TIMESTAMP, and the
--  application writes UTC.
--
--  TIMESTAMP would have been the obvious choice — it converts to UTC on write
--  and back on read — but it is a 32-bit epoch that ends on 2038-01-19, and a
--  shift record or an audit row is exactly the sort of data that outlives the
--  system that wrote it. DATETIME(3) has no such ceiling and keeps milliseconds,
--  which matters for ordering audit entries written inside one transaction.
--
--  The cost is that DATETIME carries no zone, so "store UTC" is a convention
--  the application must keep rather than something the column enforces. That is
--  the trade PostgreSQL's TIMESTAMPTZ does not make you take.


-- =============================================================================
--  1. security_roles
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_roles (
    role_id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- The string application code compares against. Stable and never re-used:
    -- it is written into audit rows and every authorisation check, so renaming
    -- one silently re-interprets history.
    role_key         VARCHAR(32)  NOT NULL,
    display_name     VARCHAR(64)  NOT NULL,
    description      TEXT         NOT NULL DEFAULT (''),

    -- Privilege ordering for "may this role manage that one". Higher outranks
    -- lower. Not a permission in itself — grants live in the junction table.
    rank_order       SMALLINT     NOT NULL DEFAULT 0,

    -- FALSE for super_admin: minting top-level access stays a deliberate
    -- out-of-band action, so one compromised session cannot self-replicate.
    is_provisionable TINYINT(1)   NOT NULL DEFAULT 1,

    created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (role_id),
    UNIQUE KEY uq_roles_key (role_key),
    CONSTRAINT ck_roles_key_format
        CHECK (REGEXP_LIKE(role_key, '^[a-z][a-z0-9_]{1,31}$'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = 'RBAC roles: what a credential is PERMITTED to do.';

-- `rank` is a RESERVED WORD in MySQL 8 (the window function), so the column is
-- rank_order here and `rank` in PostgreSQL. Renaming it rather than
-- back-quoting it everywhere: a column that only works when quoted is a trap
-- for every ad-hoc query written against this table later.


-- =============================================================================
--  2. security_permissions + security_role_permissions
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_permissions (
    permission_id  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    permission_key VARCHAR(64)  NOT NULL,
    description    TEXT         NOT NULL DEFAULT (''),
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (permission_id),
    UNIQUE KEY uq_permissions_key (permission_key),
    CONSTRAINT ck_permissions_key_format
        CHECK (REGEXP_LIKE(permission_key, '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS security_role_permissions (
    role_id       SMALLINT UNSIGNED NOT NULL,
    permission_id SMALLINT UNSIGNED NOT NULL,
    granted_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (role_id, permission_id),

    -- The reverse lookup ("who has this permission?"), which the composite
    -- PK's leading column cannot serve. InnoDB would create an index on
    -- permission_id anyway to support its FK; naming it makes that explicit.
    KEY idx_srp_permission (permission_id),

    CONSTRAINT fk_srp_role FOREIGN KEY (role_id)
        REFERENCES security_roles (role_id) ON DELETE CASCADE,
    CONSTRAINT fk_srp_permission FOREIGN KEY (permission_id)
        REFERENCES security_permissions (permission_id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  3. security_shifts
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_shifts (
    shift_id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    shift_key    VARCHAR(32) NOT NULL,
    display_name VARCHAR(64) NOT NULL,

    -- NULL for the float/relief slot, which has no fixed window. Nullable
    -- rather than 00:00–00:00, because a zero-length window is a real value
    -- that reporting would treat as a zero-hour shift.
    starts_at    TIME NULL,
    ends_at      TIME NULL,

    -- Generated, never entered. Night runs 22:00–06:00, so ends_at < starts_at
    -- is normal and every duration calculation has to add a day. Deriving the
    -- flag removes the chance of a row where it and the times disagree.
    crosses_midnight TINYINT(1) GENERATED ALWAYS AS (
        starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at <= starts_at
    ) VIRTUAL,

    is_active    TINYINT(1)  NOT NULL DEFAULT 1,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                             ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (shift_id),
    UNIQUE KEY uq_shifts_key (shift_key),
    KEY idx_shifts_active (is_active, shift_id),

    -- Both times or neither. One alone describes nothing.
    CONSTRAINT ck_shifts_window_complete
        CHECK ((starts_at IS NULL) = (ends_at IS NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- MySQL has no partial index, so `idx_shifts_active` leads with the flag
-- instead. It answers the same query; it is simply larger, because the retired
-- rows are in it too.


-- =============================================================================
--  4. security_posts
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_posts (
    post_id      SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    post_key     VARCHAR(32) NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    description  TEXT        NOT NULL DEFAULT (''),

    -- A roving route has no fixed coordinate; a gate does. Nullable rather than
    -- 0,0 — the Atlantic Ocean is not a plausible guard post, and a sentinel
    -- that renders on a map is worse than a blank.
    latitude     DECIMAL(9, 6) NULL,
    longitude    DECIMAL(9, 6) NULL,

    is_active    TINYINT(1)  NOT NULL DEFAULT 1,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                             ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (post_id),
    UNIQUE KEY uq_posts_key (post_key),

    CONSTRAINT ck_posts_coords_paired
        CHECK ((latitude IS NULL) = (longitude IS NULL)),
    CONSTRAINT ck_posts_lat_range
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_posts_lon_range
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  5. security_duties
-- =============================================================================
--
--  SEPARATE FROM ROLES ON PURPOSE. "Lead Dispatcher" is a job on the roster,
--  not a permission: an officer holding it can be given the radio without being
--  given the ability to edit the roster. Collapsing the two — the obvious
--  simplification — is how an operational label silently becomes an
--  authorisation grant the next time somebody writes a check against it.

CREATE TABLE IF NOT EXISTS security_duties (
    duty_id      SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    duty_key     VARCHAR(32) NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    description  TEXT        NOT NULL DEFAULT (''),
    is_active    TINYINT(1)  NOT NULL DEFAULT 1,
    created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (duty_id),
    UNIQUE KEY uq_duties_key (duty_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  6. security_users
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_users (
    user_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- Exposed to clients instead of user_id. A sequential integer in a URL or
    -- an API response leaks the size of the roster and the order people were
    -- hired in, and invites enumeration.
    --
    -- BINARY(16), not CHAR(36): sixteen bytes rather than thirty-six, and it
    -- indexes as a fixed-width key. Convert at the boundary with UUID_TO_BIN()
    -- / BIN_TO_UUID(). Pass the second argument as 1 in BOTH directions —
    -- UUID_TO_BIN(u, 1) swaps the time-low and time-high fields so v1 UUIDs
    -- sort by creation order, and reading one back with BIN_TO_UUID(b) instead
    -- of BIN_TO_UUID(b, 1) returns a different, valid-looking UUID.
    --
    -- NO DEFAULT, and it cannot have one: MySQL rejects a non-deterministic
    -- function in a column default, so `DEFAULT (UUID_TO_BIN(UUID(), 1))` will
    -- not parse. The application supplies it on INSERT. PostgreSQL's
    -- `DEFAULT gen_random_uuid()` has no such restriction, which is the one
    -- place the two files' INSERT contracts genuinely differ.
    public_id          BINARY(16)   NOT NULL,

    -- The Firebase Auth uid, for the hybrid deployment in README.md. Nullable
    -- so this schema stands alone; UNIQUE so one Firebase identity can never
    -- map to two rows.
    external_uid       VARCHAR(128) NULL,

    full_name          VARCHAR(120) NOT NULL,
    email              VARCHAR(254) NOT NULL,

    -- The badge is the officer's operational identity: on the roster sheet, on
    -- every filed report, and over the radio. Two guards sharing one is not a
    -- data problem but an operational one — nobody can tell whose report is
    -- whose.
    badge_number       VARCHAR(16)  NOT NULL,
    contact_number     VARCHAR(24)  NOT NULL DEFAULT '',

    role_id            SMALLINT UNSIGNED NOT NULL,
    shift_id           SMALLINT UNSIGNED NULL,
    post_id            SMALLINT UNSIGNED NULL,

    -- 'active' is the ONLY value that grants access; the application's
    -- authorisation check is an equality against it, so a value added here
    -- later is denied by default rather than permitted by default.
    status             ENUM('active', 'suspended', 'revoked') NOT NULL DEFAULT 'active',
    status_reason      VARCHAR(200) NOT NULL DEFAULT '',

    -- ── CREDENTIALS ──────────────────────────────────────────────────────────
    --
    -- A PHC-format string ("$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>" or
    -- "$2b$12$<salt+hash>") carrying its own salt and cost parameters. No
    -- separate salt column: a PHC string split across columns can be
    -- re-assembled wrongly, and every library in use emits and parses the
    -- combined form.
    --
    -- 255 rather than 60: bcrypt is 60, Argon2id at these parameters is ~97,
    -- and a future parameter increase must not need a migration to store.
    --
    -- HASHING HAPPENS IN THE APPLICATION. Argon2id preferred (memory-hard, so a
    -- GPU farm gains far less against it than against bcrypt); bcrypt at cost
    -- >= 12 accepted for migrated rows. Never MySQL's own PASSWORD() or MD5():
    -- both are unsalted single-pass hashes, and doing it in SQL at all sends
    -- the plaintext through the query, into the general log and into any proxy
    -- on the connection.
    --
    -- COLLATE utf8mb4_0900_as_cs — the default collation for this table is
    -- case-INSENSITIVE, which would make '$2b$12$Ab…' and '$2b$12$aB…' compare
    -- equal. Hash comparison happens in the application, so this is defence
    -- against a WHERE clause somebody adds later, not a live bug.
    password_hash      VARCHAR(255) COLLATE utf8mb4_0900_as_cs NOT NULL,
    password_algo      ENUM('argon2id', 'bcrypt', 'scrypt_firebase') NOT NULL DEFAULT 'argon2id',
    password_updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    -- The force-reset flag the provisioning console sets. The temporary
    -- password itself is NEVER stored — it is shown once at handover and exists
    -- only as a hash from that moment on.
    must_change_password TINYINT(1) NOT NULL DEFAULT 1,

    -- ── LOCKOUT ──────────────────────────────────────────────────────────────
    -- Counter and deadline rather than a boolean, so a lock EXPIRES without a
    -- background job. `locked_until > UTC_TIMESTAMP()` is the whole check; a
    -- boolean needs something to come along and clear it, and if that something
    -- fails the officer is locked out permanently.
    failed_login_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until       DATETIME(3) NULL,

    last_login_at      DATETIME(3) NULL,
    -- VARCHAR(45) holds a full IPv6 address with an IPv4-mapped suffix. MySQL
    -- has no INET type; VARBINARY(16) with INET6_ATON() is denser but makes the
    -- column unreadable in every ad-hoc query, and this one is read by humans
    -- far more often than it is joined on.
    last_login_ip      VARCHAR(45) NULL,

    -- Who provisioned this account. SET NULL rather than CASCADE — deleting a
    -- departed administrator must not delete the guards they hired.
    created_by         BIGINT UNSIGNED NULL,

    created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                   ON UPDATE CURRENT_TIMESTAMP(3),

    -- Soft delete. A hard DELETE would break the FK from
    -- security_shift_assignments — the timesheet an incident response is judged
    -- against — so removal from the directory sets this and revokes the status.
    deleted_at         DATETIME(3) NULL,

    -- ── SOFT-DELETE-AWARE UNIQUENESS, WITHOUT PARTIAL INDEXES ────────────────
    --
    -- PostgreSQL writes this as `UNIQUE ... WHERE deleted_at IS NULL`. MySQL has
    -- no partial index, so the filter moves into a generated column that is
    -- NULL for deleted rows — and a UNIQUE index ignores NULLs, so deleted rows
    -- stop competing for the value.
    --
    -- This matters operationally: a badge number is retired WITH the officer
    -- and can be re-issued years later. A plain UNIQUE would make the directory
    -- refuse a legitimate new hire because of somebody who left in 2019.
    email_active       VARCHAR(254) GENERATED ALWAYS AS
        (IF(deleted_at IS NULL, email, NULL)) VIRTUAL,
    badge_active       VARCHAR(16)  GENERATED ALWAYS AS
        (IF(deleted_at IS NULL, badge_number, NULL)) VIRTUAL,

    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_public_id (public_id),
    UNIQUE KEY uq_users_external_uid (external_uid),
    UNIQUE KEY uq_users_email_active (email_active),
    UNIQUE KEY uq_users_badge_active (badge_active),

    -- ── QUERY INDEXES ────────────────────────────────────────────────────────
    -- Each serves a query the directory screen actually issues; none is
    -- speculative. An unused index is not free — it is written on every INSERT
    -- and UPDATE of a hot table.

    -- The status / role / shift filter pills, in the order the UI applies them.
    KEY idx_users_status_role (status, role_id),
    KEY idx_users_shift (shift_id),
    KEY idx_users_post (post_id),

    -- The default view: active accounts, alphabetical. Leads with `status`
    -- because MySQL cannot express the PostgreSQL partial equivalent, so the
    -- filter has to be in the key rather than in the index predicate.
    KEY idx_users_active_roster (status, full_name),

    -- "Last active" descending, for finding dormant credentials to revoke.
    KEY idx_users_last_login (last_login_at DESC),

    -- The accounts still holding a handed-over temporary password.
    KEY idx_users_pending_reset (must_change_password, updated_at DESC),

    -- The sign-in path. The trailing columns make the check an index-only scan
    -- that never touches the clustered row.
    KEY idx_users_login (email_active, password_hash, password_algo, status),

    KEY fk_users_created_by (created_by),

    -- ── FREE-TEXT SEARCH ─────────────────────────────────────────────────────
    --
    -- The directory's search box, over the three fields it covers.
    --
    -- Declared INSIDE the table rather than as a separate `CREATE FULLTEXT
    -- INDEX`, so the whole file stays re-runnable: MySQL has no
    -- `CREATE INDEX IF NOT EXISTS`, and a standalone statement would fail with
    -- "Duplicate key name" on the second run of an otherwise idempotent script.
    --
    -- NOT EQUIVALENT TO THE POSTGRESQL VERSION, and the difference is worth
    -- knowing before it is discovered: that one is a pg_trgm GIN index and
    -- serves an INFIX match, so searching "0142" finds badge "MV-0142".
    -- MySQL's FULLTEXT is word-based — whole tokens, and prefixes with `*` —
    -- and cannot match a suffix at all. For a roster of tens to low hundreds
    -- the honest answer is that the application may simply filter in memory;
    -- this index is for the case where it does not, with its limit stated so
    -- nobody debugs a "broken search" that is working exactly as specified.
    FULLTEXT KEY idx_users_search (full_name, email, badge_number),

    CONSTRAINT fk_users_role FOREIGN KEY (role_id)
        REFERENCES security_roles (role_id) ON DELETE RESTRICT,
    -- SET NULL, not RESTRICT: retiring a gate must not be blocked by the guards
    -- posted to it. They surface as "unassigned", a visible action item rather
    -- than a failed migration.
    CONSTRAINT fk_users_shift FOREIGN KEY (shift_id)
        REFERENCES security_shifts (shift_id) ON DELETE SET NULL,
    CONSTRAINT fk_users_post FOREIGN KEY (post_id)
        REFERENCES security_posts (post_id) ON DELETE SET NULL,
    CONSTRAINT fk_users_created_by FOREIGN KEY (created_by)
        REFERENCES security_users (user_id) ON DELETE SET NULL,

    CONSTRAINT ck_users_email_format
        -- `\\s` in the literal is a single backslash-s by the time the regex
        -- engine sees it. ICU (MySQL 8) and Postgres ARE both accept the `\s`
        -- shorthand INSIDE a bracket expression, which is what keeps this
        -- pattern byte-identical to the PostgreSQL file's.
        CHECK (REGEXP_LIKE(email, '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$')),
    CONSTRAINT ck_users_email_lowercase
        CHECK (email = LOWER(email)),
    CONSTRAINT ck_users_badge_format
        CHECK (REGEXP_LIKE(badge_number, '^[A-Z0-9-]{2,16}$')),
    -- An active account must not carry a stale suspension note.
    CONSTRAINT ck_users_active_has_no_reason
        CHECK (status <> 'active' OR status_reason = ''),
    -- Deletion and access are one decision. A soft-deleted row still reading
    -- 'active' would pass an authorisation check written against status alone.
    CONSTRAINT ck_users_deleted_is_revoked
        CHECK (deleted_at IS NULL OR status = 'revoked')
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- =============================================================================
--  7. security_user_duties
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_user_duties (
    user_id     BIGINT UNSIGNED   NOT NULL,
    duty_id     SMALLINT UNSIGNED NOT NULL,
    assigned_at DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    assigned_by BIGINT UNSIGNED   NULL,

    PRIMARY KEY (user_id, duty_id),
    KEY idx_sud_duty (duty_id),
    KEY fk_sud_assigned_by (assigned_by),

    CONSTRAINT fk_sud_user FOREIGN KEY (user_id)
        REFERENCES security_users (user_id) ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: deleting a duty officers currently hold should
    -- fail loudly and make the caller reassign them, rather than silently
    -- stripping the roster.
    CONSTRAINT fk_sud_duty FOREIGN KEY (duty_id)
        REFERENCES security_duties (duty_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sud_assigned_by FOREIGN KEY (assigned_by)
        REFERENCES security_users (user_id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  8. security_shift_assignments  — the timesheet
-- =============================================================================
--
--  One row per worked shift: opened at clock-in, closed at clock-out. This is
--  the record an incident response gets judged against, which is why nothing
--  here is deletable and why security_users is soft-deleted — a hard delete
--  would orphan every row below it.

CREATE TABLE IF NOT EXISTS security_shift_assignments (
    assignment_id BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    user_id       BIGINT UNSIGNED   NOT NULL,

    shift_id      SMALLINT UNSIGNED NULL,
    post_id       SMALLINT UNSIGNED NULL,

    started_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    -- NULL means "still on duty". An open interval, not a flag: a boolean plus
    -- a timestamp can disagree, and this cannot.
    ended_at      DATETIME(3) NULL,

    -- Generated, so it cannot drift from the timestamps it summarises. NULL
    -- while the shift is open — the running duration of an open shift changes
    -- every second and is the reader's job.
    duration_minutes INT GENERATED ALWAYS AS (
        IF(ended_at IS NULL, NULL, TIMESTAMPDIFF(MINUTE, started_at, ended_at))
    ) VIRTUAL,

    -- ── AT MOST ONE OPEN SHIFT PER OFFICER ───────────────────────────────────
    --
    -- The same NULL-ignoring trick as the soft-delete uniqueness above: the
    -- column holds the user_id only while the shift is open, so a second open
    -- row for the same officer collides, and every closed row is NULL and
    -- competes with nothing.
    --
    -- This is the constraint the Firestore deployment cannot express at all —
    -- useSecurityAccounts.js has to keep the EARLIEST open clock-in in
    -- application code precisely because two can exist there.
    open_shift_owner BIGINT UNSIGNED GENERATED ALWAYS AS (
        IF(ended_at IS NULL, user_id, NULL)
    ) VIRTUAL,

    notes         TEXT NOT NULL DEFAULT (''),

    PRIMARY KEY (assignment_id),
    UNIQUE KEY uq_ssa_one_open_shift (open_shift_owner),

    -- "This officer's shifts, most recent first" — the drawer's query.
    KEY idx_ssa_user_recent (user_id, started_at DESC),
    -- "Who was on duty at 02:00 last Tuesday" — the incident-correlation query.
    -- A plain B-tree; MySQL has no BRIN, so this is larger than the PostgreSQL
    -- equivalent on the same data.
    KEY idx_ssa_started (started_at),
    KEY fk_ssa_shift (shift_id),
    KEY fk_ssa_post (post_id),

    CONSTRAINT fk_ssa_user FOREIGN KEY (user_id)
        REFERENCES security_users (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_ssa_shift FOREIGN KEY (shift_id)
        REFERENCES security_shifts (shift_id) ON DELETE SET NULL,
    CONSTRAINT fk_ssa_post FOREIGN KEY (post_id)
        REFERENCES security_posts (post_id) ON DELETE SET NULL,

    CONSTRAINT ck_ssa_ends_after_start
        CHECK (ended_at IS NULL OR ended_at > started_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  9. provisioning_logs  — append-only provisioning trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS provisioning_logs (
    log_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    occurred_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    -- Coarse bucket ('security', 'incident', 'resident'), so one log table can
    -- serve every subsystem and each console can filter to its own without a
    -- prefix match on `action`.
    category      VARCHAR(32) NOT NULL,
    action_key    VARCHAR(64) NOT NULL,

    actor_user_id  BIGINT UNSIGNED NULL,
    target_user_id BIGINT UNSIGNED NULL,

    -- ── WHY THE LABELS ARE DENORMALISED ──────────────────────────────────────
    -- Both FKs are ON DELETE SET NULL, so after a purge the row would otherwise
    -- read "someone did something to someone". These snapshots are written at
    -- the moment of the action and never updated, which also makes them correct
    -- in a second way a JOIN is not: they record the name the person had WHEN
    -- IT HAPPENED, not the name they have now.
    actor_label   VARCHAR(160) NOT NULL,
    target_label  VARCHAR(160) NOT NULL DEFAULT '',

    summary       TEXT NOT NULL,

    -- Action-specific detail (old/new status, duties changed, force-reset
    -- flag). JSON rather than columns because the shape differs per action, and
    -- a wide table of mostly-NULL columns is worse than a document.
    metadata      JSON NOT NULL DEFAULT (JSON_OBJECT()),

    ip_address    VARCHAR(45) NULL,
    user_agent    TEXT NULL,

    -- MySQL cannot index a JSON column directly. A generated column extracting
    -- the one path that is actually queried — the status an account moved TO —
    -- gives that filter an index; anything else in the blob is read, not
    -- searched. PostgreSQL indexes the whole document with GIN and needs no
    -- equivalent.
    meta_status_to VARCHAR(32) GENERATED ALWAYS AS
        (JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.to'))) VIRTUAL,

    PRIMARY KEY (log_id),

    -- The console's default query: one category, newest first.
    KEY idx_audit_category_time (category, occurred_at DESC),
    -- "Everything that ever happened to this account."
    KEY idx_audit_target_time (target_user_id, occurred_at DESC),
    -- "Everything this administrator did."
    KEY idx_audit_actor_time (actor_user_id, occurred_at DESC),
    KEY idx_audit_status_to (meta_status_to),

    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id)
        REFERENCES security_users (user_id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_target FOREIGN KEY (target_user_id)
        REFERENCES security_users (user_id) ON DELETE SET NULL,

    CONSTRAINT ck_audit_summary_not_blank CHECK (CHAR_LENGTH(TRIM(summary)) > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- `action` is a RESERVED WORD in MySQL 8, so the column is action_key here and
-- `action` in PostgreSQL. Renaming rather than back-quoting, for the same
-- reason as rank_order above.


-- ── APPEND-ONLY ENFORCEMENT ──────────────────────────────────────────────────
--
--  An audit trail its own subject can edit is not an audit trail. Two layers,
--  because each covers what the other does not:
--
--    1. The triggers below refuse UPDATE and DELETE for EVERY user, including
--       the schema owner. Privileges can be granted; these cannot be granted
--       around.
--    2. The REVOKE at the bottom stops the application user from attempting
--       one, so a bug surfaces as a permission error at the call site rather
--       than as a trigger exception mid-transaction.
--
--  Neither stops an account with ALTER privilege from dropping the triggers,
--  and nothing in-database can. Off-box shipping of this table is what covers
--  that; it is named here so its absence is a decision rather than an oversight.
--
--  MySQL needs one trigger per event — there is no `BEFORE UPDATE OR DELETE`.

DELIMITER $$

DROP TRIGGER IF EXISTS trg_audit_logs_no_update $$
CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON provisioning_logs FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'provisioning_logs is append-only: UPDATE is not permitted';
END $$

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete $$
CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON provisioning_logs FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'provisioning_logs is append-only: DELETE is not permitted';
END $$

DELIMITER ;


-- =============================================================================
--  VIEWS
-- =============================================================================

-- The directory table's query, as one object. The screen needs the officer plus
-- the display name of four related rows plus an aggregated duty list; expressing
-- it as a view keeps the join out of the application and makes the column list
-- the UI depends on a schema artefact a migration can see.
CREATE OR REPLACE VIEW v_security_roster AS
SELECT
    u.user_id,
    BIN_TO_UUID(u.public_id, 1) AS public_id,
    u.external_uid,
    u.full_name,
    u.email,
    u.badge_number,
    u.contact_number,
    u.status,
    u.status_reason,
    u.must_change_password,
    u.last_login_at,
    u.created_at,
    u.updated_at,
    r.role_key,
    r.display_name AS role_name,
    s.shift_key,
    s.display_name AS shift_name,
    s.starts_at    AS shift_starts_at,
    s.ends_at      AS shift_ends_at,
    p.post_key,
    p.display_name AS post_name,

    -- MySQL has no array type, so the duty list is a comma-joined string the
    -- application splits. Ordered, so two officers with the same duties produce
    -- the same string and a caller can compare them without parsing.
    --
    -- GROUP_CONCAT silently TRUNCATES at group_concat_max_len (1024 by default)
    -- rather than erroring. Three duties cannot reach that, but the failure
    -- mode is worth knowing: it is why this is not the pattern to reach for on
    -- a list that can grow.
    COALESCE((
        SELECT GROUP_CONCAT(d.duty_key ORDER BY d.duty_key SEPARATOR ',')
          FROM security_user_duties ud
          JOIN security_duties d ON d.duty_id = ud.duty_id
         WHERE ud.user_id = u.user_id
    ), '') AS duties,

    -- Live duty state, derived from the open shift rather than stored. A stored
    -- `is_on_duty` flag is a second source of truth that goes stale the moment
    -- a clock-out write fails.
    EXISTS (
        SELECT 1 FROM security_shift_assignments a
         WHERE a.user_id = u.user_id AND a.ended_at IS NULL
    ) AS on_duty,

    -- "Last active": the end of the most recent shift, or its start if it is
    -- still running. Genuinely when the officer was last ON POST, which is a
    -- more useful answer than a sign-in time — someone who opens the portal and
    -- does nothing is not active.
    (SELECT MAX(COALESCE(a.ended_at, a.started_at))
       FROM security_shift_assignments a
      WHERE a.user_id = u.user_id) AS last_active_at

FROM security_users u
JOIN security_roles r  ON r.role_id  = u.role_id
LEFT JOIN security_shifts s ON s.shift_id = u.shift_id
LEFT JOIN security_posts  p ON p.post_id  = u.post_id
WHERE u.deleted_at IS NULL;

-- Effective permissions per account, for the authorisation check. One indexed
-- lookup replaces a role list hard-coded into each service.
CREATE OR REPLACE VIEW v_security_effective_permissions AS
SELECT
    u.user_id,
    BIN_TO_UUID(u.public_id, 1) AS public_id,
    u.email,
    p.permission_key
FROM security_users u
JOIN security_role_permissions rp ON rp.role_id = u.role_id
JOIN security_permissions p       ON p.permission_id = rp.permission_id
WHERE u.deleted_at IS NULL
  AND u.status = 'active';


-- =============================================================================
--  REFERENCE DATA
-- =============================================================================
--
--  INSERT IGNORE throughout, so re-running the file is safe and an operator's
--  edits to display names survive it.

INSERT IGNORE INTO security_roles (role_key, display_name, description, rank_order, is_provisionable) VALUES
    ('super_admin',      'Super Admin',      'Full administrative control, including provisioning.',     100, 0),
    ('hoa_admin',        'HOA Admin',        'Estate administration; reads the security roster.',         80, 0),
    ('security_head',    'Security Head',    'Guardhouse portal, plus oversight of the officer roster.',  60, 1),
    ('security_officer', 'Security Officer', 'Guardhouse portal: files reports, responds to alerts.',     40, 1);

INSERT IGNORE INTO security_permissions (permission_key, description) VALUES
    ('incident.read',     'View incident tickets.'),
    ('incident.file',     'File an officer report.'),
    ('incident.dispatch', 'Mark an incident dispatched or resolved.'),
    ('panic.read',        'See panic alerts.'),
    ('panic.acknowledge', 'Acknowledge a panic alert and dispatch a responder.'),
    ('shift.clock',       'Clock in and out of a shift.'),
    ('roster.read',       'View the security roster.'),
    ('roster.manage',     'Re-assign posts, shifts and duties.'),
    ('account.provision', 'Create security accounts and issue credentials.'),
    ('account.status',    'Suspend, revoke or reactivate an account.'),
    ('audit.read',        'Read the provisioning audit trail.');

-- Written as a set expression rather than a list of id pairs, so it stays
-- readable and cannot go stale against AUTO_INCREMENT.
INSERT IGNORE INTO security_role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM security_roles r
  JOIN security_permissions p
 WHERE (r.role_key = 'security_officer' AND p.permission_key IN (
          'incident.read', 'incident.file', 'panic.read', 'panic.acknowledge', 'shift.clock'))
    OR (r.role_key = 'security_head' AND p.permission_key IN (
          'incident.read', 'incident.file', 'incident.dispatch', 'panic.read',
          'panic.acknowledge', 'shift.clock', 'roster.read', 'roster.manage'))
    OR (r.role_key = 'hoa_admin' AND p.permission_key IN (
          'incident.read', 'incident.dispatch', 'panic.read', 'panic.acknowledge',
          'roster.read', 'audit.read'))
    -- Super admin holds everything, by definition rather than enumeration: a
    -- permission added later is granted to it on the next run of this file.
    OR r.role_key = 'super_admin';

INSERT IGNORE INTO security_shifts (shift_key, display_name, starts_at, ends_at) VALUES
    ('morning',   'Morning Shift',   '06:00:00', '14:00:00'),
    ('evening',   'Evening Shift',   '14:00:00', '22:00:00'),
    ('night',     'Night Shift',     '22:00:00', '06:00:00');

INSERT IGNORE INTO security_posts (post_key, display_name, description) VALUES
    ('main_gate',     'Main Gate',            'Primary vehicle and visitor entry.'),
    ('secondary_gate','Secondary Gate',       'Secondary entry, residents only.'),
    ('clubhouse',     'Clubhouse',            'Amenity area and function hall.'),
    ('perimeter_patrol','Perimeter Patrol',   'Roving circuit of the boundary wall.');

INSERT IGNORE INTO security_duties (duty_key, display_name, description) VALUES
    ('gate_guard',      'Gate Guard',      'Mans a fixed entry post — visitor logging and vehicle checks.'),
    ('roving_patrol',   'Roving Patrol',   'Walks or drives the perimeter and interior roads on a circuit.'),
    ('lead_dispatcher', 'Lead Dispatcher', 'Owns the radio and triages panic alerts to responders.'),
    ('supervisor',      'Supervisor',      'Oversees the officer roster and approves shift changes.');


-- =============================================================================
--  PRIVILEGES
-- =============================================================================
--
--  The application connects as 'monticello_app' and deliberately holds no ALTER
--  privilege: an application account that can ALTER its own tables can drop the
--  audit triggers. Create the user out of band, then run this block.
--
--  Commented out because a user that does not exist makes the whole file fail,
--  and this schema has to be runnable against an empty database to be useful.

-- GRANT SELECT, INSERT, UPDATE, DELETE ON monticello.security_users            TO 'monticello_app'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON monticello.security_user_duties      TO 'monticello_app'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON monticello.security_shift_assignments TO 'monticello_app'@'%';
-- GRANT SELECT ON monticello.security_roles                    TO 'monticello_app'@'%';
-- GRANT SELECT ON monticello.security_permissions              TO 'monticello_app'@'%';
-- GRANT SELECT ON monticello.security_role_permissions         TO 'monticello_app'@'%';
-- GRANT SELECT ON monticello.security_shifts                   TO 'monticello_app'@'%';
-- GRANT SELECT ON monticello.security_posts                    TO 'monticello_app'@'%';
-- GRANT SELECT ON monticello.security_duties                   TO 'monticello_app'@'%';
-- GRANT SELECT ON monticello.v_security_roster                 TO 'monticello_app'@'%';
-- GRANT SELECT ON monticello.v_security_effective_permissions  TO 'monticello_app'@'%';
-- -- INSERT and SELECT only. The triggers refuse the other two for everyone;
-- -- this makes the attempt fail at the call site instead of inside a transaction.
-- GRANT SELECT, INSERT ON monticello.provisioning_logs                TO 'monticello_app'@'%';


