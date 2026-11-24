import boundaryGeoJSON from '@geo/monticello_villas_boundary.geojson?raw'

// The canonical Monticello Villas premises polygon, read from the SAME file the
// Flutter app bundles as an asset (see vite.config.js's `@geo` alias and
// lib/core/config/subdivision_boundary.dart). Imported `?raw` and parsed here
// rather than as a JSON module so the file stays a plain .geojson that QGIS,
// geojson.io and OpenStreetMap tooling can all open and re-export in place.
const featureCollection = JSON.parse(boundaryGeoJSON)

export const BOUNDARY_FEATURE = featureCollection.features[0]

/** GeoJSON-ready source data for `map.addSource`. */
export const BOUNDARY_GEOJSON = featureCollection

/** Outer linear ring as `[lng, lat]` pairs, first position repeated at the end. */
export const BOUNDARY_RING = BOUNDARY_FEATURE.geometry.coordinates[0]

// ── Phase palette ─────────────────────────────────────────────────────────────
// One colour per subdivision phase, used everywhere a phase is shown: the map's
// per-phase fills, the Phase Coverage readout, and the metrics hotspot list.
//
// Deliberately a restrained oxblood -> gold -> neutral ramp rather than a
// rainbow. Phases are a NEUTRAL dimension — Phase 3 is not "worse" than Phase 1
// — so they must never borrow the severity colours (danger red, warning amber,
// success green), which already mean something specific on the same map. These
// are desaturated enough to sit under incident pins without competing with them.
/**
 * The phases that actually exist at Monticello Villas.
 *
 * There is no Phase 4 — the numbering skips it on the ground. It was present
 * in this map until now purely because the colour ramp was written as a
 * contiguous 1-5 range, which then leaked into every phase dropdown built
 * from these keys and offered guards an address that cannot be visited.
 *
 * Any legacy record still carrying phase "4" renders in PHASE_FALLBACK_COLOR
 * rather than disappearing — that is exactly what the fallback is for, and a
 * mis-keyed record should stay visible so it can be corrected.
 */
export const SUBDIVISION_PHASES = ['1', '2', '3', '5']

export const PHASE_COLORS = {
  '1': '#7F1D1D', // deep oxblood
  '2': '#A16207', // burnished gold
  '3': '#3F3F46', // dark neutral
  '5': '#6B5E3C', // antique brass
}

/** Fallback keeps an unknown/blank phase visible rather than transparent. */
export const PHASE_FALLBACK_COLOR = '#3F3F46'

export function phaseColor(phase) {
  const key = String(phase ?? '').trim()
  return PHASE_COLORS[key] ?? PHASE_FALLBACK_COLOR
}

/**
 * Mapbox `match` expression driving per-phase fills straight from the data.
 *
 * NOTE: the canonical GeoJSON currently contains ONE premises polygon with no
 * `phase` property, so today every feature takes the fallback. The moment
 * per-phase rings are added to assets/geo/monticello_villas_boundary.geojson
 * with a `phase` property, they colour themselves — no code change here.
 */
export function phaseFillExpression() {
  return [
    'match',
    ['to-string', ['get', 'phase']],
    ...Object.entries(PHASE_COLORS).flat(),
    PHASE_FALLBACK_COLOR,
  ]
}

// ── Styling ───────────────────────────────────────────────────────────────────
// Shared with the Flutter picker (subdivision_boundary.dart mirrors these), so
// the perimeter is the same colour and weight on a resident's phone as on the
// dispatcher's wall.
export const BOUNDARY_STYLE = {
  /** Oxblood core stroke. */
  stroke: '#3C0008',
  /** Gold casing drawn UNDER the core stroke. */
  casing: '#F5C451',
  fill: '#3C0008',
  fillOpacity: 0.07,
  coreWidth: 2.2,
  casingWidth: 5,
}

/**
 * Axis-aligned extent of the ring.
 *
 * Derived from the polygon rather than stored separately: a hand-maintained
 * bounding box is exactly the kind of duplicated geometry that silently
 * disagrees with the shape it is supposed to describe after someone re-traces
 * the boundary.
 */
export function boundaryBounds() {
  const lngs = BOUNDARY_RING.map(([lng]) => lng)
  const lats = BOUNDARY_RING.map(([, lat]) => lat)
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  }
}

/** `[[west, south], [east, north]]` — the shape Mapbox `maxBounds` expects. */
export function boundaryMaxBounds(paddingDeg = 0.0012) {
  const { west, south, east, north } = boundaryBounds()
  // A small pad so the perimeter line isn't flush against the viewport edge —
  // panning to inspect a lot on the boundary itself would otherwise be
  // impossible, since the camera centre can never leave the box.
  return [
    [west - paddingDeg, south - paddingDeg],
    [east + paddingDeg, north + paddingDeg],
  ]
}

/**
 * Point-in-polygon by ray casting (crossing number).
 *
 * Replaces a bounding-box containment test. The premises are not a rectangle —
 * Angela Avenue cuts the northern edge on a diagonal — so their bounding box
 * overshoots by ~13 ha into the fields and houses on the FAR side of the road.
 * A bbox check called all of that "inside Monticello Villas".
 *
 * Counts how many times a ray cast east from the point crosses an edge: odd
 * means inside. The `(lat < y0) !== (lat < y1)` form only counts edges that
 * genuinely straddle the ray, which is what avoids double-counting a vertex
 * that sits exactly on it.
 *
 * @param {{lat: number, lng: number}} point
 * @param {Array<[number, number]>} ring `[lng, lat]` pairs.
 */
export function containsPoint({ lat, lng }, ring = BOUNDARY_RING) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false

  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[j]
    if (lat < y0 !== lat < y1 && lng < x0 + ((lat - y0) / (y1 - y0)) * (x1 - x0)) {
      inside = !inside
    }
  }
  return inside
}

/** Centroid of the ring's extent — the default camera target for both portals. */
export function boundaryCenter() {
  const { west, south, east, north } = boundaryBounds()
  return [(west + east) / 2, (south + north) / 2]
}
