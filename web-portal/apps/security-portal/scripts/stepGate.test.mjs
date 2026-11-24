/**
 * The waypoint gate, under bare node.
 *
 *   node scripts/stepGate.test.mjs      (from apps/security-portal)
 *
 * ── WHY THIS IS THE MOST IMPORTANT TEST FILE HERE ──────────────────────────
 * This logic decides which turn an officer is told to take while driving to an
 * emergency. Every failure mode it guards against produces a CONFIDENT WRONG
 * INSTRUCTION — not a blank, not an error, a clearly-spoken direction to the
 * wrong road — and the officer has no way to tell one from the other at the
 * wheel.
 *
 * The case that motivated it cannot be eyeballed on a map and does not
 * reproduce on a straight test route: a route that passes near itself, where
 * projecting a fix onto the line has two correct answers and the plain
 * distance-along measure silently picks the far one. So the fixture below is
 * deliberately a loop.
 */

import assert from 'assert'
import { pathToFileURL } from 'url'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = await import(pathToFileURL(path.join(here, '..', 'src', 'lib', 'routeProgress.js')).href)
const { stepWaypoints, gateStepIndex, stepBoundaries, measureLine, routeProgress, WAYPOINT_RADIUS_M } = lib

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

// ── A LOOP, at Monticello's latitude. Out 200 m north, 200 m east, 200 m
// south, then back west to within ~22 m of where it started. The last leg
// passes close enough to the FIRST that a projection can confuse them, which
// is the whole point of the fixture.
const LAT = 10.76
const LNG = 122.5
const D_LAT = 0.0018 // ~200 m
const D_LNG = 0.00184 // ~200 m at this latitude
const LOOP = [
  [LNG, LAT],
  [LNG, LAT + D_LAT],
  [LNG + D_LNG, LAT + D_LAT],
  [LNG + D_LNG, LAT],
  [LNG + 0.0002, LAT], // ends ~22 m east of the start
]

const STEPS = [
  { instruction: 'Head north on Acacia Street', distance: 200, duration: 40, icon: 'depart' },
  { instruction: 'Turn right onto Phase 1 Main Road', distance: 200, duration: 40, icon: 'right' },
  { instruction: 'Turn right onto Narra Street', distance: 200, duration: 40, icon: 'right' },
  { instruction: 'Turn right onto the service road', distance: 180, duration: 36, icon: 'right' },
  { instruction: 'You have arrived', distance: 0, duration: 0, icon: 'arrive' },
]

const ROUTE = {
  geometry: { type: 'LineString', coordinates: LOOP },
  distance: 780,
  duration: 156,
  steps: STEPS,
}

const TOTAL = measureLine(LOOP).total
const BOUNDS = stepBoundaries(STEPS, TOTAL)
const WAYPOINTS = stepWaypoints(LOOP, BOUNDS)

const at = (lng, lat) => ({ lng, lat })

/**
 * Walk the route at a given sampling cadence and report the sequence of steps
 * the console accepted.
 *
 * The cadence is the point. Telemetry does not arrive every five metres: this
 * console's own interval is fifteen seconds, which at 40 km/h is 167 m
 * between fixes, and a gate that only works when sampled densely is a gate
 * that works in a test and strands a patrol car.
 */
function walk(metresPerFix) {
  let floor = 0
  let prev = null
  const seen = [0]
  for (let d = 0; d <= TOTAL + metresPerFix; d += metresPerFix) {
    const point = lib.interpolateAlong(LOOP, Math.min(d, TOTAL))
    const p = routeProgress(ROUTE, at(point[0], point[1]), { stepFloor: floor, prevPoint: prev })
    prev = p.snapped
    if (p.step.index !== floor) {
      assert.strictEqual(p.step.index, floor + 1, `jumped ${floor} -> ${p.step.index}`)
      floor = p.step.index
      seen.push(floor)
    }
  }
  return seen
}

check('stepWaypoints puts one point per step, on the line', () => {
  assert.strictEqual(WAYPOINTS.length, STEPS.length)
  WAYPOINTS.forEach((w, i) => {
    assert.ok(Array.isArray(w) && w.length === 2, `waypoint ${i} is a coordinate`)
  })
  // The last step ends at the end of the line.
  assert.deepStrictEqual(WAYPOINTS[WAYPOINTS.length - 1], LOOP[LOOP.length - 1])
})

check('THE LOOP BUG: a unit at the start does not get the last step', () => {
  // Standing at the origin. The final leg of the loop comes back to within
  // ~22 m, so the raw projection may put this unit near the END of the route.
  // Ungated, that is how an officer at the gate is told to make the last turn.
  const ungated = routeProgress(ROUTE, at(LNG, LAT))
  const gated = routeProgress(ROUTE, at(LNG, LAT), { stepFloor: 0 })

  assert.strictEqual(gated.step.index, 0, 'gated stays on step 1')
  assert.ok(
    gated.step.index <= ungated.step.index,
    'the gate can only ever hold the index back, never push it forward',
  )
})

check('a unit standing still never advances, however many fixes arrive', () => {
  // The literal "no premature step skipping" requirement: the same position
  // reported fifty times is fifty reasons to stay exactly where you are.
  // On THIS fixture the projection is actively arguing otherwise — the loop
  // comes back to within ~22 m of the start — so every one of those fifty
  // fixes is a chance to be wrong.
  let floor = 0
  let prev = null
  for (let i = 0; i < 50; i += 1) {
    // ±4 m of GPS jitter, the amount a stationary phone reports.
    const jitter = (i % 5) * 0.00002 - 0.00004
    const p = routeProgress(ROUTE, at(LNG + jitter, LAT + jitter), { stepFloor: floor, prevPoint: prev })
    prev = p.snapped
    floor = p.step.index
  }
  assert.strictEqual(floor, 0, 'still on step 1 after 50 stationary fixes')
})

check('arriving at the first corner advances exactly one step', () => {
  const corner = LOOP[1]
  // Just past it, so the projection has actually crossed the boundary — at
  // the corner exactly, `along` equals the boundary and the candidate is
  // still 0 (see the arrival note at the bottom of this file).
  const past = lib.interpolateAlong(LOOP, BOUNDS[0] + 10)
  const p = routeProgress(ROUTE, at(past[0], past[1]), {
    stepFloor: 0,
    prevPoint: lib.interpolateAlong(LOOP, BOUNDS[0] - 40),
  })
  assert.strictEqual(p.step.index, 1)
  // And the radius test on its own reaches the same answer, from standing
  // still at the corner with no journey behind it.
  assert.strictEqual(
    gateStepIndex({ current: 0, candidate: 1, waypoints: WAYPOINTS, point: corner }),
    1,
  )
})

check('stopping SHORT of the corner does not advance', () => {
  // 60 m south of the first corner — outside the gate radius, and the
  // projection has not crossed the boundary either, so the console must
  // still be on step 1.
  const shy = [LOOP[1][0], LOOP[1][1] - 0.00054]
  const p = routeProgress(ROUTE, at(shy[0], shy[1]), { stepFloor: 0, prevPoint: LOOP[0] })
  assert.strictEqual(p.step.index, 0, 'held on step 1')
  near(p.waypointM, 60, 8, 'distance to the corner')
})

check('the gate radius is what decides, measured', () => {
  const corner = WAYPOINTS[0]
  // Just inside and just outside WAYPOINT_RADIUS_M, built from the constant
  // so this test follows the constant rather than pinning a stale number.
  const metresToLat = 1 / 111_195
  const inside = gateStepIndex({
    current: 0,
    candidate: 1,
    waypoints: WAYPOINTS,
    point: [corner[0], corner[1] - (WAYPOINT_RADIUS_M - 5) * metresToLat],
  })
  const outside = gateStepIndex({
    current: 0,
    candidate: 1,
    waypoints: WAYPOINTS,
    point: [corner[0], corner[1] - (WAYPOINT_RADIUS_M + 5) * metresToLat],
  })
  assert.strictEqual(inside, 1, 'inside the radius advances')
  assert.strictEqual(outside, 0, 'outside it does not')
})

check('one step per call, even from a wild projection', () => {
  // A fix that genuinely belongs at the end of the route still only moves the
  // console on by one — and only because it is standing on corner 1.
  assert.strictEqual(
    gateStepIndex({ current: 0, candidate: 4, waypoints: WAYPOINTS, point: WAYPOINTS[0] }),
    1,
  )
})

check('THE CADENCE TRAP: the gate works at every sampling rate', () => {
  // A radius test alone passes at 5 m per fix and fails at every realistic
  // one. Measured before this was written: walked at 167 m per fix, a
  // radius-only gate reached step 1 and stayed there for all 780 m, because
  // the 50 m window around each corner is sampled about one time in four.
  //
  // 5 m is a brisk walk between fixes. 50 m is a patrol car on this
  // console's cadence in a 20 km/h zone. 167 m is 40 km/h at the configured
  // fifteen seconds. 300 m is a heartbeat that slipped. All four must reach
  // the last driving step, one at a time, in order.
  ;[5, 25, 50, 167, 300].forEach((cadence) => {
    assert.deepStrictEqual(walk(cadence), [0, 1, 2, 3], `at ${cadence} m per fix`)
  })
})

check('travel alone cannot advance a unit that has not travelled', () => {
  // The second test is "moved at least as far as the corner was away", and
  // its whole job is to be false for somebody sitting still. A metre of
  // jitter against a 200 m corner is not an arrival.
  assert.strictEqual(
    gateStepIndex({
      current: 0,
      candidate: 3,
      waypoints: WAYPOINTS,
      point: [LNG + 0.00001, LAT],
      prevPoint: [LNG, LAT],
    }),
    0,
  )
})

check('the first fix of a route never advances', () => {
  // No previous point means no journey, and a position on its own says
  // nothing about where the unit has been. A console that has just plotted a
  // route is on step one by definition.
  assert.strictEqual(
    gateStepIndex({ current: 0, candidate: 4, waypoints: WAYPOINTS, point: WAYPOINTS[2] }),
    0,
  )
})

check('the index never goes backwards', () => {
  // Drifting back across a boundary at a junction must not re-announce the
  // turn the officer is mid-way through making.
  assert.strictEqual(
    gateStepIndex({ current: 3, candidate: 1, waypoints: WAYPOINTS, point: WAYPOINTS[3] }),
    3,
  )
  const p = routeProgress(ROUTE, at(LNG, LAT), { stepFloor: 3 })
  assert.strictEqual(p.step.index, 3, 'a fix back at the start cannot rewind the card')
})

check('arriving sits on the last DRIVING step, with arrival as its upcoming', () => {
  // "You have arrived" carries distance 0, so its span on the line is empty
  // and `activeStep` can never make it current by distance — `along` would
  // have to exceed a boundary equal to the length of the whole line.
  //
  // That is not a defect and the gate did not cause it. It is what produces
  // the right card at the right moment: on the final leg the console sits on
  // step 4 with `upcoming` = "You have arrived", so the banner counts
  // down 80 m... 30 m... to the arrival instruction, which is exactly what a
  // driver wants to see. A separate index for "finished" would show a
  // countdown to nothing.
  //
  // Pinned because the walk above stops one step short of `steps.length - 1`
  // and, without this, reads as a gate stranding a unit on the last turn.
  // Arrival itself is announced off `remainingM` (see useVoiceGuidance), not
  // off this index.
  const end = LOOP[LOOP.length - 1]
  const p = routeProgress(ROUTE, at(end[0], end[1]), { stepFloor: 3, prevPoint: WAYPOINTS[2] })
  assert.strictEqual(p.step.index, 3, 'the last driving step')
  assert.strictEqual(p.step.upcoming, STEPS[4], 'pointing at the arrival line')
  near(p.remainingM, 0, 1, 'nothing left to travel')
  near(p.step.distanceToManeuver, 0, 1, 'and nothing left to the corner')
})

check('without a stepFloor the behaviour is exactly what it was', () => {
  // The pure/unlatched path is what the existing suite and any non-navigating
  // reader use, and it must not have changed.
  const a = routeProgress(ROUTE, at(LNG, LAT + D_LAT / 2))
  const b = routeProgress(ROUTE, at(LNG, LAT + D_LAT / 2), {})
  assert.strictEqual(a.step.index, b.step.index)
  assert.strictEqual(a.waypointM, null, 'no waypoint figure when not latching')
})

check('the gated step object stays internally consistent', () => {
  // A half-updated step is a card reading "turn right" over a countdown
  // belonging to a different corner.
  const shy = [LOOP[1][0], LOOP[1][1] - 0.00054]
  const p = routeProgress(ROUTE, at(shy[0], shy[1]), { stepFloor: 0, prevPoint: LOOP[0] })
  const { index, step, upcoming, isLast, distanceToManeuver } = p.step
  assert.strictEqual(step, STEPS[index], 'step matches the index')
  assert.strictEqual(upcoming, STEPS[index + 1], 'upcoming is the next one')
  assert.strictEqual(isLast, false)
  assert.ok(distanceToManeuver > 0, 'a positive countdown')
  near(distanceToManeuver, 60, 10, 'counts down to the corner it names')
})

check('gateStepIndex survives junk', () => {
  assert.strictEqual(gateStepIndex({}), 0)
  assert.strictEqual(gateStepIndex({ current: 2, candidate: NaN, waypoints: WAYPOINTS, point: WAYPOINTS[2] }), 2)
  assert.strictEqual(gateStepIndex({ current: 0, candidate: 1, waypoints: [], point: [LNG, LAT] }), 0)
  assert.strictEqual(gateStepIndex({ current: 0, candidate: 1, waypoints: WAYPOINTS, point: null }), 0)
  assert.strictEqual(
    gateStepIndex({ current: 0, candidate: 1, waypoints: WAYPOINTS, point: [LNG, LAT], prevPoint: 'nope' }),
    0,
  )
  assert.deepStrictEqual(stepWaypoints(null, BOUNDS), [])
  assert.deepStrictEqual(stepWaypoints(LOOP, null), [])
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  failures.forEach((f) => console.error('  FAIL  ' + f))
  process.exit(1)
}
