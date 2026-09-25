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
 * @returns {null | object} null when there is nothing to measure against.
 */
export function routeProgress(route, position) {
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
  const step = activeStep(route.steps, boundaries, along)
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
    bearing: bearingAt(coords, hit.index),
    step,
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

export function isOffRoute(progress) {
  return Boolean(progress) && progress.offsetM > OFF_ROUTE_METERS
}
