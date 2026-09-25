/**
 * The route-progress maths, under bare node.
 *
 *   node scripts/routeProgress.test.mjs      (from apps/security-portal)
 *
 * This module decides what a dispatcher is told about a live emergency: how
 * far the unit still has to go, how long it will take, and which turn is next.
 * It is pure so it can be checked against distances worked out by hand rather
 * than eyeballed on a map, where a 30% error in "remaining" looks like a
 * slightly different dot.
 */

import assert from 'assert'
import { pathToFileURL } from 'url'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = await import(pathToFileURL(path.join(here, '..', 'src', 'lib', 'routeProgress.js')).href)
const {
  measureLine,
  projectOnLine,
  splitLine,
  bearingAt,
  stepBoundaries,
  activeStep,
  routeProgress,
  interpolateAlong,
  isOffRoute,
  OFF_ROUTE_METERS,
} = lib

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
const near = (actual, expected, tol, what) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${what ?? 'value'}: expected ~${expected} (±${tol}), got ${actual}`,
  )

// A 3-segment line near Monticello's latitude (14.2°N), each leg ~100 m.
// 0.001° of latitude is ~111.2 m; 0.001° of longitude at 14.2°N is ~107.8 m.
const LAT = 14.2
const LINE = [
  [121.0, LAT],
  [121.0, LAT + 0.0009], // ~100 m north
  [121.001, LAT + 0.0009], // ~107.8 m east
  [121.001, LAT + 0.0018], // ~100 m north
]

check('measureLine sums the legs', () => {
  const { segments, total } = measureLine(LINE)
  assert.strictEqual(segments.length, 3)
  near(segments[0], 100, 1.5, 'leg 1')
  near(segments[1], 107.8, 2, 'leg 2')
  near(segments[2], 100, 1.5, 'leg 3')
  near(total, 307.8, 4, 'total')
})

check('measureLine tolerates junk', () => {
  assert.deepStrictEqual(measureLine(null), { segments: [], total: 0 })
  assert.deepStrictEqual(measureLine([[1, 2]]), { segments: [], total: 0 })
})

check('a point ON the line projects with ~zero offset', () => {
  const hit = projectOnLine(LINE, [121.0, LAT + 0.00045]) // halfway up leg 1
  near(hit.offset, 0, 0.5, 'offset')
  near(hit.along, 50, 1.5, 'along')
  assert.strictEqual(hit.index, 0)
})

check('a point beside the line reports the perpendicular offset', () => {
  // 0.0005° of longitude east of leg 1 is ~53.9 m at this latitude. Placed low
  // on the leg (LAT + 0.0002) on purpose: at the leg's midpoint the nearest
  // part of the route is actually the HORIZONTAL leg above it, 50.0 m away —
  // which is the right answer to a different question, and is what this
  // assertion originally got wrong.
  const hit = projectOnLine(LINE, [121.0005, LAT + 0.0002])
  assert.strictEqual(hit.index, 0)
  near(hit.offset, 53.9, 2, 'offset')
  near(hit.along, 22.2, 2, 'along')
})

check('a point past the end clamps to the end', () => {
  const hit = projectOnLine(LINE, [121.001, LAT + 0.01])
  near(hit.along, 307.8, 4, 'along')
  assert.strictEqual(hit.t, 1)
})

check('a point before the start clamps to the start', () => {
  const hit = projectOnLine(LINE, [121.0, LAT - 0.01])
  near(hit.along, 0, 0.5, 'along')
})

check('duplicate coordinates do not divide by zero', () => {
  const dupes = [
    [121.0, LAT],
    [121.0, LAT],
    [121.0, LAT + 0.0009],
  ]
  const hit = projectOnLine(dupes, [121.0, LAT + 0.00045])
  assert.ok(Number.isFinite(hit.along) && Number.isFinite(hit.offset))
  near(hit.along, 50, 1.5, 'along')
})

check('splitLine covers and remains, sharing the split point', () => {
  const { covered, remaining } = splitLine(LINE, 1, 0.5)
  assert.strictEqual(covered.length, 3)
  assert.strictEqual(remaining.length, 3)
  assert.deepStrictEqual(covered[covered.length - 1], remaining[0])
  const whole = measureLine(LINE).total
  near(measureLine(covered).total + measureLine(remaining).total, whole, 1, 'split halves sum')
})

check('bearingAt reads north and east', () => {
  near(bearingAt(LINE, 0), 0, 1, 'north')
  near(bearingAt(LINE, 1), 90, 1, 'east')
})

const STEPS = [
  { instruction: 'Head north', distance: 100 },
  { instruction: 'Turn right', distance: 107.8 },
  { instruction: 'Turn left', distance: 100 },
  { instruction: 'You have arrived', distance: 0 },
]

check('stepBoundaries are cumulative and end exactly at the line length', () => {
  const total = measureLine(LINE).total
  const ends = stepBoundaries(STEPS, total)
  assert.strictEqual(ends.length, 4)
  near(ends[0], 100, 1.5)
  near(ends[1], 207.8, 2)
  near(ends[ends.length - 1], total, 0.001, 'last boundary == total')
})

check('activeStep names the NEXT maneuver and the distance to it', () => {
  const total = measureLine(LINE).total
  const ends = stepBoundaries(STEPS, total)

  // 40 m in: still on step 0, 60 m until the turn it ends with.
  const early = activeStep(STEPS, ends, 40)
  assert.strictEqual(early.index, 0)
  near(early.distanceToManeuver, 60, 2)
  assert.strictEqual(early.upcoming.instruction, 'Turn right')

  // 150 m in: on step 1.
  const mid = activeStep(STEPS, ends, 150)
  assert.strictEqual(mid.index, 1)
  assert.strictEqual(mid.upcoming.instruction, 'Turn left')

  // At the very end: last step, no negative distance, flagged as last.
  const end = activeStep(STEPS, ends, total + 50)
  assert.strictEqual(end.isLast, true)
  assert.ok(end.distanceToManeuver >= 0, 'never negative')
})

check('activeStep survives an empty list', () => {
  assert.strictEqual(activeStep([], [], 10), null)
  assert.strictEqual(activeStep(null, [], 10), null)
})

// ── the whole thing ─────────────────────────────────────────────────────────

const ROUTE = {
  geometry: { type: 'LineString', coordinates: LINE },
  distance: 307.8,
  duration: 300, // 5 minutes
  steps: STEPS,
}

check('routeProgress at the start has everything still to go', () => {
  const p = routeProgress(ROUTE, { lat: LAT, lng: 121.0 })
  near(p.traveledM, 0, 1)
  near(p.remainingM, 307.8, 4)
  near(p.remainingDurationS, 300, 5)
  near(p.fraction, 0, 0.01)
  assert.strictEqual(p.step.index, 0)
})

check('routeProgress halfway halves the distance AND the ETA', () => {
  // Midpoint of leg 2 => 100 + 53.9 = ~153.9 m of ~307.8.
  const p = routeProgress(ROUTE, { lat: LAT + 0.0009, lng: 121.0005 })
  near(p.fraction, 0.5, 0.02)
  near(p.remainingM, 153.9, 5)
  near(p.remainingDurationS, 150, 10)
  assert.strictEqual(p.step.index, 1)
})

check('routeProgress at the destination leaves nothing', () => {
  const p = routeProgress(ROUTE, { lat: LAT + 0.0018, lng: 121.001 })
  near(p.remainingM, 0, 2)
  near(p.remainingDurationS, 0, 5)
  assert.ok(p.step.isLast)
})

check('covered + remaining always reconstruct the route', () => {
  for (const at of [0.1, 0.25, 0.5, 0.75, 0.99]) {
    const p = routeProgress(ROUTE, { lat: LAT + 0.0018 * at, lng: 121.0 })
    const sum = measureLine(p.coveredCoords).total + measureLine(p.remainingCoords).total
    near(sum, measureLine(LINE).total, 1.5, `split at ${at}`)
    assert.deepStrictEqual(
      p.coveredCoords[p.coveredCoords.length - 1],
      p.remainingCoords[0],
      'halves must meet',
    )
  }
})

check('NO FIX means no progress, never a guess', () => {
  // The failure that matters: a missing or zeroed position must not read as
  // "at the start of the route", which would show a full ETA for a unit whose
  // location is unknown.
  for (const position of [null, undefined, {}, { lat: null, lng: null }, { lat: 0, lng: 0 }, { lat: NaN, lng: 1 }]) {
    assert.strictEqual(routeProgress(ROUTE, position), null, JSON.stringify(position))
  }
})

check('a degenerate route yields nothing', () => {
  assert.strictEqual(routeProgress({ geometry: { coordinates: [] } }, { lat: LAT, lng: 121 }), null)
  assert.strictEqual(routeProgress(null, { lat: LAT, lng: 121 }), null)
})

check('off-route is measured, not assumed', () => {
  const on = routeProgress(ROUTE, { lat: LAT + 0.00045, lng: 121.0 })
  assert.strictEqual(isOffRoute(on), false)

  // ~108 m east of the line: well past the threshold.
  const off = routeProgress(ROUTE, { lat: LAT + 0.00045, lng: 121.001 })
  assert.ok(off.offsetM > OFF_ROUTE_METERS, `offset ${off.offsetM}`)
  assert.strictEqual(isOffRoute(off), true)

  // A 30 m GPS wobble must NOT flap the banner.
  const wobble = routeProgress(ROUTE, { lat: LAT + 0.00045, lng: 121.00028 })
  assert.ok(wobble.offsetM < OFF_ROUTE_METERS, `wobble ${wobble.offsetM} should be tolerated`)
  assert.strictEqual(isOffRoute(wobble), false)
})

// ── interpolateAlong: the simulator's only way onto the road ───────────

check('interpolateAlong walks the real geometry', () => {
  const total = measureLine(LINE).total
  assert.deepStrictEqual(interpolateAlong(LINE, 0), LINE[0])

  const quarter = interpolateAlong(LINE, 50) // halfway up leg 1
  near(quarter[1], LAT + 0.00045, 0.00002, 'lat at 50 m')
  near(quarter[0], 121.0, 0.000001, 'lng at 50 m')

  // A point on leg 2 should have moved east at the corner's latitude.
  const onLeg2 = interpolateAlong(LINE, 100 + 53.9)
  near(onLeg2[1], LAT + 0.0009, 0.00002, 'lat on leg 2')
  near(onLeg2[0], 121.0005, 0.00002, 'lng on leg 2')

  // Round trip: the point at distance d projects back to distance d.
  for (const d of [10, 75, 150, 250, total - 1]) {
    const hit = projectOnLine(LINE, interpolateAlong(LINE, d))
    near(hit.along, d, 1.5, 'round trip at ' + d + ' m')
  }
})

check('interpolateAlong clamps instead of overshooting', () => {
  const total = measureLine(LINE).total
  // Overshooting would make the simulator report a NEGATIVE distance remaining
  // once it ran past the destination.
  assert.deepStrictEqual(interpolateAlong(LINE, total + 5000), LINE[LINE.length - 1])
  assert.deepStrictEqual(interpolateAlong(LINE, -100), LINE[0])
  const past = interpolateAlong(LINE, total + 999)
  const p = routeProgress(ROUTE, { lat: past[1], lng: past[0] })
  assert.ok(p.remainingM >= 0, 'remaining never negative')
})

check('interpolateAlong survives junk', () => {
  assert.strictEqual(interpolateAlong(null, 10), null)
  assert.strictEqual(interpolateAlong([], 10), null)
  assert.deepStrictEqual(interpolateAlong([[1, 2]], 10), [1, 2])
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  failures.forEach((f) => console.error('  FAIL  ' + f))
  process.exit(1)
}
