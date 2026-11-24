/**
 * Whether the officer can see themselves on their own map.
 *
 *   node scripts/liveSelfUnit.test.mjs      (from apps/security-portal)
 *
 * ── WHAT THIS GUARDS ───────────────────────────────────────────────────────
 * The officer's own marker used to be drawn only from the `guard_telemetry`
 * document — their browser writing a position to Firestore and reading it
 * back. Five separate things can stop that round trip completing, and all five
 * look the same on screen: no dot. This merge is what makes the dot a function
 * of the device instead.
 *
 * The cases below are the ones that were wrong or are easy to get wrong later:
 * a unit that does not exist yet, stale metadata surviving a fresh position,
 * and the two states where drawing a position would be a privacy fault rather
 * than a bug.
 */

import assert from 'assert'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { withLiveSelfUnit } = await import(
  pathToFileURL(path.join(here, '..', 'src', 'lib', 'liveSelfUnit.js')).href
)

const UID = 'g1'
const FIX = { lat: 10.7602, lng: 122.5002, accuracy: 7.4, capturedAt: 1_760_000_000_000 }
const SELF = { uid: UID, fix: FIX, mode: 'active', name: 'Officer Dela Cruz' }

/** A published unit whose document is old and getting older. */
const STALE_DOC = {
  uid: UID,
  name: 'guard.test@monticellovillas.ph',
  badgeNumber: 'SG-04',
  state: 'responding',
  assignment: { id: 'inc1' },
  position: { lat: 10.75, lng: 122.49, accuracy: 60, capturedAt: 1 },
  positionAgeMs: 240_000,
  stale: true,
  reporting: true,
}
const OTHER = { uid: 'g2', name: 'Officer Reyes', position: { lat: 10.77, lng: 122.51 }, stale: true }

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const selfIn = (list) => list.find((u) => u.uid === UID)

// ── THE DOT APPEARS WITHOUT A DOCUMENT ─────────────────────────────────────

check('no telemetry document yet: the unit is added, not waited for', () => {
  const out = withLiveSelfUnit([OTHER], SELF)
  assert.strictEqual(out.length, 2)
  assert.deepStrictEqual(selfIn(out).position, {
    lat: FIX.lat,
    lng: FIX.lng,
    accuracy: FIX.accuracy,
    capturedAt: FIX.capturedAt,
  })
})

check('the added unit is named from the account, never left blank', () => {
  assert.strictEqual(selfIn(withLiveSelfUnit([], SELF)).name, 'Officer Dela Cruz')
  assert.strictEqual(selfIn(withLiveSelfUnit([], { ...SELF, name: '' })).name, 'Security officer')
})

check('the added unit claims no assignment it cannot know about', () => {
  const added = selfIn(withLiveSelfUnit([], SELF))
  assert.strictEqual(added.assignment, null)
  assert.strictEqual(added.state, 'available')
})

// ── THE DOT IS CURRENT, AND SO IS EVERYTHING SAID ABOUT IT ─────────────────

check('a live position overrides the published one', () => {
  const out = withLiveSelfUnit([STALE_DOC], SELF)
  assert.strictEqual(out.length, 1, 'must replace, not duplicate')
  assert.strictEqual(selfIn(out).position.lat, FIX.lat)
})

check('stale metadata does not survive a fresh position', () => {
  // The bug this prevents: the right place, labelled "last seen 4 minutes
  // ago". Two facts, no way for a dispatcher to pick between them.
  const self = selfIn(withLiveSelfUnit([STALE_DOC], SELF))
  assert.strictEqual(self.stale, false)
  assert.strictEqual(self.positionAgeMs, 0)
  assert.strictEqual(self.reporting, true)
})

check('everything the document knows that the device does not is kept', () => {
  const self = selfIn(withLiveSelfUnit([STALE_DOC], SELF))
  assert.strictEqual(self.badgeNumber, 'SG-04')
  assert.strictEqual(self.state, 'responding')
  assert.deepStrictEqual(self.assignment, { id: 'inc1' })
})

check('no other unit is touched', () => {
  const out = withLiveSelfUnit([OTHER, STALE_DOC], SELF)
  assert.deepStrictEqual(out.find((u) => u.uid === 'g2'), OTHER)
})

// ── WHEN IT MUST DRAW NOTHING ──────────────────────────────────────────────

check('off duty draws no position, whatever the device knows', () => {
  // Not a bug guard — a privacy one. An officer who has clocked out is a
  // private citizen, and telemetry is gated on an open shift by design.
  const units = [OTHER]
  assert.strictEqual(withLiveSelfUnit(units, { ...SELF, mode: 'off' }), units)
})

check('no fix, no uid, or nonsense coordinates change nothing', () => {
  const units = [OTHER]
  assert.strictEqual(withLiveSelfUnit(units, { ...SELF, fix: null }), units)
  assert.strictEqual(withLiveSelfUnit(units, { ...SELF, uid: null }), units)
  assert.strictEqual(withLiveSelfUnit(units, { ...SELF, fix: { lat: NaN, lng: 1 } }), units)
  assert.strictEqual(withLiveSelfUnit(units, {}), units)
})

check('a no-op returns the SAME array, so the memo holds its identity', () => {
  // Returning a fresh copy would rebuild the map's unit source on every
  // render that changed nothing.
  const units = [OTHER]
  assert.strictEqual(withLiveSelfUnit(units, { ...SELF, fix: null }), units)
})

check('a missing accuracy becomes null rather than undefined', () => {
  const self = selfIn(withLiveSelfUnit([], { ...SELF, fix: { lat: 1, lng: 2 } }))
  assert.strictEqual(self.position.accuracy, null)
  assert.ok(Number.isFinite(self.position.capturedAt), 'capturedAt must always be set')
})

console.log(`\n${passed} passed, ${process.exitCode ? 'failures above' : '0 failed'}`)
