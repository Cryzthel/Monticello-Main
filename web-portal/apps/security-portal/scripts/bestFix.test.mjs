/**
 * Which of two positions for the same officer the console should believe.
 *
 *   node scripts/bestFix.test.mjs      (from apps/security-portal)
 *
 * ── THE SITUATION ──────────────────────────────────────────────────────────
 * A guard on shift has the console open on a laptop and the mobile app in
 * their pocket. Both are signed in as them, both publish to the same telemetry
 * document, and they are not equally good at knowing where they are: the phone
 * has a GPS chip, the laptop has a list of Wi-Fi access points.
 *
 * The rule has to prefer the better SENSOR without flapping between two
 * readings of the same quality, and without reaching across the network on the
 * device that already has a good answer.
 */

import assert from 'assert'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { pickBestFix, shouldDeferPublish, fixQuality, MAX_REMOTE_AGE_MS } = await import(
  pathToFileURL(path.join(here, '..', 'src', 'lib', 'bestFix.js')).href
)

const NOW = 1_760_000_000_000
const fix = (accuracy, ageMs = 0, tag = 'x') => ({
  lat: 10.76,
  lng: 122.5,
  accuracy,
  capturedAt: NOW - ageMs,
  tag,
})

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
const pick = (a, b) => pickBestFix(a, b, NOW)?.tag ?? null

// ── THE CASE THIS EXISTS FOR ───────────────────────────────────────────────

check("a laptop's Wi-Fi guess yields to the officer's own phone", () => {
  assert.strictEqual(pick(fix(600, 0, 'laptop'), fix(8, 2000, 'phone')), 'phone')
})

check('…and a desktop with only an IP-scale reading does too', () => {
  assert.strictEqual(pick(fix(950, 0, 'desktop'), fix(12, 1000, 'phone')), 'phone')
})

// ── BUT THE PHONE DOES NOT REACH ACROSS THE NETWORK FOR ITS OWN ECHO ───────

check('a good local fix is kept, even against a better published one', () => {
  // On the phone itself the published position IS the local one, a round trip
  // later. Preferring it would reintroduce the latency the local path exists
  // to avoid, on the device that needs it least.
  assert.strictEqual(pick(fix(14, 0, 'local'), fix(6, 1000, 'published')), 'local')
})

check('the precision line is PRECISE_FIX_M (30 m), the GPS-vs-estimate line', () => {
  // Was 100 m, which let a ±60 m laptop on good Wi-Fi keep its own estimate
  // against the officer's ±8 m phone.
  assert.strictEqual(pick(fix(30, 0, 'local'), fix(5, 0, 'published')), 'local')
  assert.strictEqual(pick(fix(31, 0, 'local'), fix(5, 0, 'published')), 'published')
  assert.strictEqual(pick(fix(60, 0, 'laptop'), fix(8, 0, 'phone')), 'phone')
})

// ── IT MUST NOT FLAP ───────────────────────────────────────────────────────

check('two readings of similar quality do not swap the source', () => {
  // ±420 against ±400 is one position described twice. Switching on that would
  // drag the marker and re-plot the route every few seconds.
  assert.strictEqual(pick(fix(420, 0, 'local'), fix(400, 0, 'published')), 'local')
})

check('only a genuine difference in sensor crosses the margin', () => {
  assert.strictEqual(pick(fix(400, 0, 'local'), fix(200, 0, 'published')), 'published')
  assert.strictEqual(pick(fix(400, 0, 'local'), fix(201, 0, 'published')), 'local')
})

// ── A STALE REMOTE FIX IS NOT A BETTER FIX ─────────────────────────────────

check('precision does not rescue an old reading', () => {
  // Accuracy says where the device was when it looked, not whether the officer
  // is still there.
  const old = MAX_REMOTE_AGE_MS + 1000
  assert.strictEqual(pick(fix(600, 0, 'laptop'), fix(5, old, 'phone')), 'laptop')
})

check('a published fix with no capture time is never preferred', () => {
  const noClock = { lat: 10.76, lng: 122.5, accuracy: 5, tag: 'published' }
  assert.strictEqual(pickBestFix(fix(600, 0, 'laptop'), noClock, NOW).tag, 'laptop')
})

// ── ONE SIDE MISSING ───────────────────────────────────────────────────────

check('whichever one exists is used', () => {
  assert.strictEqual(pick(null, fix(900, 0, 'published')), 'published')
  assert.strictEqual(pick(fix(900, 0, 'local'), null), 'local')
  assert.strictEqual(pick(null, null), null)
})

check('a coordinate-less object counts as missing, not as a position', () => {
  assert.strictEqual(pick({ accuracy: 5 }, fix(900, 0, 'published')), 'published')
  assert.strictEqual(pick(fix(900, 0, 'local'), { accuracy: 5 }), 'local')
  assert.strictEqual(pick({ lat: NaN, lng: 1, tag: 'bad' }, null), null)
})

check('a fix with no stated accuracy loses to one that has it', () => {
  // Unknown is not good. Infinity is the honest reading of "did not say".
  assert.strictEqual(pick({ lat: 1, lng: 2, tag: 'local' }, fix(9, 0, 'published')), 'published')
})

// ── WHICH DEVICE PUBLISHES ─────────────────────────────────────────────────

const ME = 'laptop-id'
const remote = (accuracy, ageMs, deviceId = 'phone-id') => ({ position: fix(accuracy, ageMs), deviceId })

check("the laptop stops overwriting the phone's better, fresh fix", () => {
  assert.strictEqual(shouldDeferPublish(remote(8, 3000), fix(122), ME, NOW), true)
})

check('…and takes the stream back once the phone goes quiet', () => {
  assert.strictEqual(shouldDeferPublish(remote(8, MAX_REMOTE_AGE_MS + 1000), fix(122), ME, NOW), false)
})

check("an idle phone's 120 s heartbeat is not mistaken for silence", () => {
  // TELEMETRY_CADENCE.idle.heartbeatMs — a stationary idle phone writes this
  // rarely. If the window were shorter the two devices would take turns.
  assert.ok(MAX_REMOTE_AGE_MS > 120_000)
  assert.strictEqual(shouldDeferPublish(remote(8, 125_000), fix(122), ME, NOW), true)
})

check('a device never defers to its own echo', () => {
  assert.strictEqual(shouldDeferPublish(remote(8, 0, ME), fix(122), ME, NOW), false)
})

check('two GPS-grade devices both publish (no defer at or below 30 m)', () => {
  assert.strictEqual(shouldDeferPublish(remote(5, 0), fix(20), ME, NOW), false)
})

check('similar estimates do not defer (no flapping)', () => {
  assert.strictEqual(shouldDeferPublish(remote(90, 0), fix(122), ME, NOW), false)
})

check('with no fix of its own, a device does not blank out a good remote one', () => {
  assert.strictEqual(shouldDeferPublish(remote(8, 0), null, ME, NOW), true)
})

check('a document from an old build with no deviceId is not deferred to', () => {
  assert.strictEqual(shouldDeferPublish({ position: fix(8, 0), deviceId: null }, fix(122), ME, NOW), false)
})

// ── THE BADGE TIERS ────────────────────────────────────────────────────────

check('badge: GPS-grade, Wi-Fi estimate, and unknown', () => {
  assert.deepStrictEqual(fixQuality(fix(8)), { tier: 'precise', accuracy: 8 })
  assert.deepStrictEqual(fixQuality(fix(30)), { tier: 'precise', accuracy: 30 })
  assert.deepStrictEqual(fixQuality(fix(122)), { tier: 'coarse', accuracy: 122 })
  assert.deepStrictEqual(fixQuality({ lat: 10.76, lng: 122.5 }), { tier: 'unknown', accuracy: null })
  assert.deepStrictEqual(fixQuality(null), { tier: 'unknown', accuracy: null })
})

console.log(`\n${passed} passed, ${process.exitCode ? 'failures above' : '0 failed'}`)
