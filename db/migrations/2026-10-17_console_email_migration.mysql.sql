-- ════════════════════════════════════════════════════════════════════════════
--  Console sign-in emails: test addresses -> production addresses
--  MySQL 8.0.16+, against schema.mysql.sql + schema.auth.mysql.sql
-- ════════════════════════════════════════════════════════════════════════════
--
--  Same change as 2026-10-17_console_email_migration.postgres.sql — read that
--  file's header for what is and is not touched, and why. The LIVE system is
--  Firebase; see functions/scripts/migrateStaffEmails.cjs.
--
--  ── THE COLLISION GUARD IS THE UNIQUE KEY ──────────────────────────────────
--  MySQL has no anonymous DO block, so there is no pre-check here. It does not
--  need one: uq_users_email_active rejects the UPDATE if the new address is a
--  different live row, and that error stops the script before COMMIT. Run it
--  with the client's stop-on-error behaviour (the default for `mysql < file`)
--  and ROLLBACK if it stops.
-- ════════════════════════════════════════════════════════════════════════════

START TRANSACTION;

CREATE TEMPORARY TABLE console_email_moves (
    console    VARCHAR(32)  NOT NULL,
    old_email  VARCHAR(254) NOT NULL,
    new_email  VARCHAR(254) NOT NULL
);

INSERT INTO console_email_moves (console, old_email, new_email) VALUES
    ('Admin',      'monticellovillas@gmail.com',     'adminmonticellov@gmail.com'),
    ('Guardhouse', 'guard.test@monticellovillas.ph', 'riversantos940@gmail.com');

-- Audit first, while the old address still identifies the row.
INSERT INTO provisioning_logs
    (category, action_key, actor_user_id, target_user_id, actor_label, target_label, summary, metadata)
SELECT 'security',
       'security.account.email_changed',
       NULL,
       u.user_id,
       'Migration script',
       u.full_name,
       CONCAT('Changed the ', m.console, ' sign-in email from ', m.old_email, ' to ', m.new_email),
       JSON_OBJECT('from', m.old_email, 'to', m.new_email)
  FROM console_email_moves m
  JOIN security_users u ON u.email = m.old_email AND u.deleted_at IS NULL;

UPDATE security_users u
  JOIN console_email_moves m ON u.email = m.old_email
   SET u.email = m.new_email
 WHERE u.deleted_at IS NULL;

UPDATE password_resets r
  JOIN console_email_moves m ON r.email = m.old_email
   SET r.revoked_at = CURRENT_TIMESTAMP(3)
 WHERE r.is_used = FALSE
   AND r.revoked_at IS NULL;

-- Expect two rows, each on its new address.
SELECT m.console, u.user_id, u.email, u.role_id
  FROM console_email_moves m
  LEFT JOIN security_users u ON u.email = m.new_email AND u.deleted_at IS NULL;

DROP TEMPORARY TABLE console_email_moves;

COMMIT;
