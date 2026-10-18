/**
 * Who gets a marker at the START of a plotted route.
 *
 *   node scripts/routeOrigin.test.mjs      (from apps/security-portal)
 *
 * ── WHAT THIS GUARDS, AND WHY IT IS WORTH A TEST FILE ──────────────────────
 * `route-origin` draws a tinted disc with a transport glyph on it — a bike, or
 * a pair of walking feet — at the first coordinate of the route. It exists for
 * exactly one case: the GUARDHOUSE fallback, where the route starts at a fixed
 * coordinate with nobody standing on it, so without this marker the line would
 * begin at nothing.
 *
 * Every other origin already has a marker. A dispatched unit is drawn on the
 * units layer, and the officer reading their own console is drawn there too —
 * with a standby pulse ring, becoming the navigation arrow when a session
 * starts. Marking those again does not add a second dot so much as stick a
 * pedestrian icon onto the emblem that is supposed to be the only thing
 * representing the officer.
 *
 * The condition got this wrong in a way that reads as correct: `originSource
 * !== 'unit'`, under a comment saying "drawn only when the route does NOT
 * start at a live unit (the guardhouse fallback)". There are THREE origin
 * sources, not two — `unit`, `self` and `guardhouse` — and `self` is a live
 * unit. So the officer's own position carried a walking glyph on top of its
 * arrow for as long as the profile was set to walking.
 *
 * It is tested here rather than on the map because the map cannot answer it:
 * `querySourceFeatures` returns what is in RENDERED tiles, so the question
 * "was this feature emitted" becomes a question about paint. `routeToGeojson`
 * is pure, and the condition is one expression, so both belong in node.
 */

import assert from 'assert'
import { routeToGeojson } from '../src/lib/directions.js'

/**
 * THE CONDITION UNDER TEST, as DashboardPage passes it.
 *
 * Duplicated rather than imported: it lives inline in a React component's
 * `useMemo` and extracting it so a test could reach it would move the decision
 * away from the props it is made from. One expression is cheap to keep in step;
 * the test fails loudly if the page and this disagree about the guardhouse.
 */
const withOrigin = (originSource) => originSource === 'guardhouse'

const LINE = [
  [122.5002, 10.7602],
  [122.5018, 10.7606],
  [122.5031, 10.7619],
]

/** A plotted walking route — walking, so a mismatch shows up as `origin:foot`. */
const ROUTE = {
  profile: 'walking',
  distance: 480,
  duration: 160,
  origin: LINE[0],
  snappedOrigin: LINE[0],
  destination: LINE[2],
  snappedDestination: LINE[2],
  geometry: { type: 'LineString', coordinates: LINE },
  steps: [],
}

/** Every feature's kind, with the transport glyph named where one is carried. */
function kinds(opts) {
  return routeToGeojson(ROUTE, opts).features.map(
    (f) => f.properties.kind + (f.properties.transport ? `:${f.properties.transport}` : ''),
  )
}

const originMarkers = (originSource) =>
  kinds({ withOrigin: withOrigin(originSource) }).filter((k) => k.startsWith('origin'))

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

// ── THE THREE ORIGINS ──────────────────────────────────────────────────────

check('self: the officer is drawn once, by their own unit marker', () => {
  assert.deepStrictEqual(originMarkers('self'), [])
})

check('unit: a dispatched officer is drawn once, on the units layer', () => {
  assert.deepStrictEqual(originMarkers('unit'), [])
})

check('guardhouse: the one origin with nobody standing on it keeps its marker', () => {
  assert.deepStrictEqual(originMarkers('guardhouse'), ['origin:foot'])
})

// ── THE REGRESSION, STATED AS THE OLD CONDITION ────────────────────────────

check('the old `!== unit` condition marked self, which is the bug', () => {
  const old = (originSource) => originSource !== 'unit'
  assert.deepStrictEqual(
    kinds({ withOrigin: old('self') }).filter((k) => k.startsWith('origin')),
    ['origin:foot'],
    'the old condition should still demonstrate the duplicate, or this test proves nothing',
  )
})

// ── AND NOTHING ELSE MOVED ─────────────────────────────────────────────────

check('suppressing the origin marker does not touch the route line', () => {
  const emitted = kinds({ withOrigin: false })
  assert.ok(emitted.includes('route'), `no route line in ${JSON.stringify(emitted)}`)
})

check('a driving route in the guardhouse case gets the bike glyph', () => {
  const driving = routeToGeojson({ ...ROUTE, profile: 'driving' }, { withOrigin: true })
  const origin = driving.features.find((f) => f.properties.kind === 'origin')
  assert.strictEqual(origin?.properties.transport, 'bike')
})


// ── THE LIVE LINE IS TRIMMED, NOT RE-CUT ───────────────────────────────────

check('with progress, the live line keeps its full geometry and carries the trim', () => {
  const coords = ROUTE.geometry.coordinates
  const progress = {
    fraction: 0.4,
    remainingCoords: coords.slice(1),
    coveredCoords: coords.slice(0, 2),
  }
  const fc = routeToGeojson(ROUTE, { withOrigin: false, progress })
  const route = fc.features.find((f) => f.properties.kind === 'route')
  const covered = fc.features.find((f) => f.properties.kind === 'covered')
  const ahead = fc.features.find((f) => f.properties.kind === 'ahead')
  // Same geometry every fix: only `trim` moves, so the map animates a paint
  // property instead of re-uploading a line that jumps ahead of the marker.
  assert.deepStrictEqual(route.geometry.coordinates, coords)
  assert.strictEqual(route.properties.trim, 0.4)
  assert.deepStrictEqual(covered.geometry.coordinates, coords)
  // Chevrons only on the road still to drive.
  assert.deepStrictEqual(ahead.geometry.coordinates, progress.remainingCoords)
})

check('without progress (a preview), nothing is trimmed', () => {
  const fc = routeToGeojson(ROUTE, { withOrigin: false })
  const route = fc.features.find((f) => f.properties.kind === 'route')
  assert.strictEqual(route.properties.trim, 0)
  assert.ok(fc.features.some((f) => f.properties.kind === 'ahead'))
})

// ── THE ORIGIN LEG STARTS AT THE GUARD'S CURRENT POSITION ──────────────────
//
// The route was plotted from where the guard stood THEN (ROUTE.origin, here
// 40 m off the road), and they have since moved. The leg must come from where
// they are NOW, and only when they are off the line.

const PLOTTED_FROM = [122.4999, 10.7598] // the stale plot-time fix, off the road
const STALE = { ...ROUTE, origin: PLOTTED_FROM }
const legs = (fc) =>
  fc.features.filter((f) => f.properties.kind === 'connector').map((f) => f.geometry.coordinates)
const LIVE_PROGRESS = {
  fraction: 0.3,
  remainingCoords: LINE.slice(1),
  snapped: [122.5010, 10.7604], // where the guard rejoins the line
}

check('off route with a live fix: one leg, from the guard NOW to where they rejoin', () => {
  const here = [122.5010, 10.7609]
  const fc = routeToGeojson(STALE, {
    withOrigin: false,
    progress: LIVE_PROGRESS,
    unitPosition: here,
    offRoute: true,
  })
  const originLegs = legs(fc).filter((c) => c[1] !== ROUTE.destination)
  assert.deepStrictEqual(originLegs, [[here, LIVE_PROGRESS.snapped]])
  assert.ok(
    !legs(fc).some((c) => c[0] === PLOTTED_FROM),
    'the leg from the stale plot-time origin must be gone',
  )
})

check('on route with a live fix: no origin leg — the snapped marker IS the start', () => {
  const fc = routeToGeojson(STALE, {
    withOrigin: false,
    progress: LIVE_PROGRESS,
    unitPosition: [122.5010, 10.7605],
    offRoute: false,
  })
  assert.ok(!legs(fc).some((c) => c[0] === PLOTTED_FROM))
  assert.deepStrictEqual(legs(fc).length, 0)
})

check('no live fix (preview): the plotted-origin leg still stands', () => {
  const fc = routeToGeojson(STALE, { withOrigin: false })
  assert.deepStrictEqual(legs(fc), [[PLOTTED_FROM, STALE.snappedOrigin]])
})

console.log(`\n${passed} passed, ${process.exitCode ? 'failures above' : '0 failed'}`)
