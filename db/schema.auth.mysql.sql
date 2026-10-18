-- =============================================================================
--  Monticello Villas — Resident Accounts & Authentication Schema (MySQL 8.0.19+)
-- =============================================================================
--
--  The MySQL rendering of schema.auth.postgres.sql. Same tables, same
--  invariants; where MySQL cannot say something the PostgreSQL file says
--  directly, the workaround is named beside it. Read the PostgreSQL file for
--  the reasoning behind each table — it is not repeated here.
--
--  Apply with:   mysql monticello < schema.auth.mysql.sql
--  Idempotent:   CREATE TABLE IF NOT EXISTS, DROP ... IF EXISTS before each
--                routine, INSERT IGNORE for the seed.
--
--  8.0.19 is the floor. CHECK constraints are parsed and IGNORED before 8.0.16
--  — silently, which is worse than an error — and the lot seed's
--  `VALUES ROW(...)` table constructor arrived in 8.0.19.
--
--  Times are DATETIME(3) in UTC, for the reason given in schema.mysql.sql.
-- =============================================================================

SET NAMES utf8mb4;


-- =============================================================================
--  subdivision_lots
-- =============================================================================

CREATE TABLE IF NOT EXISTS subdivision_lots (
    phase   VARCHAR(2)         NOT NULL,
    block   SMALLINT UNSIGNED  NOT NULL CHECK (block > 0),
    lot     SMALLINT UNSIGNED  NOT NULL CHECK (lot > 0),
    PRIMARY KEY (phase, block, lot)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  residents
-- =============================================================================
--  ENUM columns rather than types: MySQL has no CREATE TYPE. The values are
--  the wire strings the app stores (ResidentStatus, ResidentType).

CREATE TABLE IF NOT EXISTS residents (
    id                   CHAR(36)      NOT NULL DEFAULT (uuid()),
    firebase_uid         VARCHAR(128)  NOT NULL,
    email                VARCHAR(254)  NOT NULL,
    -- A stored lower-case copy carries the uniqueness, since MySQL 8.0 cannot
    -- put a UNIQUE index on an expression the way PostgreSQL can.
    email_lower          VARCHAR(254)  GENERATED ALWAYS AS (lower(email)) STORED,
    full_name            VARCHAR(120)  NOT NULL,
    phone                VARCHAR(32)   NULL,
    resident_type        ENUM('homeowner', 'tenant') NOT NULL DEFAULT 'homeowner',

    verification_status  ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
    is_verified          BOOLEAN GENERATED ALWAYS AS (verification_status = 'verified') STORED,
    rejection_reason     TEXT          NULL,
    reviewed_by_uid      VARCHAR(128)  NULL,
    reviewed_at          DATETIME(3)   NULL,

    source               ENUM('email_password', 'google', 'self_heal') NOT NULL DEFAULT 'email_password',
    created_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    -- MySQL can do on-update in the column itself, so no trigger is needed.
    updated_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                       ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),
    UNIQUE KEY residents_firebase_uid_uq (firebase_uid),
    UNIQUE KEY residents_email_lower_uq (email_lower),
    KEY residents_status_created_idx (verification_status, created_at),

    CONSTRAINT residents_email_shape CHECK (locate('@', email) > 1),
    CONSTRAINT residents_name_present CHECK (char_length(trim(full_name)) >= 2),
    CONSTRAINT residents_review_dated CHECK (
        verification_status = 'pending' OR reviewed_at IS NOT NULL),
    CONSTRAINT residents_rejection_has_reason CHECK (
        verification_status <> 'rejected'
        OR char_length(trim(coalesce(rejection_reason, ''))) > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  resident_properties
-- =============================================================================

CREATE TABLE IF NOT EXISTS resident_properties (
    resident_id  CHAR(36)           NOT NULL,
    phase        VARCHAR(2)         NOT NULL,
    block        SMALLINT UNSIGNED  NOT NULL,
    lot          SMALLINT UNSIGNED  NOT NULL,
    claimed_at   DATETIME(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (resident_id),
    KEY resident_properties_lot_idx (phase, block, lot),
    CONSTRAINT resident_properties_resident_fk FOREIGN KEY (resident_id)
        REFERENCES residents (id) ON DELETE CASCADE,
    CONSTRAINT resident_properties_lot_fk FOREIGN KEY (phase, block, lot)
        REFERENCES subdivision_lots (phase, block, lot)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  verification_documents
-- =============================================================================

CREATE TABLE IF NOT EXISTS verification_documents (
    id             CHAR(36)       NOT NULL DEFAULT (uuid()),
    resident_id    CHAR(36)       NOT NULL,
    storage_path   VARCHAR(512)   NOT NULL,
    download_url   TEXT           NOT NULL,
    content_type   VARCHAR(64)    NOT NULL,
    byte_size      INT UNSIGNED   NOT NULL,
    original_name  VARCHAR(255)   NULL,
    uploaded_at    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY verification_documents_path_uq (storage_path),
    KEY verification_documents_resident_idx (resident_id, uploaded_at),
    CONSTRAINT verification_documents_resident_fk FOREIGN KEY (resident_id)
        REFERENCES residents (id) ON DELETE CASCADE,
    CONSTRAINT verification_documents_type CHECK (content_type IN (
        'image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    CONSTRAINT verification_documents_size CHECK (byte_size > 0 AND byte_size < 10485760)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  password_resets
-- =============================================================================
--  ── ONE LIVE ROW PER EMAIL, WITHOUT A PARTIAL INDEX ─────────────────────────
--  MySQL has no `CREATE UNIQUE INDEX ... WHERE`. `live_email` is the email
--  while the code is live and NULL once it is used or revoked; a UNIQUE index
--  ignores NULLs, so it permits any number of spent rows and one live one —
--  the same invariant as the PostgreSQL partial index.
--
--  IPs are VARBINARY(16) from INET6_ATON(), which stores v4 and v6 alike;
--  read them back with INET6_NTOA().

CREATE TABLE IF NOT EXISTS password_resets (
    id           CHAR(36)          NOT NULL DEFAULT (uuid()),
    user_id      VARCHAR(128)      NOT NULL,
    email        VARCHAR(254)      NOT NULL,
    otp_hash     CHAR(64)          NOT NULL,
    otp_salt     CHAR(32)          NOT NULL,
    expires_at   DATETIME(3)       NOT NULL,
    is_used      BOOLEAN           NOT NULL DEFAULT FALSE,
    used_at      DATETIME(3)       NULL,
    revoked_at   DATETIME(3)       NULL,
    attempts     TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    created_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ip_address   VARBINARY(16)     NULL,
    used_ip      VARBINARY(16)     NULL,
    live_email   VARCHAR(254) GENERATED ALWAYS AS (
                     IF(is_used = FALSE AND revoked_at IS NULL, email, NULL)) STORED,

    PRIMARY KEY (id),
    UNIQUE KEY password_resets_one_live_per_email (live_email),
    KEY password_resets_email_recent_idx (email, created_at),
    KEY password_resets_purge_idx (created_at),

    CONSTRAINT password_resets_email_normalised CHECK (email = lower(trim(email))),
    CONSTRAINT password_resets_hash_hex CHECK (regexp_like(otp_hash, '^[0-9a-f]{64}$', 'c')),
    CONSTRAINT password_resets_salt_hex CHECK (regexp_like(otp_salt, '^[0-9a-f]{32}$', 'c')),
    CONSTRAINT password_resets_attempts CHECK (attempts <= 5),
    CONSTRAINT password_resets_ttl CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL 10 MINUTE),
    CONSTRAINT password_resets_used_consistent CHECK (is_used = (used_at IS NOT NULL)),
    CONSTRAINT password_resets_used_once CHECK (NOT (is_used AND revoked_at IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- =============================================================================
--  ROUTINES
-- =============================================================================

DROP PROCEDURE IF EXISTS issue_password_reset;
DROP FUNCTION IF EXISTS password_reset_attempts_in_window;
DROP PROCEDURE IF EXISTS purge_password_resets;

DELIMITER //

-- Revoke the address's live code and insert the new one, atomically.
CREATE PROCEDURE issue_password_reset(
    IN  p_user_id  VARCHAR(128),
    IN  p_email    VARCHAR(254),
    IN  p_hash     CHAR(64),
    IN  p_salt     CHAR(32),
    IN  p_ip       VARCHAR(45),
    OUT p_id       CHAR(36)
)
BEGIN
    DECLARE v_email VARCHAR(254) DEFAULT lower(trim(p_email));
    DECLARE v_now   DATETIME(3)  DEFAULT UTC_TIMESTAMP(3);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    UPDATE password_resets
       SET revoked_at = v_now
     WHERE email = v_email AND is_used = FALSE AND revoked_at IS NULL;

    SET p_id = uuid();
    INSERT INTO password_resets
        (id, user_id, email, otp_hash, otp_salt, created_at, expires_at, ip_address)
    VALUES
        (p_id, p_user_id, v_email, p_hash, p_salt, v_now,
         v_now + INTERVAL 10 MINUTE, INET6_ATON(p_ip));
    COMMIT;
END //

CREATE FUNCTION password_reset_attempts_in_window(p_email VARCHAR(254))
RETURNS INT
READS SQL DATA
BEGIN
    RETURN (
        SELECT coalesce(sum(attempts), 0)
          FROM password_resets
         WHERE email = lower(trim(p_email))
           AND created_at > UTC_TIMESTAMP(3) - INTERVAL 30 MINUTE
    );
END //

CREATE PROCEDURE purge_password_resets()
BEGIN
    DELETE FROM password_resets WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 24 HOUR;
END //

DELIMITER ;


-- =============================================================================
--  VIEW: v_resident_review
-- =============================================================================

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
    (SELECT coalesce(json_arrayagg(d.download_url), json_array())
       FROM verification_documents d
      WHERE d.resident_id = r.id) AS document_urls
FROM residents r
LEFT JOIN resident_properties p ON p.resident_id = r.id;


-- =============================================================================
--  SEED: subdivision_lots
-- =============================================================================
--  The same 116 runs as the PostgreSQL file, expanded with a recursive CTE in
--  place of generate_series(). 1,444 lots.

SET SESSION cte_max_recursion_depth = 1000;

INSERT IGNORE INTO subdivision_lots (phase, block, lot)
WITH RECURSIVE
runs (phase, block, first_lot, last_lot) AS (
    SELECT * FROM (VALUES
        ROW('1', 2, 1, 66),
        ROW('1', 3, 25, 60),
        ROW('1', 4, 1, 50),
        ROW('1', 5, 1, 39),
        ROW('1', 6, 1, 35),
        ROW('1', 7, 1, 33),
        ROW('1', 8, 1, 30),
        ROW('1', 9, 1, 30),
        ROW('1', 10, 1, 32),
        ROW('1', 11, 1, 32),
        ROW('1', 12, 1, 34),
        ROW('1', 13, 1, 40),
        ROW('2', 1, 1, 3),
        ROW('2', 1, 5, 30),
        ROW('2', 2, 1, 28),
        ROW('2', 3, 1, 1),
        ROW('2', 3, 3, 28),
        ROW('2', 4, 1, 4),
        ROW('2', 4, 6, 28),
        ROW('2', 5, 1, 28),
        ROW('2', 6, 1, 3),
        ROW('2', 6, 5, 6),
        ROW('2', 6, 8, 16),
        ROW('2', 6, 18, 35),
        ROW('2', 6, 37, 38),
        ROW('2', 7, 1, 38),
        ROW('2', 8, 1, 2),
        ROW('2', 8, 4, 9),
        ROW('2', 8, 11, 13),
        ROW('2', 8, 15, 16),
        ROW('2', 8, 18, 27),
        ROW('2', 8, 29, 30),
        ROW('2', 8, 32, 36),
        ROW('2', 9, 1, 9),
        ROW('2', 9, 11, 23),
        ROW('2', 9, 25, 27),
        ROW('2', 9, 29, 36),
        ROW('2', 10, 1, 28),
        ROW('2', 10, 30, 32),
        ROW('2', 10, 34, 44),
        ROW('2', 11, 1, 1),
        ROW('2', 11, 4, 7),
        ROW('2', 11, 10, 11),
        ROW('2', 11, 13, 19),
        ROW('2', 11, 21, 25),
        ROW('2', 11, 27, 28),
        ROW('2', 11, 30, 44),
        ROW('2', 11, 46, 50),
        ROW('2', 11, 52, 56),
        ROW('2', 12, 1, 7),
        ROW('2', 12, 9, 20),
        ROW('2', 13, 1, 2),
        ROW('2', 13, 4, 24),
        ROW('2', 13, 26, 30),
        ROW('2', 14, 1, 11),
        ROW('2', 14, 15, 15),
        ROW('2', 14, 17, 19),
        ROW('2', 14, 21, 21),
        ROW('2', 14, 23, 28),
        ROW('2', 15, 1, 3),
        ROW('2', 15, 5, 7),
        ROW('2', 15, 9, 16),
        ROW('2', 15, 18, 25),
        ROW('2', 16, 1, 5),
        ROW('2', 16, 7, 14),
        ROW('2', 16, 16, 22),
        ROW('2', 17, 1, 4),
        ROW('2', 17, 6, 12),
        ROW('2', 17, 14, 14),
        ROW('2', 17, 16, 16),
        ROW('2', 17, 19, 20),
        ROW('2', 18, 2, 5),
        ROW('2', 18, 7, 9),
        ROW('2', 18, 11, 13),
        ROW('2', 18, 17, 20),
        ROW('2', 19, 1, 2),
        ROW('2', 19, 4, 11),
        ROW('2', 19, 13, 18),
        ROW('2', 20, 1, 23),
        ROW('3', 1, 1, 3),
        ROW('3', 1, 5, 9),
        ROW('3', 1, 11, 38),
        ROW('3', 1, 40, 111),
        ROW('3', 2, 1, 26),
        ROW('3', 2, 28, 58),
        ROW('3', 3, 1, 18),
        ROW('3', 4, 1, 6),
        ROW('3', 4, 8, 13),
        ROW('3', 5, 1, 40),
        ROW('3', 6, 1, 24),
        ROW('3', 7, 1, 24),
        ROW('3', 8, 1, 7),
        ROW('3', 8, 9, 19),
        ROW('3', 8, 21, 24),
        ROW('3', 9, 1, 24),
        ROW('3', 10, 1, 1),
        ROW('3', 10, 3, 12),
        ROW('5', 1, 1, 10),
        ROW('5', 1, 12, 15),
        ROW('5', 1, 17, 19),
        ROW('5', 1, 21, 25),
        ROW('5', 1, 27, 29),
        ROW('5', 1, 31, 40),
        ROW('5', 1, 42, 63),
        ROW('5', 1, 65, 67),
        ROW('5', 2, 1, 6),
        ROW('5', 2, 8, 12),
        ROW('5', 3, 1, 1),
        ROW('5', 3, 3, 10),
        ROW('5', 3, 12, 12),
        ROW('5', 4, 1, 3),
        ROW('5', 4, 5, 5),
        ROW('5', 4, 7, 13),
        ROW('5', 4, 15, 15),
        ROW('5', 5, 1, 9),
        ROW('5', 5, 11, 14)
    ) AS v
),
lots (phase, block, lot, last_lot) AS (
    SELECT phase, block, first_lot, last_lot FROM runs
    UNION ALL
    SELECT phase, block, lot + 1, last_lot FROM lots WHERE lot < last_lot
)
SELECT phase, block, lot FROM lots;
