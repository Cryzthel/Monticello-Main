// Executes db/schema.auth.postgres.sql in PGlite (real PostgreSQL, compiled to
// WebAssembly) and checks every constraint the file claims to enforce.
//
//   cd db/test && npm install --no-save @electric-sql/pglite@0.2.17
//   node schema.auth.test.mjs ../schema.auth.postgres.sql
//
// There is no equivalent for the MySQL file: no MySQL engine runs in-process.

import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const path = process.argv[2]
// gen_random_uuid() is core since PG13; PGlite ships without the pgcrypto
// extension, so drop only that line for the test.
const sql = readFileSync(path, 'utf8').replace(/^CREATE EXTENSION.*$/m, '')

const db = new PGlite()
let failures = 0
const ok = (name) => console.log('PASS', name)
const bad = (name, e) => { failures++; console.log('FAIL', name, e ?? '') }

async function expectError(name, q, params) {
  try { await db.query(q, params); bad(name, 'no error') } catch { ok(name) }
}
async function expectOk(name, q, params) {
  try { return (await db.query(q, params)).rows } catch (e) { bad(name, e.message) }
}

await db.exec(sql)
ok('applies')
await db.exec(sql)
ok('re-applies (idempotent)')

const lots = (await db.query('SELECT count(*)::int AS n FROM subdivision_lots')).rows[0].n
lots === 1444 ? ok('1,444 lots') : bad('1,444 lots', lots)
const gap = (await db.query("SELECT count(*)::int AS n FROM subdivision_lots WHERE phase='2' AND block=11")).rows[0].n
gap === 46 ? ok('P2 B11 has 46 lots') : bad('P2 B11', gap)
const b3 = (await db.query("SELECT min(lot)::int AS m FROM subdivision_lots WHERE phase='1' AND block=3")).rows[0].m
b3 === 25 ? ok('P1 B3 starts at 25') : bad('P1 B3', b3)

const [r] = await expectOk('insert resident',
  `INSERT INTO residents (firebase_uid, email, full_name) VALUES ('uid1','Ana@Example.com','Ana Cruz') RETURNING id, is_verified`)
r && r.is_verified === false ? ok('is_verified derived false') : bad('is_verified')
await expectError('email unique case-insensitively',
  `INSERT INTO residents (firebase_uid, email, full_name) VALUES ('uid2','ana@example.com','Ana Two')`)
await expectError('verified without reviewed_at refused',
  `UPDATE residents SET verification_status='verified' WHERE id=$1`, [r.id])
await expectError('rejected without reason refused',
  `UPDATE residents SET verification_status='rejected', reviewed_at=now() WHERE id=$1`, [r.id])
await expectOk('verify', `UPDATE residents SET verification_status='verified', reviewed_at=now() WHERE id=$1`, [r.id])
const v = (await db.query('SELECT is_verified FROM residents WHERE id=$1', [r.id])).rows[0]
v.is_verified ? ok('is_verified follows status') : bad('is_verified follow')

await expectError('nonexistent lot refused (P1 B3 L24)',
  `INSERT INTO resident_properties (resident_id, phase, block, lot) VALUES ($1,'1',3,24)`, [r.id])
await expectOk('real lot accepted',
  `INSERT INTO resident_properties (resident_id, phase, block, lot) VALUES ($1,'1',3,25)`, [r.id])

await expectError('10 MB document refused',
  `INSERT INTO verification_documents (resident_id, storage_path, download_url, content_type, byte_size)
   VALUES ($1,'verification_ids/uid1/a.jpg','u','image/jpeg',10485760)`, [r.id])
await expectError('HEIC refused',
  `INSERT INTO verification_documents (resident_id, storage_path, download_url, content_type, byte_size)
   VALUES ($1,'verification_ids/uid1/a.heic','u','image/heic',100)`, [r.id])
await expectOk('PDF accepted',
  `INSERT INTO verification_documents (resident_id, storage_path, download_url, content_type, byte_size)
   VALUES ($1,'verification_ids/uid1/a.pdf','https://x/a.pdf','application/pdf',2048)`, [r.id])
const review = (await db.query('SELECT document_urls, phase FROM v_resident_review WHERE id=$1', [r.id])).rows[0]
review.document_urls.length === 1 && review.phase === '1' ? ok('review view joins') : bad('review view', JSON.stringify(review))

const hash = 'a'.repeat(64), salt = 'b'.repeat(32)
const id1 = (await db.query(`SELECT issue_password_reset('uid1','Ana@Example.com',$1,$2,'203.0.113.5') AS id`, [hash, salt])).rows[0].id
const id2 = (await db.query(`SELECT issue_password_reset('uid1','ana@example.com',$1,$2,'203.0.113.5') AS id`, [hash, salt])).rows[0].id
const live = (await db.query(`SELECT count(*)::int AS n FROM password_resets WHERE email='ana@example.com' AND NOT is_used AND revoked_at IS NULL`)).rows[0].n
live === 1 ? ok('resend leaves one live code') : bad('one live', live)
const revoked = (await db.query('SELECT revoked_at IS NOT NULL AS r FROM password_resets WHERE id=$1', [id1])).rows[0].r
revoked ? ok('older code revoked') : bad('revoked')

await expectError('second live row refused by index',
  `INSERT INTO password_resets (user_id,email,otp_hash,otp_salt,expires_at) VALUES ('uid1','ana@example.com',$1,$2,now()+interval '5 minutes')`, [hash, salt])
await expectError('plaintext-looking hash refused',
  `INSERT INTO password_resets (user_id,email,otp_hash,otp_salt,expires_at) VALUES ('u','z@x.com','123456',$1,now()+interval '5 minutes')`, [salt])
await expectError('TTL over 10 minutes refused',
  `INSERT INTO password_resets (user_id,email,otp_hash,otp_salt,expires_at) VALUES ('u','z@x.com',$1,$2,now()+interval '1 hour')`, [hash, salt])
await expectError('unnormalised email refused',
  `INSERT INTO password_resets (user_id,email,otp_hash,otp_salt,expires_at) VALUES ('u','Z@x.com',$1,$2,now()+interval '5 minutes')`, [hash, salt])
await expectError('is_used without used_at refused',
  `UPDATE password_resets SET is_used=true WHERE id=$1`, [id2])
await expectError('attempts over 5 refused', `UPDATE password_resets SET attempts=6 WHERE id=$1`, [id2])

await db.query(`UPDATE password_resets SET attempts=3 WHERE id=$1`, [id1])
await db.query(`UPDATE password_resets SET attempts=2 WHERE id=$1`, [id2])
const spent = (await db.query(`SELECT password_reset_attempts_in_window('ANA@example.com') AS n`)).rows[0].n
spent === 5 ? ok('attempts budget spans codes') : bad('attempt window', spent)

await expectOk('mark used', `UPDATE password_resets SET is_used=true, used_at=now(), used_ip='198.51.100.7' WHERE id=$1`, [id2])
const ip = (await db.query('SELECT host(ip_address) AS ip FROM password_resets WHERE id=$1', [id2])).rows[0].ip
ip === '203.0.113.5' ? ok('ip stored as inet') : bad('ip', ip)

await db.query(`UPDATE password_resets SET created_at = now() - interval '2 days', expires_at = now() - interval '2 days' + interval '10 minutes'`)
const purged = (await db.query('SELECT purge_password_resets() AS n')).rows[0].n
purged === 2 ? ok('purge removes day-old rows') : bad('purge', purged)

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures ? 1 : 0)
