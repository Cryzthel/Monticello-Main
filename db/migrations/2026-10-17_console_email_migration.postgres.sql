-- ════════════════════════════════════════════════════════════════════════════
--  Console sign-in emails: test addresses -> production addresses
--  PostgreSQL 14+, against schema.postgres.sql + schema.auth.postgres.sql
-- ════════════════════════════════════════════════════════════════════════════
--
--  The LIVE system is Firebase Auth + Firestore, and is migrated by
--  functions/scripts/migrateStaffEmails.cjs. This file is the same change for
--  the relational model in this folder, for a deployment that runs it — see
--  db/README.md, "which database is actually running".
--
--  Admin     monticellovillas@gmail.com      -> adminmonticellov@gmail.com
--  Guard     guard.test@monticellovillas.ph  -> riversantos940@gmail.com
--
--  ── WHAT IS TOUCHED ─────────────────────────────────────────────────────────
--  security_users.email     the only identity row that carries a sign-in email.
--                           user_id, public_id, external_uid, password_hash and
--                           role_id are not in any SET list below, so ids,
--                           credentials and permissions cannot move.
--  password_resets          live codes for the OLD address are revoked, not
--                           re-addressed: they were mailed to an inbox that is
--                           no longer the account's.
--  provisioning_logs        one INSERT per account. Existing rows are never
--                           updated (the immutability trigger would refuse it,
--                           and they correctly name the address of the time).
--
--  Role assignment is security_users.role_id -> security_roles, keyed by id;
--  security_role_permissions is keyed by role. Neither stores an email, so
--  neither needs an UPDATE.
--
--  ── SAFETY ──────────────────────────────────────────────────────────────────
--  One transaction. The new address must not already be held by a DIFFERENT
--  live row; if it is, the block raises and nothing is written. Re-running
--  after success is a no-op: the WHERE clauses match the old address only.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE console_email_moves (
    console    TEXT         NOT NULL,
    old_email  VARCHAR(254) NOT NULL,
    new_email  VARCHAR(254) NOT NULL
) ON COMMIT DROP;

INSERT INTO console_email_moves (console, old_email, new_email) VALUES
    ('Admin',      'monticellovillas@gmail.com',     'adminmonticellov@gmail.com'),
    ('Guardhouse', 'guard.test@monticellovillas.ph', 'riversantos940@gmail.com');

-- Refuse a collision before writing anything: a live row still on the old
-- address, and a DIFFERENT live row already on the new one. A new address held
-- with nothing left on the old is a completed earlier run, not a clash.
DO $$
DECLARE
    clash RECORD;
BEGIN
    SELECT m.new_email, u.user_id INTO clash
      FROM console_email_moves m
      JOIN security_users o
        ON o.email = m.old_email
       AND o.deleted_at IS NULL
      JOIN security_users u
        ON u.email = m.new_email
       AND u.deleted_at IS NULL
       AND u.user_id <> o.user_id
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION '% is already the sign-in email of user_id %; resolve by hand',
            clash.new_email, clash.user_id;
    END IF;
END $$;

-- Audit first, while the old address still identifies the row.
INSERT INTO provisioning_logs
    (category, action, actor_user_id, target_user_id, actor_label, target_label, summary, metadata)
SELECT 'security',
       'security.account.email_changed',
       NULL,
       u.user_id,
       'Migration script',
       u.full_name,
       format('Changed the %s sign-in email from %s to %s', m.console, m.old_email, m.new_email),
       jsonb_build_object('from', m.old_email, 'to', m.new_email)
  FROM console_email_moves m
  JOIN security_users u ON u.email = m.old_email AND u.deleted_at IS NULL;

UPDATE security_users u
   SET email = m.new_email          -- updated_at is set by trg_*_updated_at
  FROM console_email_moves m
 WHERE u.email = m.old_email
   AND u.deleted_at IS NULL;

UPDATE password_resets r
   SET revoked_at = now()
  FROM console_email_moves m
 WHERE r.email = m.old_email
   AND NOT r.is_used
   AND r.revoked_at IS NULL;

-- Expect two rows, each on its new address.
SELECT m.console, u.user_id, u.email, u.role_id
  FROM console_email_moves m
  LEFT JOIN security_users u ON u.email = m.new_email AND u.deleted_at IS NULL;

COMMIT;
