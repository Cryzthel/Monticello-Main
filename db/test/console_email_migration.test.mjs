// Runs db/migrations/2026-10-17_console_email_migration.postgres.sql in PGlite
// against both schemas, and checks it moves ONLY the email.
//
//   cd db/test && npm install --no-save @electric-sql/pglite@0.2.17
//   node console_email_migration.test.mjs
//
// There is no equivalent for the MySQL file: no MySQL engine runs in-process.

import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const load = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  // PGlite ships without pgcrypto (gen_random_uuid is core anyway) and
  // without pg_trgm, which only backs a search index irrelevant here.
  .replace(/^CREATE EXTENSION.*$/gm, '')

const securitySql = load('../schema.postgres.sql')
  .replace(/CREATE INDEX[^;]*gin_trgm_ops[^;]*;/gs, '')
const authSql = load('../schema.auth.postgres.sql')
const migration = load('../migrations/2026-10-17_console_email_migration.postgres.sql')

const db = new PGlite()
let failures = 0
const ok = (name) => console.log('PASS', name)
const bad = (name, e) => { failures++; console.log('FAIL', name, e ?? '') }
const one = async (q, p) => (await db.query(q, p)).rows[0]

await db.exec(securitySql)
await db.exec(authSql)

const roleId = async (key) => (await one('SELECT role_id FROM security_roles WHERE role_key=$1', [key])).role_id
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$' + 'a'.repeat(22) + '$' + 'b'.repeat(43)

async function addUser(name, email, badge, role, uid) {
  return (await one(
    `INSERT INTO security_users (external_uid, full_name, email, badge_number, role_id, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING user_id, public_id, password_hash, role_id`,
    [uid, name, email, badge, await roleId(role), HASH],
  ))
}

const admin = await addUser('Office Admin', 'monticellovillas@gmail.com', 'SG-01', 'super_admin', 'uid-admin')
const guard = await addUser('Duty Guard', 'guard.test@monticellovillas.ph', 'SG-04', 'security_officer', 'uid-guard')
const bystander = await addUser('Other Officer', 'other@monticellovillas.ph', 'SG-07', 'security_officer', 'uid-other')

await db.query(
  `INSERT INTO password_resets (user_id, email, otp_hash, otp_salt, expires_at)
   VALUES ('uid-guard','guard.test@monticellovillas.ph',$1,$2, now() + interval '5 minutes')`,
  ['c'.repeat(64), 'd'.repeat(32)],
)

await db.exec(migration)
ok('applies')

for (const [label, before, email] of [
  ['admin', admin, 'adminmonticellov@gmail.com'],
  ['guard', guard, 'riversantos940@gmail.com'],
]) {
  const after = await one('SELECT * FROM security_users WHERE user_id=$1', [before.user_id])
  after.email === email ? ok(`${label} on new email`) : bad(`${label} email`, after.email)
  after.public_id === before.public_id && after.external_uid === `uid-${label}`
    ? ok(`${label} ids unchanged`) : bad(`${label} ids`)
  after.password_hash === before.password_hash ? ok(`${label} hash unchanged`) : bad(`${label} hash`)
  after.role_id === before.role_id ? ok(`${label} role unchanged`) : bad(`${label} role`)
}

const other = await one('SELECT email FROM security_users WHERE user_id=$1', [bystander.user_id])
other.email === 'other@monticellovillas.ph' ? ok('other accounts untouched') : bad('bystander', other.email)

const reset = await one(`SELECT revoked_at FROM password_resets WHERE email='guard.test@monticellovillas.ph'`)
reset.revoked_at ? ok('live code for the old address revoked') : bad('reset not revoked')

const logs = (await one(
  `SELECT count(*)::int AS n FROM provisioning_logs WHERE action='security.account.email_changed'`)).n
logs === 2 ? ok('one audit row per account') : bad('audit rows', logs)

await db.exec(migration)
const logsAgain = (await one(
  `SELECT count(*)::int AS n FROM provisioning_logs WHERE action='security.account.email_changed'`)).n
logsAgain === 2 ? ok('re-run is a no-op') : bad('re-run wrote again', logsAgain)

// A collision must abort the whole transaction.
await db.exec(`UPDATE security_users SET email='monticellovillas@gmail.com' WHERE user_id=${admin.user_id}`)
await db.exec(`UPDATE security_users SET email='adminmonticellov@gmail.com' WHERE user_id=${bystander.user_id}`)
try {
  await db.exec(migration)
  bad('collision refused', 'no error')
} catch {
  await db.exec('ROLLBACK').catch(() => {})
  const still = await one('SELECT email FROM security_users WHERE user_id=$1', [admin.user_id])
  still.email === 'monticellovillas@gmail.com' ? ok('collision refused, nothing written') : bad('partial write', still.email)
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
