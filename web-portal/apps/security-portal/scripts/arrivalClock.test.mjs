/**
 * The arrival clock, under bare node.
 *
 *   node scripts/arrivalClock.test.mjs      (from apps/security-portal)
 *
 * ── WHY TWO FUNCTIONS GET THEIR OWN FILE ────────────────────────────────────
 * Because this is the one figure on the navigation panel that is a function of
 * the PRESENT, and every other number there is a function of a GPS fix. That
 * makes it the only one that can be wrong while every input is right — a stale
 * `now`, a negative duration from a route that overshot, a `null` arriving
 * from a progress object with no usable fix. None of those produce a visibly
 * silly number; they produce a plausible wrong time, which an officer will
 * repeat to a resident on the phone.
 *
 * `routeProgress.test.mjs` cannot cover it: that module is deliberately
 * clock-free, which is precisely why these two live in `directions.js` instead
 * and are checked here.
 *
 * Pinned to a fixed `now` and an explicit locale, so this says the same thing
 * on a guardhouse machine in Manila and in CI.
 */

import assert from 'assert'
import { pathToFileURL } from 'url'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = await import(pathToFileURL(path.join(here, '..', 'src', 'lib', 'directions.js')).href)
const { arrivalAt, formatClockTime, formatDuration, formatDistance } = lib

let passed = 0
const failures = []
const check = (name, fn) => {
  try {
    fn()
    passed += 1
  } catch (err) {
    failures.push(`${name}: ${err.message}`)
  }
}

// 2026-10-10, 12:40:00 local. The brief's own worked example: a 2 hr 4 min
// route leaving now arrives at 14:44 — "2:44 PM" on a 12-hour clock, which is
// the figure the panel is specified to show.
const NOW = new Date(2026, 9, 10, 12, 40, 0).getTime()

check('arrivalAt adds the remaining duration to now', () => {
  const at = arrivalAt(2 * 3600 + 4 * 60, NOW)
  assert.strictEqual(at.getHours(), 14)
  assert.strictEqual(at.getMinutes(), 44)
})

check('arrivalAt handles a route that is already finished', () => {
  // 0 is a real answer — the unit is arriving NOW — and must not be confused
  // with "no figure available". Only a NEGATIVE duration is nonsense.
  const at = arrivalAt(0, NOW)
  assert.strictEqual(at.getTime(), NOW)
})

check('arrivalAt refuses what it cannot compute', () => {
  // Each of these reaches the panel for a real reason: null from a progress
  // object with no fix, NaN from arithmetic on a missing duration, and a
  // negative from a simulated unit that ran past the destination.
  assert.strictEqual(arrivalAt(null, NOW), null)
  assert.strictEqual(arrivalAt(undefined, NOW), null)
  assert.strictEqual(arrivalAt(NaN, NOW), null)
  assert.strictEqual(arrivalAt(Infinity, NOW), null)
  assert.strictEqual(arrivalAt(-60, NOW), null)
  assert.strictEqual(arrivalAt(600, NaN), null)
})

check('arrivalAt crosses midnight rather than wrapping the clock', () => {
  // A long walk plotted late in a night shift. The DATE has to advance, which
  // is the thing a naive `(hours + n) % 24` gets wrong.
  const lateShift = new Date(2026, 9, 10, 23, 50, 0).getTime()
  const at = arrivalAt(25 * 60, lateShift)
  assert.strictEqual(at.getDate(), 11)
  assert.strictEqual(at.getHours(), 0)
  assert.strictEqual(at.getMinutes(), 15)
})

check('formatClockTime prints a wall-clock time', () => {
  const at = arrivalAt(2 * 3600 + 4 * 60, NOW)
  // Non-breaking space in some ICU versions, and a thin space in others — both
  // are correct output and neither is worth pinning, so the separator is
  // normalised before comparing.
  const printed = formatClockTime(at, 'en-US').replace(/\s/g, ' ')
  assert.strictEqual(printed, '2:44 PM')
})

check('formatClockTime pads the minute, never the hour', () => {
  // "2:04 PM", not "2:4 PM" and not "02:04 PM" — `hour: 'numeric'` with
  // `minute: '2-digit'` is the pair that produces a clock a person reads.
  const at = arrivalAt(4 * 60, new Date(2026, 9, 10, 14, 0, 0).getTime())
  const printed = formatClockTime(at, 'en-US').replace(/\s/g, ' ')
  assert.strictEqual(printed, '2:04 PM')
})

check('formatClockTime honours a 24-hour locale', () => {
  // The app passes no locale and takes the browser's, so a console set to a
  // 24-hour locale must not get an en-US clock baked in at build time.
  const at = arrivalAt(2 * 3600 + 4 * 60, NOW)
  assert.strictEqual(formatClockTime(at, 'en-GB'), '14:44')
})

check('formatClockTime refuses a non-date', () => {
  // The em-dash is the panel's own "no figure" mark, matching formatDistance
  // and formatDuration, so a missing arrival time reads the same as any other
  // missing figure rather than as "Invalid Date".
  assert.strictEqual(formatClockTime(null), '—')
  assert.strictEqual(formatClockTime(undefined), '—')
  assert.strictEqual(formatClockTime(new Date('nonsense')), '—')
  assert.strictEqual(formatClockTime('2:44 PM'), '—')
})

check('the three header figures agree about a missing value', () => {
  // The telemetry row reads as one object, so one blank cell among three has
  // to look deliberate. All three print the same mark for nothing.
  assert.strictEqual(formatDuration(null), '—')
  assert.strictEqual(formatDistance(null), '—')
  assert.strictEqual(formatClockTime(null), '—')
})

check('formatDuration spells out a multi-hour route', () => {
  // The brief's "2 hr 4 min" example, in this codebase's own wording. Worth
  // pinning because the arrival clock and the ETA are read side by side, and
  // they must be derived from the same seconds.
  assert.strictEqual(formatDuration(2 * 3600 + 4 * 60), '2 h 4 min')
  assert.strictEqual(formatDuration(2 * 3600), '2 h')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  failures.forEach((f) => console.error('  FAIL  ' + f))
  process.exit(1)
}
