/**
 * Whether the console can contradict itself about where the officer is.
 *
 *   node scripts/locationState.test.mjs      (from apps/security-portal)
 *
 * ── THE BUG THIS EXISTS FOR, IN ONE SCREENSHOT ─────────────────────────────
 * A guard's phone showed "GPS locked · ±14 m" on the map and "Location is
 * blocked — dispatch cannot see you" in the banner directly above it, at the
 * same moment, describing the same device. Both were rendered from the same
 * telemetry; they disagreed because one of them let the Permissions API
 * outrank a position that had actually arrived.
 *
 * That was the third variant of one mistake — a REPORT ABOUT the stream
 * outranking the stream — so the rule is now pure and the cases below are the
 * contradiction, not the implementation.
 */

import assert from 'assert'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { locationState } = await import(
  pathToFileURL(path.join(here, '..', 'src', 'lib', 'locationState.js')).href
)

const FIX = { lat: 10.7602, lng: 122.5002, accuracy: 14 }
const ON = { onDuty: true, supported: true }
const at = (over) => locationState({ ...ON, ...over })

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

// ── A POSITION OUTRANKS EVERY REPORT ABOUT ONE ─────────────────────────────

check('THE SCREENSHOT: a fix with the API claiming denied is located', () => {
  assert.strictEqual(at({ fix: FIX, permission: 'denied' }), 'ok')
})

check('a fix with a stale location-denied error is located', () => {
  assert.strictEqual(at({ fix: FIX, locationError: 'location-denied' }), 'ok')
})

check('a fix with a stale no-fix error is located', () => {
  assert.strictEqual(at({ fix: FIX, locationError: 'no-fix', overdue: true }), 'ok')
})

check('a fix with every report against it at once is still located', () => {
  assert.strictEqual(
    at({ fix: FIX, permission: 'denied', locationError: 'location-denied', overdue: true }),
    'ok',
  )
})

// ── THE LATCH: GRANTED ONCE, NOT RE-ACCUSED ────────────────────────────────

check('a device that has fixed before is not called denied when one drops', () => {
  assert.notStrictEqual(at({ fix: null, everFixed: true, permission: 'denied' }), 'denied')
})

check('…and is told it is waiting, which is what is actually true', () => {
  assert.strictEqual(at({ fix: null, everFixed: true, permission: 'denied', overdue: true }), 'waiting')
})

// ── A REAL DENIAL STILL REACHES THE OFFICER ────────────────────────────────

check('never fixed, API says denied: denied', () => {
  assert.strictEqual(at({ fix: null, permission: 'denied' }), 'denied')
})

check('never fixed, no Permissions API, error says denied: denied', () => {
  // Older Safari has no geolocation entry, so the error code is all there is.
  assert.strictEqual(at({ fix: null, permission: null, locationError: 'location-denied' }), 'denied')
})

check('a granted permission suppresses a denial error outright', () => {
  // The original bug: one failed reading reported as a standing refusal on a
  // console where the officer had allowed it.
  assert.notStrictEqual(
    at({ fix: null, permission: 'granted', locationError: 'location-denied' }),
    'denied',
  )
})

// ── THE STATE A BUTTON CAN FIX ─────────────────────────────────────────────

check('never asked is prompt, immediately — waiting would never resolve', () => {
  // No grace period here on purpose: a device that has not been asked will
  // never produce a fix on its own, so there is nothing to wait for.
  assert.strictEqual(at({ fix: null, permission: 'prompt' }), 'prompt')
  assert.strictEqual(at({ fix: null, permission: null }), 'prompt')
})

check('granted but still acquiring says nothing until the grace expires', () => {
  assert.strictEqual(at({ fix: null, permission: 'granted' }), 'ok')
  assert.strictEqual(at({ fix: null, permission: 'granted', overdue: true }), 'waiting')
})

// ── SILENCE IS ALSO A REQUIREMENT ──────────────────────────────────────────

check('off duty reports nothing, whatever the device knows', () => {
  // A privacy rule, not a cosmetic one.
  assert.strictEqual(locationState({ onDuty: false, supported: true, fix: FIX }), 'off')
  assert.strictEqual(locationState({ onDuty: false, supported: true, permission: 'denied' }), 'off')
})

check('a browser with no geolocation reports nothing', () => {
  assert.strictEqual(locationState({ onDuty: true, supported: false, permission: 'denied' }), 'off')
})

// ── THE INVARIANT, OVER EVERY COMBINATION ──────────────────────────────────

check('no combination with a live fix ever produces a warning state', () => {
  // This is the contradiction in the screenshot, stated as a property: if the
  // device has a position, nothing may tell the officer it does not.
  const bools = [false, true]
  for (const permission of ['granted', 'denied', 'prompt', null]) {
    for (const locationError of ['location-denied', 'no-fix', null]) {
      for (const everFixed of bools) {
        for (const overdue of bools) {
          const state = at({ fix: FIX, permission, locationError, everFixed, overdue })
          assert.strictEqual(
            state,
            'ok',
            `fix present but state=${state} for ${JSON.stringify({ permission, locationError, everFixed, overdue })}`,
          )
        }
      }
    }
  }
})

console.log(`\n${passed} passed, ${process.exitCode ? 'failures above' : '0 failed'}`)
