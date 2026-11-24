-- =============================================================================
--  Monticello Villas — Resident Accounts & Authentication Schema (PostgreSQL 14+)
-- =============================================================================
--
--  The relational model of resident registration, HOA verification, the
--  HOA ID / proof-of-residency documents, and the password-reset OTP flow.
--  Companion to schema.postgres.sql (security personnel); the two share no
--  tables and can be applied in either order.
--
--  Apply with:   psql -d monticello -v ON_ERROR_STOP=1 -f schema.auth.postgres.sql
--  Idempotent:   every object is CREATE ... IF NOT EXISTS, CREATE OR REPLACE,
--                or guarded by DO $$.
--
--  ── WHAT RUNS TODAY ─────────────────────────────────────────────────────────
--  The application runs on Firebase. This file is the specification those
--  collections are held to, and the target a migration would load into:
--
--    this table              Firebase today
--    ──────────────────────  ─────────────────────────────────────────────────
--    subdivision_lots        SubdivisionDirectory (lib/features/property/data)
--    residents               residents/{uid}
--    resident_properties     properties/{uid}  (+ phase/block/lot on residents)
--    verification_documents  Storage verification_ids/{uid}/* + residents.documentUrls
--    password_resets         password_reset_otps/{email}   (functions/index.js)
--
--  Firebase Auth keeps owning the CREDENTIAL. There is no password column for a
--  resident here: `firebase_uid` is the join key, exactly as
--  security_users.external_uid is in the personnel schema.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()


-- =============================================================================
--  ENUMERATED TYPES
-- =============================================================================
--  The wire values the app already stores, verbatim. They are compared as
--  strings in Dart (ResidentStatus, ResidentType) and in the portal
--  (RESIDENT_STATUS), so renaming one here is a three-codebase change.

DO $$ BEGIN
  CREATE TYPE resident_verification_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE resident_type AS ENUM ('homeowner', 'tenant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- 'self_heal' is AccountApprovalService.ensureRecordExists(): a record
  -- created at the verification gate because sign-up's own write was lost.
  CREATE TYPE registration_source AS ENUM ('email_password', 'google', 'self_heal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
--  subdivision_lots — every address the estate actually has
-- =============================================================================
--  1,444 rows: Phases 1, 2, 3 and 5 from the MV1-MV5 site plans, gaps
--  included. There is no Phase 4 and no Phase 1 Block 1; Phase 1 Block 3
--  starts at Lot 25; Phase 2 Block 11 is 46 lots spread over 1-56.
--
--  A row per lot, not a (first, last) range per block, so a resident's claim is
--  a FOREIGN KEY and an address that is open space or a road cannot be stored
--  at all. Seeded at the bottom of this file.

CREATE TABLE IF NOT EXISTS subdivision_lots (
    phase   VARCHAR(2)  NOT NULL,
    block   SMALLINT    NOT NULL CHECK (block > 0),
    lot     SMALLINT    NOT NULL CHECK (lot > 0),
    PRIMARY KEY (phase, block, lot)
);


-- =============================================================================
--  residents — one row per registered resident account
-- =============================================================================

CREATE TABLE IF NOT EXISTS residents (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid         VARCHAR(128)  NOT NULL UNIQUE,
    -- Stored as entered; uniqueness is on the lower-cased form (index below),
    -- the same normalisation the OTP function applies.
    email                VARCHAR(254)  NOT NULL CHECK (position('@' IN email) > 1),
    full_name            VARCHAR(120)  NOT NULL CHECK (length(btrim(full_name)) >= 2),
    phone                VARCHAR(32),
    resident_type        resident_type NOT NULL DEFAULT 'homeowner',

    verification_status  resident_verification_status NOT NULL DEFAULT 'pending',
    -- The "verified resident" flag, derived rather than stored twice. A separate
    -- boolean beside the status is two columns that can disagree; this cannot.
    is_verified          BOOLEAN GENERATED ALWAYS AS (verification_status = 'verified') STORED,
    rejection_reason     TEXT,
    reviewed_by_uid      VARCHAR(128),   -- staff Firebase uid (staff_accounts)
    reviewed_at          TIMESTAMPTZ,

    source               registration_source NOT NULL DEFAULT 'email_password',
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- A decision has a time. Not also a decider: records verified before the
    -- portal stamped `reviewedBy` exist, and a migration must be able to load
    -- them rather than invent a reviewer.
    CONSTRAINT residents_review_dated CHECK (
        verification_status = 'pending' OR reviewed_at IS NOT NULL
    ),
    -- The portal requires a reason to reject, so the resident is told why.
    CONSTRAINT residents_rejection_has_reason CHECK (
        verification_status <> 'rejected'
        OR length(btrim(coalesce(rejection_reason, ''))) > 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS residents_email_lower_uq ON residents (lower(email));
-- The admin Pending queue: oldest application first.
CREATE INDEX IF NOT EXISTS residents_pending_queue_idx
    ON residents (created_at) WHERE verification_status = 'pending';


-- =============================================================================
--  resident_properties — the address a resident claims
-- =============================================================================
--  One per resident (properties/{uid} is one document). NOT unique per lot: an
--  owner and a tenant, or two adults of one household, can each hold an
--  account on the same lot.

CREATE TABLE IF NOT EXISTS resident_properties (
    resident_id  UUID         PRIMARY KEY REFERENCES residents (id) ON DELETE CASCADE,
    phase        VARCHAR(2)   NOT NULL,
    block        SMALLINT     NOT NULL,
    lot          SMALLINT     NOT NULL,
    claimed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    FOREIGN KEY (phase, block, lot) REFERENCES subdivision_lots (phase, block, lot)
);

CREATE INDEX IF NOT EXISTS resident_properties_lot_idx
    ON resident_properties (phase, block, lot);


-- =============================================================================
--  verification_documents — HOA ID / proof of residency
-- =============================================================================
--  Mandatory at registration since 2026-10-16. The constraints are the same
--  ones storage.rules and VerificationIdRules enforce: an image or a PDF,
--  strictly under 10 MB.

CREATE TABLE IF NOT EXISTS verification_documents (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id    UUID          NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
    -- verification_ids/{uid}/id_<ms>.<ext> — the object, not the URL. A
    -- download URL embeds a revocable token; the path is the identity.
    storage_path   VARCHAR(512)  NOT NULL UNIQUE,
    download_url   TEXT          NOT NULL,
    content_type   VARCHAR(64)   NOT NULL CHECK (content_type IN (
                       'image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    byte_size      INTEGER       NOT NULL CHECK (byte_size > 0 AND byte_size < 10485760),
    original_name  VARCHAR(255),
    uploaded_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_documents_resident_idx
    ON verification_documents (resident_id, uploaded_at DESC);


-- =============================================================================
--  password_resets — the OTP reset flow
-- =============================================================================
--
--  ── THE CODE IS NEVER STORED ────────────────────────────────────────────────
--  `otp_hash` is sha256(otp_salt || ':' || code) in hex, computed in the
--  APPLICATION (functions/index.js#hashOtp). There is no otp_code column on
--  purpose: a table of live plaintext codes is a table of live passwords, and
--  hashing inside SQL would put the plaintext in the statement log. The salt
--  is per code, so equal codes do not produce equal hashes.
--
--  ── ROW PER ISSUE, ONE LIVE ROW PER EMAIL ───────────────────────────────────
--  Firestore keeps one document per address and overwrites it on resend. Here
--  every issue is a row — a history, which is what an abuse review needs — and
--  a partial unique index allows only ONE unused, unrevoked row per address.
--  issue_password_reset() below revokes the previous live code and inserts the
--  new one in a single statement pair, so the invariant holds under races.
--
--  ── ATTEMPTS ARE BUDGETED PER ADDRESS, NOT PER CODE ─────────────────────────
--  Five wrong guesses per 30-minute window across ALL codes issued to an
--  address. Resetting the count on every resend made the cap meaningless
--  once; password_reset_attempts_in_window() is the budget check.

CREATE TABLE IF NOT EXISTS password_resets (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Firebase Auth uid. Not an FK to residents: staff reset passwords through
    -- the same flow and have no resident row.
    user_id      VARCHAR(128)  NOT NULL,
    email        VARCHAR(254)  NOT NULL CHECK (email = lower(btrim(email))),
    otp_hash     CHAR(64)      NOT NULL CHECK (otp_hash ~ '^[0-9a-f]{64}$'),
    otp_salt     CHAR(32)      NOT NULL CHECK (otp_salt ~ '^[0-9a-f]{32}$'),
    expires_at   TIMESTAMPTZ   NOT NULL,
    is_used      BOOLEAN       NOT NULL DEFAULT FALSE,
    used_at      TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,   -- superseded by a newer code
    attempts     SMALLINT      NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ip_address   INET,          -- caller at issue, for abuse review only
    used_ip      INET,          -- caller at verification

    -- functions/index.js OTP_TTL_MINUTES = 10. A longer-lived row is a bug.
    CONSTRAINT password_resets_ttl CHECK (
        expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
    -- `is_used` and `used_at` are one fact; neither may exist without the other.
    CONSTRAINT password_resets_used_consistent CHECK (is_used = (used_at IS NOT NULL)),
    CONSTRAINT password_resets_used_once CHECK (NOT (is_used AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS password_resets_one_live_per_email
    ON password_resets (email) WHERE NOT is_used AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS password_resets_email_recent_idx
    ON password_resets (email, created_at DESC);
CREATE INDEX IF NOT EXISTS password_resets_purge_idx ON password_resets (created_at);


-- Issue a code: revoke the address's live code, insert the new one. The caller
-- generates the code, salt and hash; this never sees the plaintext.
CREATE OR REPLACE FUNCTION issue_password_reset(
    p_user_id  VARCHAR,
    p_email    VARCHAR,
    p_hash     CHAR(64),
    p_salt     CHAR(32),
    p_ip       INET DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    UPDATE password_resets
       SET revoked_at = now()
     WHERE email = lower(btrim(p_email)) AND NOT is_used AND revoked_at IS NULL;

    INSERT INTO password_resets (user_id, email, otp_hash, otp_salt, expires_at, ip_address)
    VALUES (p_user_id, lower(btrim(p_email)), p_hash, p_salt,
            now() + interval '10 minutes', p_ip)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Wrong guesses spent by an address in the current 30-minute window. Verify
-- refuses at 5, before comparing hashes.
CREATE OR REPLACE FUNCTION password_reset_attempts_in_window(p_email VARCHAR)
RETURNS INTEGER AS $$
    SELECT coalesce(sum(attempts), 0)::INTEGER
      FROM password_resets
     WHERE email = lower(btrim(p_email))
       AND created_at > now() - interval '30 minutes';
$$ LANGUAGE sql STABLE;

-- Retention: a day past issue, matching the Firestore TTL on `purgeAt`. Long
-- enough to outlive the attempt window (deleting a row early would refund its
-- guesses), short enough that caller IPs are not kept indefinitely.
CREATE OR REPLACE FUNCTION purge_password_resets() RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM password_resets WHERE created_at < now() - interval '24 hours';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
--  AUTOMATIC updated_at
-- =============================================================================
--  Same function and reasoning as schema.postgres.sql; redefined here so this
--  file applies on its own.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_residents_updated_at ON residents;
CREATE TRIGGER trg_residents_updated_at BEFORE UPDATE ON residents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
--  VIEWS
-- =============================================================================
--  The admin Resident Review drawer: the record, the claimed address and the
--  documents, as one row per resident.

CREATE OR REPLACE VIEW v_resident_review AS
SELECT
    r.id,
    r.firebase_uid,
    r.full_name,
    r.email,
    r.phone,
    r.resident_type,
    r.verification_status,
    r.is_verified,
    r.rejection_reason,
    r.reviewed_at,
    r.created_at,
    p.phase,
    p.block,
    p.lot,
    coalesce(
        array_agg(d.download_url ORDER BY d.uploaded_at) FILTER (WHERE d.id IS NOT NULL),
        '{}'
    ) AS document_urls
FROM residents r
LEFT JOIN resident_properties p   ON p.resident_id = r.id
LEFT JOIN verification_documents d ON d.resident_id = r.id
GROUP BY r.id, p.phase, p.block, p.lot;


-- =============================================================================
--  SEED: subdivision_lots
-- =============================================================================
--  The site-plan schedule as unbroken runs (phase, block, first, last),
--  expanded to one row per lot. Generated from db/exports/subdivision-lots-flat.json,
--  which is generated from SubdivisionDirectory — so the three agree. 116 runs,
--  1,444 lots.

INSERT INTO subdivision_lots (phase, block, lot)
SELECT r.phase, r.block, g.lot
FROM (VALUES
    ('1', 2, 1, 66),
    ('1', 3, 25, 60),
    ('1', 4, 1, 50),
    ('1', 5, 1, 39),
    ('1', 6, 1, 35),
    ('1', 7, 1, 33),
    ('1', 8, 1, 30),
    ('1', 9, 1, 30),
    ('1', 10, 1, 32),
    ('1', 11, 1, 32),
    ('1', 12, 1, 34),
    ('1', 13, 1, 40),
    ('2', 1, 1, 3),
    ('2', 1, 5, 30),
    ('2', 2, 1, 28),
    ('2', 3, 1, 1),
    ('2', 3, 3, 28),
    ('2', 4, 1, 4),
    ('2', 4, 6, 28),
    ('2', 5, 1, 28),
    ('2', 6, 1, 3),
    ('2', 6, 5, 6),
    ('2', 6, 8, 16),
    ('2', 6, 18, 35),
    ('2', 6, 37, 38),
    ('2', 7, 1, 38),
    ('2', 8, 1, 2),
    ('2', 8, 4, 9),
    ('2', 8, 11, 13),
    ('2', 8, 15, 16),
    ('2', 8, 18, 27),
    ('2', 8, 29, 30),
    ('2', 8, 32, 36),
    ('2', 9, 1, 9),
    ('2', 9, 11, 23),
    ('2', 9, 25, 27),
    ('2', 9, 29, 36),
    ('2', 10, 1, 28),
    ('2', 10, 30, 32),
    ('2', 10, 34, 44),
    ('2', 11, 1, 1),
    ('2', 11, 4, 7),
    ('2', 11, 10, 11),
    ('2', 11, 13, 19),
    ('2', 11, 21, 25),
    ('2', 11, 27, 28),
    ('2', 11, 30, 44),
    ('2', 11, 46, 50),
    ('2', 11, 52, 56),
    ('2', 12, 1, 7),
    ('2', 12, 9, 20),
    ('2', 13, 1, 2),
    ('2', 13, 4, 24),
    ('2', 13, 26, 30),
    ('2', 14, 1, 11),
    ('2', 14, 15, 15),
    ('2', 14, 17, 19),
    ('2', 14, 21, 21),
    ('2', 14, 23, 28),
    ('2', 15, 1, 3),
    ('2', 15, 5, 7),
    ('2', 15, 9, 16),
    ('2', 15, 18, 25),
    ('2', 16, 1, 5),
    ('2', 16, 7, 14),
    ('2', 16, 16, 22),
    ('2', 17, 1, 4),
    ('2', 17, 6, 12),
    ('2', 17, 14, 14),
    ('2', 17, 16, 16),
    ('2', 17, 19, 20),
    ('2', 18, 2, 5),
    ('2', 18, 7, 9),
    ('2', 18, 11, 13),
    ('2', 18, 17, 20),
    ('2', 19, 1, 2),
    ('2', 19, 4, 11),
    ('2', 19, 13, 18),
    ('2', 20, 1, 23),
    ('3', 1, 1, 3),
    ('3', 1, 5, 9),
    ('3', 1, 11, 38),
    ('3', 1, 40, 111),
    ('3', 2, 1, 26),
    ('3', 2, 28, 58),
    ('3', 3, 1, 18),
    ('3', 4, 1, 6),
    ('3', 4, 8, 13),
    ('3', 5, 1, 40),
    ('3', 6, 1, 24),
    ('3', 7, 1, 24),
    ('3', 8, 1, 7),
    ('3', 8, 9, 19),
    ('3', 8, 21, 24),
    ('3', 9, 1, 24),
    ('3', 10, 1, 1),
    ('3', 10, 3, 12),
    ('5', 1, 1, 10),
    ('5', 1, 12, 15),
    ('5', 1, 17, 19),
    ('5', 1, 21, 25),
    ('5', 1, 27, 29),
    ('5', 1, 31, 40),
    ('5', 1, 42, 63),
    ('5', 1, 65, 67),
    ('5', 2, 1, 6),
    ('5', 2, 8, 12),
    ('5', 3, 1, 1),
    ('5', 3, 3, 10),
    ('5', 3, 12, 12),
    ('5', 4, 1, 3),
    ('5', 4, 5, 5),
    ('5', 4, 7, 13),
    ('5', 4, 15, 15),
    ('5', 5, 1, 9),
    ('5', 5, 11, 14)
) AS r (phase, block, first_lot, last_lot)
CROSS JOIN LATERAL generate_series(r.first_lot, r.last_lot) AS g (lot)
ON CONFLICT DO NOTHING;

COMMIT;
