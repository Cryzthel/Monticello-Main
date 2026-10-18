/**
 * Where along the plotted route a unit actually is, and what is left.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 * The Directions response is fixed at the moment it was requested: 680 m, 2
 * min, eleven maneuvers. None of that is true a minute later once the unit has
 * moved. This projects the unit's real position onto the route line and
 * derives the live figures from it — distance left, ETA left, which maneuver
 * is next and how far to it, and where to split the line into the part already
 * driven and the part still ahead.
 *
 * ── DERIVED FROM A REAL FIX, NEVER INVENTED ─────────────────────────────────
 * Every number here is a function of a position this console was given. The
 * unit does not advance because time passed; it advances because a new fix
 * arrived. A dispatch map that animates a guard along a road they are not on
 * is worse than one that shows a stale dot, because the stale dot is at least
 * somewhere the guard has been.
 *
 * ── PURE ────────────────────────────────────────────────────────────────────
 * No clock, no network, no Mapbox. `scripts/routeProgress.test.mjs` runs it
 * under bare node.
 */

const R = 6371008.8
const DEG = Math.PI / 180

/**
 * Local planar coordinates in metres, for segment maths.
 *
 * Equirectangular about a reference latitude rather than great-circle: a
 * subdivision is under two kilometres across, where the error is centimetres,
 * and projecting a point onto a segment needs plane geometry — doing it on a
 * sphere would cost real complexity to answer the same question.
 */
function projector(lat0) {
  const k = Math.cos(lat0 * DEG) * R * DEG
  const m = R * DEG
  return ([lng, lat]) => [lng * k, lat * m]
}

/** Metres between two `[lng, lat]` pairs, using the same local projection. */
function planarDistance(a, b, project) {
  const [ax, ay] = project(a)
  const [bx, by] = project(b)
  return Math.hypot(bx - ax, by - ay)
}

/**
 * Cumulative length of the line, and the length of each segment.
 * Returned together because every caller needs both and walking the line twice
 * is the kind of thing that turns into a per-frame cost.
 */
export function measureLine(coords) {
  const segments = []
  let total = 0
  if (!Array.isArray(coords) || coords.length < 2) return { segments, total }
  const project = projector(coords[0][1])
  for (let i = 0; i < coords.length - 1; i += 1) {
    const d = planarDistance(coords[i], coords[i + 1], project)
    segments.push(d)
    total += d
  }
  return { segments, total }
}

/**
 * The closest point on the line to `point`.
 *
 * @returns {{ index: number, t: number, along: number, offset: number, point: [number, number] }}
 *   `index`/`t` locate it on segment `index` at fraction `t`; `along` is metres
 *   from the start; `offset` is how far the unit is from the line, which is how
 *   a caller tells "on the road" from "cutting through the village green".
 */
export function projectOnLine(coords, point) {
  if (!Array.isArray(coords) || coords.length < 2 || !point) return null
  const project = projector(coords[0][1])
  const p = project(point)

  let best = { index: 0, t: 0, offset: Infinity, along: 0, point: coords[0] }
  let travelled = 0

  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = project(coords[i])
    const b = project(coords[i + 1])
    const vx = b[0] - a[0]
    const vy = b[1] - a[1]
    const len2 = vx * vx + vy * vy
    const segLen = Math.sqrt(len2)

    // A zero-length segment (duplicate coordinate — Mapbox emits them at
    // maneuvers) has no direction to project onto; its start point stands in.
    let t = 0
    if (len2 > 0) {
      t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2
      t = Math.min(1, Math.max(0, t))
    }

    const cx = a[0] + vx * t
    const cy = a[1] + vy * t
    const offset = Math.hypot(p[0] - cx, p[1] - cy)

    if (offset < best.offset) {
      const [lngA, latA] = coords[i]
      const [lngB, latB] = coords[i + 1]
      best = {
        index: i,
        t,
        offset,
        along: travelled + segLen * t,
        point: [lngA + (lngB - lngA) * t, latA + (latB - latA) * t],
      }
    }
    travelled += segLen
  }

  return best
}

/** Split the line at `index`/`t`, inserting the split point into both halves. */
export function splitLine(coords, index, t) {
  if (!Array.isArray(coords) || coords.length < 2) return { covered: [], remaining: coords ?? [] }
  const i = Math.min(Math.max(0, index), coords.length - 2)
  const [lngA, latA] = coords[i]
  const [lngB, latB] = coords[i + 1]
  const at = [lngA + (lngB - lngA) * t, latA + (latB - latA) * t]
  return {
    covered: [...coords.slice(0, i + 1), at],
    remaining: [at, ...coords.slice(i + 1)],
  }
}

/** Compass bearing in degrees along the line at `index`, for pointing a marker. */
export function bearingAt(coords, index) {
  if (!Array.isArray(coords) || coords.length < 2) return 0
  const i = Math.min(Math.max(0, index), coords.length - 2)
  const [lng1, lat1] = coords[i]
  const [lng2, lat2] = coords[i + 1]
  const y = Math.sin((lng2 - lng1) * DEG) * Math.cos(lat2 * DEG)
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lng2 - lng1) * DEG)
  return (Math.atan2(y, x) / DEG + 360) % 360
}

/** Metres of road behind and ahead of the unit that [bearingAlong] reads. */
export const BEARING_BEHIND_M = 5
export const BEARING_AHEAD_M = 15

/**
 * The direction of travel at `alongM` metres down the line, read over a short
 * stretch of road rather than off the single segment underneath.
 *
 * ── WHY NOT JUST THE SEGMENT ───────────────────────────────────────────────
 * `bearingAt(coords, hit.index)` was the arrow's source, and it failed in two
 * ways a guard could see:
 *
 *   • ZERO-LENGTH SEGMENTS. Mapbox emits a duplicate coordinate at every
 *     maneuver. A fix that projected onto one got `atan2(0, 0)` — due north —
 *     so the arrow flicked to point up the screen at exactly the corners it
 *     mattered most, and on a southbound street that read as inverted.
 *   • CORNERS. The bearing switched in one frame as the snapped point crossed
 *     a vertex, so the arrow jumped 90° instead of turning.
 *
 * Measuring from a point a few metres behind to one further ahead (the Turf
 * `bearing(along(-5), along(+15))` idea) skips degenerate segments by
 * construction and rotates progressively through a bend, starting just
 * before it. Weighted ahead because the arrow should show where the road is
 * GOING. Both points are on the plotted line, so nothing is extrapolated.
 */
export function bearingAlong(coords, alongM) {
  if (!Array.isArray(coords) || coords.length < 2) return 0
  const from = interpolateAlong(coords, alongM - BEARING_BEHIND_M)
  const to = interpolateAlong(coords, alongM + BEARING_AHEAD_M)
  if (from && to && (from[0] !== to[0] || from[1] !== to[1])) {
    return bearingAt([from, to], 0)
  }
  // Degenerate (a route shorter than the window, every point identical):
  // the first segment that actually has a direction.
  for (let i = 0; i < coords.length - 1; i += 1) {
    const [a, b] = [coords[i], coords[i + 1]]
    if (a[0] !== b[0] || a[1] !== b[1]) return bearingAt(coords, i)
  }
  return 0
}

/**
 * Where each step ends, in metres from the start of the route.
 *
 * Mapbox's per-step distances and the geometry's own length disagree by a
 * metre or two — different rounding on the same road — so the step distances
 * are scaled to the geometry rather than used raw. Without that the last step
 * ends slightly before or after the line does, and "distance to the next
 * maneuver" goes negative just as the unit arrives, which is the worst moment
 * for the number to misbehave.
 */
export function stepBoundaries(steps, totalM) {
  if (!Array.isArray(steps) || steps.length === 0) return []
  const sum = steps.reduce((acc, s) => acc + (Number.isFinite(s.distance) ? s.distance : 0), 0)
  const scale = sum > 0 && Number.isFinite(totalM) && totalM > 0 ? totalM / sum : 1
  const ends = []
  let acc = 0
  steps.forEach((s) => {
    acc += (Number.isFinite(s.distance) ? s.distance : 0) * scale
    ends.push(acc)
  })
  return ends
}

/**
 * How close the unit has to physically get to a maneuver before the console
 * accepts that they have reached it.
 *
 * ── WHY A RADIUS GATE EXISTS AT ALL ─────────────────────────────────────────
 * The step index used to be a pure function of `along` — distance travelled
 * measured by projecting the fix onto the line — and that is correct right up
 * until the route passes near itself, which inside a subdivision grid is most
 * routes. `projectOnLine` returns the GLOBALLY closest point, so a unit
 * standing at the guardhouse on a street the route comes back down can project
 * onto a segment eight maneuvers ahead. The console then announces "turn left
 * onto Lot 12 driveway" to an officer who has not left the gate.
 *
 * Nothing about that is a timer, and no amount of removing timers fixes it. It
 * is the projection being asked a question it cannot answer: "which part of
 * this line is the unit on" has two right answers whenever the line is near
 * itself, and distance alone cannot choose between them.
 *
 * The gate chooses. A step is only completed once the unit has been physically
 * within this radius of where that maneuver happens. A projection onto a later
 * segment no longer advances anything by itself, because the waypoints between
 * here and there were never visited.
 *
 * 25 m, against OFF_ROUTE_METERS' 45. It is deliberately the tighter of the
 * two: 45 m is "is this unit still on this route at all", which must tolerate
 * GPS drift in both directions, while this is "has this unit actually been at
 * that corner", which should not. At a subdivision junction 25 m is the
 * junction and a little of each road into it.
 */
export const WAYPOINT_RADIUS_M = 25

/**
 * Where each step's maneuver physically happens: the point on the line at that
 * step's boundary, as `[lng, lat]`.
 *
 * Derived from the GEOMETRY rather than read off the Directions response,
 * which does carry a `maneuver.location` per step. That location is snapped to
 * the road graph and the boundaries here are scaled to the geometry's own
 * length (see `stepBoundaries`), so the two disagree by a few metres — and the
 * gate below compares a distance against a radius, which is exactly the
 * measurement a few metres of disagreement corrupts. One source for both.
 */
export function stepWaypoints(coords, boundaries) {
  if (!Array.isArray(coords) || coords.length < 2 || !Array.isArray(boundaries)) return []
  return boundaries.map((end) => interpolateAlong(coords, end))
}

/**
 * The step the unit is on, given where the projection says they are, where
 * they were last time, and where the corners actually are.
 *
 * Three rules, and the third one is not optional however much it looks like
 * an optimisation:
 *
 *   MONOTONIC. The index never decreases within one route. A fix that drifts
 *   back across a boundary while an officer waits at a junction would
 *   otherwise re-announce the turn they are mid-way through making, and
 *   re-arm every voice prompt for the step behind them.
 *
 *   ONE STEP AT A TIME. Even a fix that lands on the far end of the route can
 *   only move the console forward by one. This is the half that bounds the
 *   damage from a bad projection: eight maneuvers cannot be skipped in a
 *   single update, whatever the geometry does.
 *
 *   REACHED, OR TRAVELLED FAR ENOUGH TO HAVE REACHED. Explained below.
 *
 * ── WHY THE 25 m RADIUS CANNOT BE THE ONLY TEST ────────────────────────────
 * The obvious gate — "advance when the unit is within 25 m of this step's
 * corner" — is what the brief asks for and, on its own, it strands every
 * moving vehicle on step one for the whole call. Measured, not predicted: a
 * patrol at 40 km/h with this console's own 15-second telemetry cadence moves
 * 167 m between fixes, so the 50 m window around each corner is sampled
 * roughly one time in four. Walked at that cadence the gated index reached
 * step 1 and stopped there for all 780 m of the route.
 *
 * That failure is worse than the one the gate exists to fix. A unit told the
 * wrong turn at least has a console that is trying; a unit whose instructions
 * froze at the gate has one that has silently stopped navigating, and the
 * officer finds out at the junction.
 *
 * So arriving within the radius is ONE way to complete a step — the direct
 * one, and the only one that applies to somebody on foot or crawling in
 * traffic. The other is physical travel: if the unit has covered at least as
 * much ground since the last fix as the corner was away from it at that fix,
 * then it has been there, whether or not anybody sampled the moment.
 *
 * ── WHAT THAT SECOND TEST ACTUALLY RULES OUT ───────────────────────────────
 * The case the whole gate exists for is a unit standing still whose position
 * projects onto a far part of a route that loops back past it. The projection
 * says step 8; the officer has not left the gate. Straight-line travel since
 * the last fix is a metre or two of GPS noise, the first corner is 200 m
 * away, and 2 >= 175 is false — so the console stays on step one, through any
 * number of fixes, which is exactly right.
 *
 * It is deliberately a STRAIGHT-LINE comparison on both sides. Distance along
 * the route is the quantity the bad projection has already corrupted, so
 * using it to validate itself would prove nothing.
 *
 * @returns {number} the accepted index
 */
export function gateStepIndex({
  current = 0,
  candidate = 0,
  waypoints = [],
  point,
  prevPoint = null,
  radiusM = WAYPOINT_RADIUS_M,
}) {
  const floor = Number.isFinite(current) && current > 0 ? current : 0
  if (!Number.isFinite(candidate) || candidate <= floor) return floor

  // The corner the CURRENT step ends at — not the candidate's, which is the
  // question that would let one fix skip the gap between them.
  const waypoint = waypoints[floor]
  if (!waypoint || !Array.isArray(point)) return floor

  const project = projector(waypoint[1])
  if (planarDistance(waypoint, point, project) <= radiusM) return floor + 1

  // The first fix of a route is a position, not a journey, and nothing can be
  // concluded from it about where the unit has been. Holding here is also what
  // makes the opening state correct: a console that has just plotted a route
  // is on step one by definition.
  if (!Array.isArray(prevPoint)) return floor

  const moved = planarDistance(prevPoint, point, project)
  const wasAway = planarDistance(prevPoint, waypoint, project)
  // `- radiusM` on the right: having come within the radius of the corner is
  // already enough, so travel that gets the unit that close counts too.
  // Without it the two tests would disagree about the same arrival.
  return moved >= wasAway - radiusM ? floor + 1 : floor
}

/**
 * The maneuver the unit is approaching, and how far to it.
 *
 * The step whose span CONTAINS the unit is the one being travelled, so the
 * instruction to show is the NEXT one — the thing they are about to do. Google
 * reads the same way: you are on the road the current step put you on, and the
 * card tells you what happens at the end of it.
 */
export function activeStep(steps, boundaries, along) {
  if (!Array.isArray(steps) || steps.length === 0) return null

  let index = boundaries.findIndex((end) => along < end)
  if (index === -1) index = steps.length - 1

  const end = boundaries[index]
  const distanceToManeuver = Math.max(0, end - along)
  const next = steps[index + 1] ?? null

  return {
    /** The step being travelled. */
    index,
    step: steps[index],
    /** The instruction at the END of the current step — what to do next. */
    upcoming: next ?? steps[index],
    distanceToManeuver,
    isLast: index >= steps.length - 1,
  }
}

/**
 * Everything the navigation card and the map need, from one fix.
 *
 * @param {{ geometry: { coordinates: Array }, distance: number, duration: number, steps: Array }} route
 * @param {{ lat: number, lng: number }} position
 * @param {{ stepFloor?: number, prevPoint?: Array, waypointRadiusM?: number }} [options]
 *   `stepFloor` is the furthest step the caller has already accepted and
 *   `prevPoint` the `[lng, lat]` it was accepted at. Pass both back on every
 *   call and the index becomes monotonic and physically gated (see
 *   `gateStepIndex`); omit them and the step is the raw projection, which is
 *   what the pure unit tests and any non-navigating reader want.
 * @returns {null | object} null when there is nothing to measure against.
 */
export function routeProgress(
  route,
  position,
  { stepFloor = null, prevPoint = null, waypointRadiusM = WAYPOINT_RADIUS_M } = {},
) {
  const coords = route?.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return null

  const { total } = measureLine(coords)
  if (!(total > 0)) return null

  const lat = position?.lat
  const lng = position?.lng
  const hasFix = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
  if (!hasFix) return null

  const hit = projectOnLine(coords, [lng, lat])
  if (!hit) return null

  const along = Math.min(total, Math.max(0, hit.along))
  const remaining = total - along
  const fraction = total > 0 ? along / total : 0

  // Duration scales with the distance left rather than being recomputed: the
  // route's own average speed is the only speed this console actually knows,
  // and a per-fix speed estimate from two GPS points swings wildly enough to
  // make an ETA jump around by minutes.
  const duration = Number.isFinite(route.duration) ? route.duration : null
  const remainingDuration = duration == null ? null : duration * (1 - fraction)

  const boundaries = stepBoundaries(route.steps, total)
  let step = activeStep(route.steps, boundaries, along)

  /**
   * The gate, applied only when the caller is latching.
   *
   * Re-derived through `activeStep` rather than patched onto the object,
   * because `upcoming`, `isLast` and `distanceToManeuver` all hang off the
   * index and a half-updated step is a card that says "turn right" over a
   * countdown belonging to a different corner. Feeding the gated index back
   * through the same function is what keeps the five fields consistent.
   *
   * `distanceToManeuver` is then measured from the unit's position ALONG the
   * line to the gated step's end, which is what it already meant — the only
   * thing that changed is which step is current.
   */
  const waypoints = stepFloor == null ? [] : stepWaypoints(coords, boundaries)
  if (stepFloor != null && step) {
    const index = gateStepIndex({
      current: stepFloor,
      candidate: step.index,
      waypoints,
      // The SNAPPED point on both sides, not the raw fix. The waypoints are
      // on the line, so measuring from a fix that sits 20 m off the
      // carriageway would add that offset to every comparison and make the
      // radius effectively 5 m on one side of the road and 45 on the other.
      point: hit.point,
      prevPoint,
      radiusM: waypointRadiusM,
    })
    if (index !== step.index) {
      const end = boundaries[index]
      step = {
        index,
        step: route.steps[index],
        upcoming: route.steps[index + 1] ?? route.steps[index],
        distanceToManeuver: Math.max(0, end - along),
        isLast: index >= route.steps.length - 1,
      }
    }
  }

  const { covered, remaining: ahead } = splitLine(coords, hit.index, hit.t)

  return {
    /** Metres travelled along the line, and left on it. */
    traveledM: along,
    remainingM: remaining,
    fraction,
    remainingDurationS: remainingDuration,
    /** How far the unit is from the line — large means off-route. */
    offsetM: hit.offset,
    /** The unit snapped onto the road, which is where the marker belongs. */
    snapped: hit.point,
    bearing: bearingAlong(coords, along),
    /**
     * How far off the line this fix may sit and still be snapped onto it —
     * see [offRouteLimit]. Carried on the result so every reader of
     * `isOffRoute` judges the same fix by the same yardstick.
     */
    offRouteLimitM: offRouteLimit(position?.accuracy),
    step,
    /**
     * Metres from the unit to the CURRENT step's corner, in a straight line —
     * not along the route.
     *
     * `step.distanceToManeuver` is the along-the-line figure and is the one to
     * show a driver, because it is how far they will travel. This is the one
     * the gate judges on, and the two differ by however much the road bends.
     * Surfaced so a reader can see why the console has not advanced yet.
     */
    waypointM:
      stepFloor != null && waypoints[step?.index ?? 0]
        ? planarDistance(waypoints[step.index], hit.point, projector(hit.point[1]))
        : null,
    coveredCoords: covered,
    remainingCoords: ahead,
  }
}

/**
 * The point `distanceM` along the line.
 *
 * Used by the route simulator to walk a pretend unit down the real geometry —
 * so the fake positions are at least positions ON the road, and every figure
 * derived from them goes through exactly the same code a real fix would.
 * Clamps at both ends rather than extrapolating: a simulation that overshoots
 * the destination would report a negative distance remaining.
 */
export function interpolateAlong(coords, distanceM) {
  if (!Array.isArray(coords) || coords.length === 0) return null
  if (coords.length === 1) return coords[0]

  const { segments, total } = measureLine(coords)
  if (!(total > 0)) return coords[0]

  const target = Math.min(Math.max(0, distanceM), total)
  let walked = 0
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (walked + seg >= target) {
      const t = seg > 0 ? (target - walked) / seg : 0
      const [lngA, latA] = coords[i]
      const [lngB, latB] = coords[i + 1]
      return [lngA + (lngB - lngA) * t, latA + (latB - latA) * t]
    }
    walked += seg
  }
  return coords[coords.length - 1]
}

/**
 * Past this far from the line, the unit is not on this route any more.
 *
 * 45 m is deliberately loose. A phone's fix inside a built-up subdivision
 * drifts 20-30 m routinely, and the cost of the two errors is not symmetric:
 * flapping "off route" at a guard who is on the road teaches them to ignore
 * the card, while a late reroute costs a few seconds of a wrong line.
 */
export const OFF_ROUTE_METERS = 45

/**
 * The most the tolerance ever widens to, however rough the fix.
 *
 * ── WHY THE TOLERANCE FOLLOWS THE FIX ──────────────────────────────────────
 * A fixed 45 m was tuned for a phone's GPS. A console on Wi-Fi positioning
 * reports ±120 m or worse (the screenshot that prompted this said ±126 m), and
 * a fix that rough lands 60–90 m off the road while the officer is on it —
 * so the marker was drawn through back gardens, labelled off route, and
 * jumped about as each reading wandered. A fix whose own error circle still
 * contains the road is consistent with being ON it, so the tolerance is the
 * reported accuracy, floored at the GPS-tuned 45 m.
 *
 * Capped, because past ~100 m a position cannot tell one street from the next
 * in this subdivision, and snapping a genuinely wrong-way officer onto the
 * line would hide exactly the mistake off-route detection exists to catch.
 */
export const OFF_ROUTE_MAX_METERS = 100

/** The off-route tolerance for a fix that reports `accuracyM`. */
export function offRouteLimit(accuracyM) {
  if (!Number.isFinite(accuracyM) || accuracyM <= OFF_ROUTE_METERS) return OFF_ROUTE_METERS
  return Math.min(OFF_ROUTE_MAX_METERS, accuracyM)
}

export function isOffRoute(progress) {
  if (!progress) return false
  const limit = Number.isFinite(progress.offRouteLimitM) ? progress.offRouteLimitM : OFF_ROUTE_METERS
  return progress.offsetM > limit
}
