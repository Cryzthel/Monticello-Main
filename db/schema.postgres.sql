-- =============================================================================
--  Monticello Villas — Security Personnel Access Control Schema (PostgreSQL 14+)
-- =============================================================================
--
--  The relational model behind the Admin Portal's Security Account Provisioning
--  and Access Management console. See ./README.md for how this maps onto the
--  Firestore collections the application currently runs on, and for which
--  constraints below the Firestore deployment CANNOT express.
--
--  Apply with:   psql -d monticello -v ON_ERROR_STOP=1 -f schema.postgres.sql
--  Idempotent:   every object is CREATE ... IF NOT EXISTS or guarded by DO $$.
--
--  Reference data (roles, permissions, shifts, posts, duties) is seeded at the
--  bottom. It is part of the SCHEMA, not of the data: a role key is referenced
--  by application code, so an empty security_roles table is a broken install
--  rather than an empty one.
-- =============================================================================

BEGIN;

-- pgcrypto is used only for gen_random_uuid(). Password hashing is done in the
-- APPLICATION (see the note above security_users.password_hash), never here:
-- a hash computed inside the database arrives as plaintext in the query, which
-- puts it in pg_stat_activity and in the statement log.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
--  ENUMERATED TYPES
-- =============================================================================
--
--  ENUM rather than a lookup table for these two, and a lookup TABLE for roles,
--  shifts, posts and duties. The line between them is whether the application
--  branches on the value:
--
--    * Account status has exactly three values, every one of which the code
--      has a distinct branch for, and adding a fourth is a code change no
--      matter where the value is stored. An ENUM makes that explicit and gives
--      the check for free.
--    * A role, a shift or a post is DATA. A new gate opens, a fourth shift is
--      added for the holidays — an operator should be able to do that without
--      a migration. Those are tables.

DO $$ BEGIN
  CREATE TYPE security_account_status AS ENUM ('active', 'suspended', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- The algorithm the stored hash was produced with. Present so a migration
  -- from bcrypt to Argon2id can be gradual: on a successful sign-in the
  -- application re-hashes with the current algorithm and updates both columns.
  -- Without it, an algorithm change means invalidating every password in the
  -- estate on one day.
  CREATE TYPE password_algorithm AS ENUM ('argon2id', 'bcrypt', 'scrypt_firebase');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
--  1. security_roles  — RBAC roles
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_roles (
    role_id          SMALLINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- The string the application compares against. Stable, lower_snake, and
    -- never re-used: this value is written into audit rows and into every
    -- authorisation check, so renaming one silently re-interprets history.
    role_key         VARCHAR(32)   NOT NULL UNIQUE,
    display_name     VARCHAR(64)   NOT NULL,
    description      TEXT          NOT NULL DEFAULT '',

    -- Privilege ordering, for "may this role manage that one" checks. Higher
    -- outranks lower. Not a permission in itself — the grants live in
    -- security_role_permissions — but a role cannot administer a rank at or
    -- above its own.
    rank             SMALLINT      NOT NULL DEFAULT 0,

    -- Whether the provisioning form may hand this role out. FALSE for
    -- super_admin: minting top-level access stays a deliberate out-of-band
    -- action, so one compromised admin session cannot self-replicate.
    is_provisionable BOOLEAN       NOT NULL DEFAULT TRUE,

    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT security_roles_key_format CHECK (role_key ~ '^[a-z][a-z0-9_]{1,31}$')
);

COMMENT ON TABLE security_roles IS
  'RBAC roles. What a credential is PERMITTED to do. Distinct from security_duties, which is what the officer is ROSTERED to do.';


-- =============================================================================
--  2. security_permissions + security_role_permissions  — the RBAC grants
-- =============================================================================
--
--  Permissions are separated from roles so authorisation is a JOIN rather than
--  a hard-coded list. Without this pair, "can a Security Head resolve an
--  incident?" is answered by an if-statement in every service that asks, and
--  the answers drift. With it there is one query, and a policy change is an
--  INSERT rather than a deploy.

CREATE TABLE IF NOT EXISTS security_permissions (
    permission_id   SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permission_key  VARCHAR(64)  NOT NULL UNIQUE,
    description     TEXT         NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT security_permissions_key_format
        CHECK (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

CREATE TABLE IF NOT EXISTS security_role_permissions (
    role_id       SMALLINT NOT NULL,
    permission_id SMALLINT NOT NULL,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (role_id, permission_id),

    -- CASCADE on both: a junction row is meaningless once either side is gone,
    -- and leaving orphans would let a re-used id silently inherit old grants.
    CONSTRAINT fk_srp_role
        FOREIGN KEY (role_id) REFERENCES security_roles (role_id) ON DELETE CASCADE,
    CONSTRAINT fk_srp_permission
        FOREIGN KEY (permission_id) REFERENCES security_permissions (permission_id) ON DELETE CASCADE
);

-- The reverse lookup ("who has this permission?"), which the composite PK's
-- leading column does not serve.
CREATE INDEX IF NOT EXISTS idx_srp_permission ON security_role_permissions (permission_id);


-- =============================================================================
--  3. security_shifts  — the shift catalogue
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_shifts (
    shift_id       SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shift_key      VARCHAR(32)  NOT NULL UNIQUE,
    display_name   VARCHAR(64)  NOT NULL,

    -- NULL for a float/relief slot, which has no fixed window. Nullable rather
    -- than 00:00–00:00, because a zero-length window is a real value that
    -- reporting would treat as a zero-hour shift.
    starts_at      TIME,
    ends_at        TIME,

    -- Generated, never entered. A night shift is 22:00–06:00, so ends_at <
    -- starts_at is normal and every duration calculation has to add a day.
    -- Deriving it removes the chance of a row where the flag and the times
    -- disagree.
    crosses_midnight BOOLEAN GENERATED ALWAYS AS (
        starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at <= starts_at
    ) STORED,

    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Both times or neither. One alone describes nothing.
    CONSTRAINT security_shifts_window_complete
        CHECK ((starts_at IS NULL) = (ends_at IS NULL))
);

-- Only active shifts are offered by the provisioning form. A partial index
-- keeps that lookup off the retired rows, and stays small as the catalogue
-- accumulates seasonal shifts nobody works any more.
CREATE INDEX IF NOT EXISTS idx_shifts_active ON security_shifts (shift_id) WHERE is_active;


-- =============================================================================
--  4. security_posts  — gates, checkpoints and routes
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_posts (
    post_id      SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_key     VARCHAR(32)  NOT NULL UNIQUE,
    display_name VARCHAR(64)  NOT NULL,
    description  TEXT         NOT NULL DEFAULT '',

    -- A roving route has no fixed coordinate; a gate does. Nullable rather
    -- than 0,0 — the Atlantic Ocean is not a plausible guard post, and a
    -- sentinel that renders on a map is worse than a blank.
    latitude     NUMERIC(9, 6),
    longitude    NUMERIC(9, 6),

    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT security_posts_coords_paired
        CHECK ((latitude IS NULL) = (longitude IS NULL)),
    CONSTRAINT security_posts_lat_range
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CONSTRAINT security_posts_lon_range
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);


-- =============================================================================
--  5. security_duties  — operational assignments
-- =============================================================================
--
--  SEPARATE FROM ROLES ON PURPOSE. "Lead Dispatcher" is a job on the roster,
--  not a permission: an officer holding it can be given the radio without being
--  given the ability to edit the roster. Collapsing the two — which is the
--  obvious simplification — is how an operational label silently becomes an
--  authorisation grant the next time someone writes a check against it.

CREATE TABLE IF NOT EXISTS security_duties (
    duty_id      SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    duty_key     VARCHAR(32)  NOT NULL UNIQUE,
    display_name VARCHAR(64)  NOT NULL,
    description  TEXT         NOT NULL DEFAULT '',
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- =============================================================================
--  6. security_users  — the accounts
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_users (
    user_id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Exposed to clients instead of user_id. A sequential integer in a URL or
    -- an API response leaks the size of the roster and the order people were
    -- hired in, and invites enumeration.
    public_id          UUID         NOT NULL DEFAULT gen_random_uuid() UNIQUE,

    -- The Firebase Auth uid, for the hybrid deployment described in README.md.
    -- Nullable so this schema stands alone, UNIQUE so one Firebase identity can
    -- never map to two rows.
    external_uid       VARCHAR(128) UNIQUE,

    full_name          VARCHAR(120) NOT NULL,
    email              VARCHAR(254) NOT NULL,

    -- The badge is the officer's operational identity: it is on the roster
    -- sheet, on every filed report, and is what goes over the radio. Two guards
    -- sharing one is not a data problem but an operational one — nobody can
    -- tell whose report is whose. UNIQUE is declared below as an index so the
    -- format check and the uniqueness are separately diagnosable.
    badge_number       VARCHAR(16)  NOT NULL,
    contact_number     VARCHAR(24)  NOT NULL DEFAULT '',

    role_id            SMALLINT     NOT NULL,
    shift_id           SMALLINT,
    post_id            SMALLINT,

    status             security_account_status NOT NULL DEFAULT 'active',
    status_reason      VARCHAR(200) NOT NULL DEFAULT '',

    -- ── CREDENTIALS ──────────────────────────────────────────────────────────
    --
    -- A PHC-format string ("$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>" or
    -- "$2b$12$<salt+hash>"), which carries its own salt and cost parameters. No
    -- separate salt column: a PHC string that has been split across columns can
    -- be re-assembled wrongly, and every library in use emits and parses the
    -- combined form.
    --
    -- 255 rather than 60: bcrypt is 60, Argon2id at these parameters is ~97,
    -- and a future parameter increase must not require a migration to store the
    -- output.
    --
    -- HASHING HAPPENS IN THE APPLICATION. Argon2id is the default (memory-hard,
    -- so a GPU farm gains far less against it than against bcrypt); bcrypt at
    -- cost >= 12 is supported for rows migrated from an older system. Doing it
    -- in SQL instead would send the plaintext through the query, which lands it
    -- in pg_stat_activity, in log_statement output, and in any query analyser
    -- attached to the connection.
    password_hash      VARCHAR(255) NOT NULL,
    password_algo      password_algorithm NOT NULL DEFAULT 'argon2id',
    password_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The force-reset flag the provisioning console sets. The temporary
    -- password itself is NEVER stored anywhere — it is shown once at handover
    -- and exists only as a hash from that moment on.
    must_change_password BOOLEAN    NOT NULL DEFAULT TRUE,

    -- ── LOCKOUT ──────────────────────────────────────────────────────────────
    -- Counter and deadline rather than a boolean, so a lock EXPIRES without a
    -- background job. `locked_until > now()` is the whole check; a boolean
    -- needs something to come along and clear it, and if that something fails
    -- the officer is locked out permanently.
    failed_login_attempts SMALLINT  NOT NULL DEFAULT 0,
    locked_until       TIMESTAMPTZ,

    last_login_at      TIMESTAMPTZ,
    last_login_ip      INET,

    -- Self-referencing: who provisioned this account. SET NULL rather than
    -- CASCADE — deleting a departed administrator must not delete the guards
    -- they hired.
    created_by         BIGINT,

    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Soft delete. A hard DELETE would break the FK from security_shift_
    -- assignments — the timesheet an incident response is judged against — so
    -- removal from the directory sets this and revokes the status instead.
    deleted_at         TIMESTAMPTZ,

    CONSTRAINT fk_users_role
        FOREIGN KEY (role_id) REFERENCES security_roles (role_id) ON DELETE RESTRICT,
    -- SET NULL, not RESTRICT: retiring a gate should not be blocked by the
    -- guards posted to it. They surface as "unassigned", which is a visible
    -- action item rather than a failed migration.
    CONSTRAINT fk_users_shift
        FOREIGN KEY (shift_id) REFERENCES security_shifts (shift_id) ON DELETE SET NULL,
    CONSTRAINT fk_users_post
        FOREIGN KEY (post_id) REFERENCES security_posts (post_id) ON DELETE SET NULL,
    CONSTRAINT fk_users_created_by
        FOREIGN KEY (created_by) REFERENCES security_users (user_id) ON DELETE SET NULL,

    -- `\s` inside a bracket expression is accepted by both Postgres ARE and
    -- MySQL's ICU engine, which keeps this pattern identical to the one in
    -- schema.mysql.sql — a difference between the two files should mean a
    -- difference in policy, never a difference in regex dialect.
    CONSTRAINT security_users_email_format
        CHECK (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
    CONSTRAINT security_users_email_lowercase
        CHECK (email = lower(email)),
    CONSTRAINT security_users_badge_format
        CHECK (badge_number ~ '^[A-Z0-9-]{2,16}$'),
    CONSTRAINT security_users_attempts_nonneg
        CHECK (failed_login_attempts >= 0),

    -- A revoked account cannot be the one that provisioned nothing; but it CAN
    -- have a reason, and an active one must not carry a stale suspension note.
    CONSTRAINT security_users_active_has_no_reason
        CHECK (status <> 'active' OR status_reason = ''),

    -- Deletion and access are one decision. A soft-deleted row that still reads
    -- 'active' would pass an authorisation check written against status alone.
    CONSTRAINT security_users_deleted_is_revoked
        CHECK (deleted_at IS NULL OR status = 'revoked')
);

-- ── UNIQUENESS ───────────────────────────────────────────────────────────────
--
-- Partial, excluding soft-deleted rows. A badge number is retired WITH the
-- officer and can be re-issued years later; a plain UNIQUE would make the
-- directory refuse a legitimate new hire because of somebody who left in 2019.
-- Email behaves the same way and is additionally case-folded: the CHECK above
-- makes lowercase the only storable form, so the index does not need LOWER().
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email
    ON security_users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_badge
    ON security_users (badge_number) WHERE deleted_at IS NULL;

-- ── QUERY INDEXES ────────────────────────────────────────────────────────────
--
-- Each of these serves a query the directory screen actually issues; none is
-- speculative. An unused index is not free — it is written on every INSERT and
-- UPDATE of a hot table.

-- The default view: active accounts, alphabetical. Partial + ordered, so it
-- answers the sort as well as the filter and the planner can walk it directly.
CREATE INDEX IF NOT EXISTS idx_users_active_roster
    ON security_users (full_name)
    WHERE status = 'active' AND deleted_at IS NULL;

-- The status / role / shift filter pills, in the order the UI applies them.
CREATE INDEX IF NOT EXISTS idx_users_status_role
    ON security_users (status, role_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_shift
    ON security_users (shift_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_post
    ON security_users (post_id) WHERE deleted_at IS NULL;

-- "Last active" sorted descending, for finding dormant credentials to revoke.
-- NULLS LAST matches the UI, which shows never-signed-in accounts at the end
-- rather than at the top where they would look like the most recent.
CREATE INDEX IF NOT EXISTS idx_users_last_login
    ON security_users (last_login_at DESC NULLS LAST) WHERE deleted_at IS NULL;

-- The accounts still holding a handed-over temporary password — the operational
-- follow-up queue. Partial on the TRUE case only: the FALSE case is most of the
-- table and is never queried.
CREATE INDEX IF NOT EXISTS idx_users_pending_reset
    ON security_users (updated_at DESC) WHERE must_change_password AND deleted_at IS NULL;

-- Free-text search across the three fields the search box covers. GIN over a
-- trigram index, so an infix match ("santos", "0142") uses the index — a B-tree
-- can only serve a prefix, and an admin searching a badge suffix would table
-- scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_users_search
    ON security_users USING GIN (
        (full_name || ' ' || email || ' ' || badge_number) gin_trgm_ops
    ) WHERE deleted_at IS NULL;

-- The sign-in path. Case-folding is already guaranteed by the CHECK, so this is
-- a straight equality lookup; INCLUDE carries the columns the auth handler
-- needs so the check is an index-only scan and never touches the heap.
CREATE INDEX IF NOT EXISTS idx_users_login
    ON security_users (email)
    INCLUDE (password_hash, password_algo, status, locked_until, failed_login_attempts)
    WHERE deleted_at IS NULL;

COMMENT ON COLUMN security_users.password_hash IS
  'PHC-format string including salt and cost parameters. Produced by the application (Argon2id preferred), never by the database.';


-- =============================================================================
--  7. security_user_duties  — officers to duties (many-to-many)
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_user_duties (
    user_id     BIGINT      NOT NULL,
    duty_id     SMALLINT    NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by BIGINT,

    PRIMARY KEY (user_id, duty_id),

    CONSTRAINT fk_sud_user
        FOREIGN KEY (user_id) REFERENCES security_users (user_id) ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: deleting a duty that officers currently hold
    -- should fail loudly and make the caller reassign them, rather than
    -- silently stripping the roster.
    CONSTRAINT fk_sud_duty
        FOREIGN KEY (duty_id) REFERENCES security_duties (duty_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sud_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES security_users (user_id) ON DELETE SET NULL
);

-- "Who is on roving patrol tonight?" — the reverse of the PK's leading column.
CREATE INDEX IF NOT EXISTS idx_sud_duty ON security_user_duties (duty_id);


-- =============================================================================
--  8. security_shift_assignments  — the timesheet
-- =============================================================================
--
--  One row per worked shift: opened at clock-in, closed at clock-out. This is
--  the record an incident response gets judged against, which is why nothing
--  here is deletable and why security_users is soft-deleted — a hard delete
--  would orphan every row below it.

CREATE TABLE IF NOT EXISTS security_shift_assignments (
    assignment_id BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT      NOT NULL,

    -- Which catalogue shift and post this was worked as. SET NULL on delete
    -- so retiring a post does not erase the history of it being manned.
    shift_id      SMALLINT,
    post_id       SMALLINT,

    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL means "still on duty". An open interval, not a flag: a boolean plus
    -- a timestamp can disagree, and this cannot.
    ended_at      TIMESTAMPTZ,

    -- Generated, so it cannot drift from the timestamps it summarises. NULL
    -- while the shift is open; the running duration of an open shift is the
    -- reader's job, since it changes every second.
    duration_minutes INTEGER GENERATED ALWAYS AS (
        CASE WHEN ended_at IS NULL THEN NULL
             ELSE (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::INTEGER
        END
    ) STORED,

    notes         TEXT        NOT NULL DEFAULT '',

    CONSTRAINT fk_ssa_user
        FOREIGN KEY (user_id) REFERENCES security_users (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_ssa_shift
        FOREIGN KEY (shift_id) REFERENCES security_shifts (shift_id) ON DELETE SET NULL,
    CONSTRAINT fk_ssa_post
        FOREIGN KEY (post_id) REFERENCES security_posts (post_id) ON DELETE SET NULL,

    CONSTRAINT ssa_ends_after_start
        CHECK (ended_at IS NULL OR ended_at > started_at)
);

-- AT MOST ONE OPEN SHIFT PER OFFICER.
--
-- This is the constraint the Firestore deployment cannot express at all, and
-- the duplicate-open-shift case the web hook has to defend against in
-- application code (useSecurityAccounts.js keeps the EARLIEST open clock-in
-- precisely because two can exist). A partial unique index makes it impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ssa_one_open_shift
    ON security_shift_assignments (user_id) WHERE ended_at IS NULL;

-- "This officer's shifts, most recent first" — the drawer's query.
CREATE INDEX IF NOT EXISTS idx_ssa_user_recent
    ON security_shift_assignments (user_id, started_at DESC);

-- "Who was on duty at 02:00 last Tuesday" — the incident-correlation query.
-- BRIN rather than B-tree: the column is append-only and physically ordered by
-- time, which is exactly the shape BRIN is for, at a fraction of the size.
CREATE INDEX IF NOT EXISTS idx_ssa_started_brin
    ON security_shift_assignments USING BRIN (started_at);


-- =============================================================================
--  9. provisioning_logs  — append-only provisioning trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS provisioning_logs (
    log_id        BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Coarse bucket ('security', 'incident', 'resident'), so one log table can
    -- serve every subsystem and each console can filter to its own without a
    -- prefix match on `action`.
    category      VARCHAR(32) NOT NULL,
    action        VARCHAR(64) NOT NULL,

    actor_user_id  BIGINT,
    target_user_id BIGINT,

    -- ── WHY THE LABELS ARE DENORMALISED ──────────────────────────────────────
    -- Both FKs are ON DELETE SET NULL, so after a purge the row would otherwise
    -- read "someone did something to someone". These snapshots are written at
    -- the moment of the action and are never updated, which also makes them
    -- correct in a second way a JOIN is not: they record the name the person
    -- had WHEN IT HAPPENED, not the name they have now.
    actor_label   VARCHAR(160) NOT NULL,
    target_label  VARCHAR(160) NOT NULL DEFAULT '',

    summary       TEXT        NOT NULL,

    -- Action-specific detail (old/new status, duties changed, force-reset
    -- flag). JSONB rather than columns because the shape differs per action and
    -- a wide table of mostly-NULL columns is worse than a document — and worse
    -- than JSONB, which is indexable.
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,

    ip_address    INET,
    user_agent    TEXT,

    CONSTRAINT fk_audit_actor
        FOREIGN KEY (actor_user_id) REFERENCES security_users (user_id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_target
        FOREIGN KEY (target_user_id) REFERENCES security_users (user_id) ON DELETE SET NULL,

    CONSTRAINT audit_logs_summary_not_blank CHECK (length(trim(summary)) > 0)
);

-- The console's default query: one category, newest first.
CREATE INDEX IF NOT EXISTS idx_audit_category_time
    ON provisioning_logs (category, occurred_at DESC);

-- "Everything that ever happened to this account", the per-officer history.
CREATE INDEX IF NOT EXISTS idx_audit_target_time
    ON provisioning_logs (target_user_id, occurred_at DESC) WHERE target_user_id IS NOT NULL;

-- "Everything this administrator did", the after-the-fact review.
CREATE INDEX IF NOT EXISTS idx_audit_actor_time
    ON provisioning_logs (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;

-- Containment queries into the detail blob, e.g. metadata @> '{"to":"revoked"}'.
-- jsonb_path_ops rather than the default: roughly a third of the size, and it
-- supports @> which is the only operator this column is queried with.
CREATE INDEX IF NOT EXISTS idx_audit_metadata
    ON provisioning_logs USING GIN (metadata jsonb_path_ops);


-- ── APPEND-ONLY ENFORCEMENT ──────────────────────────────────────────────────
--
--  An audit trail its own subject can edit is not an audit trail. Two layers,
--  because each covers what the other does not:
--
--    1. The trigger below refuses UPDATE and DELETE for EVERY role, including
--       the table owner and anyone who acquires it later. Privileges can be
--       granted; this cannot be granted around.
--    2. The REVOKE at the bottom stops the application role from even
--       attempting one, so a bug surfaces as a permission error at the call
--       site rather than as a trigger exception mid-transaction.
--
--  Neither stops a superuser with ALTER TABLE, and nothing in-database can.
--  Off-box shipping of this table is what covers that, and it is out of scope
--  for a schema file — it is named here so its absence is a decision rather
--  than an oversight.

CREATE OR REPLACE FUNCTION audit_logs_deny_mutation() RETURNS TRIGGER AS $$
BEGIN
    -- OLD, not NEW. Both UPDATE and DELETE assign OLD; a DELETE trigger leaves
    -- NEW unassigned, and touching a field on it raises "record 'new' is not
    -- assigned yet" — which would report a plpgsql fault instead of the refusal
    -- this function exists to state.
    RAISE EXCEPTION
        'provisioning_logs is append-only: % is not permitted (log_id %)',
        TG_OP, OLD.log_id
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON provisioning_logs;
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON provisioning_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_deny_mutation();


-- =============================================================================
--  AUTOMATIC updated_at
-- =============================================================================
--
--  A trigger rather than a DEFAULT, because a default only fires on INSERT and
--  the column's whole purpose is to move on UPDATE. Doing it in the application
--  instead means every write path has to remember — and the one that forgets is
--  found months later, when a row that has obviously changed still claims not
--  to have.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'security_roles', 'security_shifts', 'security_posts', 'security_users'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s', t);
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END LOOP;
END $$;


-- =============================================================================
--  VIEWS
-- =============================================================================

-- The directory table's query, as one object. The screen needs the officer plus
-- the display name of four related rows plus an aggregated duty list; expressing
-- that as a view keeps the five-way join out of the application and means the
-- column list the UI depends on is a schema artefact that a migration can see.
CREATE OR REPLACE VIEW v_security_roster AS
SELECT
    u.user_id,
    u.public_id,
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
    r.display_name  AS role_name,
    s.shift_key,
    s.display_name  AS shift_name,
    s.starts_at     AS shift_starts_at,
    s.ends_at       AS shift_ends_at,
    p.post_key,
    p.display_name  AS post_name,

    -- COALESCE to an empty array, not NULL: a caller that iterates the result
    -- should not have to special-case an officer with no duties.
    COALESCE(
        (SELECT array_agg(d.duty_key ORDER BY d.duty_key)
           FROM security_user_duties ud
           JOIN security_duties d ON d.duty_id = ud.duty_id
          WHERE ud.user_id = u.user_id),
        ARRAY[]::VARCHAR[]
    ) AS duties,

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

-- Effective permissions per account, for the authorisation check. A single
-- indexed lookup on (email/public_id, permission_key) replaces a role list
-- hard-coded into each service.
CREATE OR REPLACE VIEW v_security_effective_permissions AS
SELECT
    u.user_id,
    u.public_id,
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
--  ON CONFLICT DO NOTHING throughout, so re-running the file is safe and an
--  operator's edits to display names survive it.

INSERT INTO security_roles (role_key, display_name, description, rank, is_provisionable) VALUES
    ('super_admin',      'Super Admin',      'Full administrative control, including provisioning.', 100, FALSE),
    ('hoa_admin',        'HOA Admin',        'Estate administration; reads the security roster.',     80, FALSE),
    ('security_head',    'Security Head',    'Guardhouse portal, plus oversight of the officer roster.', 60, TRUE),
    ('security_officer', 'Security Officer', 'Guardhouse portal: files reports, responds to alerts.', 40, TRUE)
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO security_permissions (permission_key, description) VALUES
    ('incident.read',      'View incident tickets.'),
    ('incident.file',      'File an officer report.'),
    ('incident.dispatch',  'Mark an incident dispatched or resolved.'),
    ('panic.read',         'See panic alerts.'),
    ('panic.acknowledge',  'Acknowledge a panic alert and dispatch a responder.'),
    ('shift.clock',        'Clock in and out of a shift.'),
    ('roster.read',        'View the security roster.'),
    ('roster.manage',      'Re-assign posts, shifts and duties.'),
    ('account.provision',  'Create security accounts and issue credentials.'),
    ('account.status',     'Suspend, revoke or reactivate an account.'),
    ('audit.read',         'Read the provisioning audit trail.')
ON CONFLICT (permission_key) DO NOTHING;

-- The grants themselves. Written as a set expression rather than a list of
-- id pairs so it stays readable and cannot go stale against the identity
-- sequence.
INSERT INTO security_role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
  FROM security_roles r
  JOIN security_permissions p ON TRUE
 WHERE (r.role_key = 'security_officer' AND p.permission_key IN (
          'incident.read', 'incident.file', 'panic.read', 'panic.acknowledge', 'shift.clock'))
    OR (r.role_key = 'security_head' AND p.permission_key IN (
          'incident.read', 'incident.file', 'incident.dispatch', 'panic.read',
          'panic.acknowledge', 'shift.clock', 'roster.read', 'roster.manage'))
    OR (r.role_key = 'hoa_admin' AND p.permission_key IN (
          'incident.read', 'incident.dispatch', 'panic.read', 'panic.acknowledge',
          'roster.read', 'audit.read'))
    -- Super admin holds everything, by definition rather than by enumeration:
    -- a permission added later is granted to it automatically on the next run.
    OR r.role_key = 'super_admin'
ON CONFLICT DO NOTHING;

INSERT INTO security_shifts (shift_key, display_name, starts_at, ends_at) VALUES
    ('morning',   'Morning Shift',   TIME '06:00', TIME '14:00'),
    ('evening',   'Evening Shift',   TIME '14:00', TIME '22:00'),
    ('night',     'Night Shift',     TIME '22:00', TIME '06:00')
ON CONFLICT (shift_key) DO NOTHING;

INSERT INTO security_posts (post_key, display_name, description) VALUES
    ('main_gate',     'Main Gate',            'Primary vehicle and visitor entry.'),
    ('secondary_gate','Secondary Gate',       'Secondary entry, residents only.'),
    ('clubhouse',     'Clubhouse',            'Amenity area and function hall.'),
    ('perimeter_patrol','Perimeter Patrol',   'Roving circuit of the boundary wall.')
ON CONFLICT (post_key) DO NOTHING;

INSERT INTO security_duties (duty_key, display_name, description) VALUES
    ('gate_guard',      'Gate Guard',      'Mans a fixed entry post — visitor logging and vehicle checks.'),
    ('roving_patrol',   'Roving Patrol',   'Walks or drives the perimeter and interior roads on a circuit.'),
    ('lead_dispatcher', 'Lead Dispatcher', 'Owns the radio and triages panic alerts to responders.'),
    ('supervisor',      'Supervisor',      'Oversees the officer roster and approves shift changes.')
ON CONFLICT (duty_key) DO NOTHING;


-- =============================================================================
--  PRIVILEGES
-- =============================================================================
--
--  The application connects as `monticello_app` and is deliberately not the
--  table owner: an application role that can ALTER its own tables can drop the
--  audit trigger. Create the role out of band, then run this block.
--
--  Commented out because a role that does not exist makes the whole file fail,
--  and this schema has to be runnable against an empty database to be useful.

-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON
--     security_users, security_user_duties, security_shift_assignments
--     TO monticello_app;
-- GRANT SELECT ON
--     security_roles, security_permissions, security_role_permissions,
--     security_shifts, security_posts, security_duties,
--     v_security_roster, v_security_effective_permissions
--     TO monticello_app;
-- -- INSERT only. The trigger refuses the other two for every role; this makes
-- -- the attempt fail at the call site instead of inside a transaction.
-- GRANT INSERT, SELECT ON provisioning_logs TO monticello_app;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO monticello_app;

COMMIT;
