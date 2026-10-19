// Map layers, marker images, hit-testing and constants for IncidentMap.
//
// Moved verbatim out of IncidentMap.jsx (2026-10-20) so the component file
// holds the component. Nothing here touches React: every function takes the
// Mapbox map (and refs it is handed) and works on it directly.

import mapboxgl from 'mapbox-gl'
import { Bike, Footprints, Map as MapIcon, Satellite } from '@shared/icons'
import { RESPONSE_PHASE_COLORS, EMERGENCY_COLORS } from '@shared/lib/wpda'
import { NAV_MARKER_COLORS, ROUTE_TONE_COLORS, UNIT_COLORS } from '@shared/theme/dispatchColors'
import {
  BOUNDARY_GEOJSON,
  BOUNDARY_STYLE,
  boundaryCenter,
  phaseFillExpression,
} from '@shared/lib/subdivisionBoundary'

// Derived from the boundary polygon itself, so re-tracing the perimeter also
// re-centres both maps. This was previously a hardcoded pair of coordinates in
// Metro Manila — roughly 500 km from Monticello Villas — carrying a TODO.
export const SUBDIVISION_CENTER = boundaryCenter()

export const SOURCE_ID = 'incident-points'
const BOUNDARY_SOURCE_ID = 'subdivision-boundary'
export const PANIC_SOURCE_ID = 'panic-points'

/**
 * ── HOW FAR EACH PULSE TRAVELS, AS A CONSTANT ──────────────────────────────
 *
 * These were inline magic numbers in the animation interval (`pinRadius + t *
 * 18`, `10 + t * 22`). They are named now because a SECOND thing reads them:
 * the invisible hit-target layers, which have to be exactly as wide as the
 * ring a dispatcher can see, or the map lies about what is clickable.
 *
 * Deriving both from one constant is the whole point. A hit disc narrower than
 * the ring leaves a dead band inside the visible marker; a wider one arms
 * empty space and steals clicks meant for the map underneath.
 */
export const INCIDENT_PULSE_REACH = 18
export const PANIC_BASE_RADIUS = 10
export const PANIC_PULSE_REACH = 22

/**
 * The zoom a marker click will not go below.
 *
 * A FLOOR, not a target — and that distinction is the fix for the jumpy
 * camera. Clicking a pin used to move nothing at all; the only camera move on
 * this map was Locate, which flies to a fixed z17 and therefore yanks an
 * operator working at estate scale five levels in.
 *
 * Centring on click keeps whatever zoom the operator chose, and only raises it
 * when they are so far out that a marker is a speck. Since the map opens
 * fitted to the boundary (~z15-16), in day-to-day use the zoom never changes
 * at all: a click pans, and nothing else.
 */
const FOCUS_ZOOM_FLOOR = 15

/**
 * Horizontal space the open controls panel takes from the left of the map, in
 * px: its `left-3` inset, its `w-[15rem]` width, and a 12px gutter. Used where
 * the camera places something for the operator to look at — a clicked marker,
 * a fitted route — so it lands beside the panel rather than beneath it.
 */
export const CONTROL_PANEL_CLEARANCE = 264

/**
 * Centre a clicked marker, allowing for a panel that covers one edge.
 *
 * `easeTo`, never `flyTo`. flyTo arcs — it zooms OUT, translates, then zooms
 * back in — which is legible for a long deliberate journey (Locate, from a
 * table, to somewhere you cannot see) and disorienting for a click on a marker
 * already on screen: the thing you clicked shrinks and flees before coming
 * back. easeTo interpolates directly, so the marker slides to its new position
 * and never leaves the viewport.
 *
 * `essential` is deliberately NOT set, so an operator with prefers-reduced-
 * motion gets the same camera position without the sweep.
 */
function centerOnFeature(map, coordinates, inset) {
  const { left = 0, right = 0, bottom = 0 } = inset ?? {}
  const { clientWidth, clientHeight } = map.getContainer()

  // An inset is only honoured when the map is at least twice as big as it, so
  // a phone — where the details panel is a bottom sheet over the whole map,
  // not a rail beside it — is left centred rather than shoved off its own
  // canvas chasing space that does not exist.
  const honouredRight = right > 0 && clientWidth > right * 2 ? right : 0
  // The left edge is the map's own controls panel, honoured only while the
  // strip between the two edges is still wider than the panel itself. Without
  // it a right-hand inset slid the marker straight under the panel: on a
  // ~1000px map the marker landed at x≈290, half hidden behind Map Controls.
  const honouredLeft = left > 0 && clientWidth - honouredRight - left > left ? left : 0
  const dx = (honouredRight - honouredLeft) / 2
  const dy = bottom > 0 && clientHeight > bottom * 2 ? bottom / 2 : 0

  map.easeTo({
    center: coordinates,
    zoom: Math.max(map.getZoom(), FOCUS_ZOOM_FLOOR),
    // Screen-space nudge: negative x seats the marker left of centre so a
    // right-hand drawer cannot cover it, positive x moves it out from under
    // the controls panel; negative y lifts it above a sheet.
    offset: [-dx, -dy],
    duration: 550,
  })
}

// Amber. This ring is the ONLY thing separating "this is where they are"
// from "this is where the subdivision is", so it has to differ from the
// white ring at a glance and mean roughly what amber means everywhere else
// on this map: treat with caution.
const PANIC_APPROX_RING = '#FBBF24'

// Exactly two styles, by design. The old `standard` (dark-v11) option was a
// third near-duplicate of streets that made the two portals' maps look
// different depending on which one an operator happened to have selected;
// `streets` is now the single default basemap for both.
const MAP_STYLES = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
}

export const DEFAULT_STYLE_KEY = 'streets'

/**
 * Streets follows the portal theme; satellite does not.
 *
 * A light street basemap inside a dark console was the brightest thing on the
 * screen — a white rectangle in the middle of a black page, on the view a guard
 * watches for hours. Satellite imagery has no light or dark version, so it is
 * the same in both themes, and it is also the evidence that the overlays below
 * survive a dark ground: the boundary's gold casing, the route's white casing
 * and the pins were all tuned to hold on satellite, which is darker than
 * `dark-v11`.
 */
const DARK_STREETS_STYLE = 'mapbox://styles/mapbox/dark-v11'

export function resolveMapStyle(key, theme) {
  if (key === 'streets' && theme === 'dark') return DARK_STREETS_STYLE
  return MAP_STYLES[key] ?? MAP_STYLES[DEFAULT_STYLE_KEY]
}

/**
 * The two basemaps: what each is called, and the glyph that stands for it.
 *
 * ── THE LABEL IS NOW TOOLTIP COPY, NOT A VISIBLE CAPTION ───────────────────
 * This briefly carried a `shortLabel` as well, for a labelled capsule that had
 * to shrink its own words on a phone to avoid colliding with the controls
 * drawer in the opposite corner. The control is icon-only now, so there is no
 * caption to shrink: `label` is read out by the toggle's tooltip and its
 * accessible name ("Switch to satellite"), and the glyph does the work on
 * screen. One label per style, used in one place.
 */
export const BASEMAP_OPTIONS = [
  { value: 'streets', label: 'Streets', icon: MapIcon },
  { value: 'satellite', label: 'Satellite', icon: Satellite },
]

// Colour-coded so the selected filter states WHAT it selected, not merely
// that something is selected: Active borrows the "hot" response-phase red,
// Resolved the success green, All stays brand-neutral.
export const FILTER_OPTIONS = [
  {
    key: 'all',
    label: 'All',
    dot: '#22C55E',
    activeChip: 'bg-brand-100 text-brand-400 ring-brand-500/40',
  },
  {
    key: 'active',
    label: 'Active',
    dot: RESPONSE_PHASE_COLORS.hot,
    activeChip: 'bg-danger/15 text-danger ring-danger/40',
  },
  {
    key: 'resolved',
    label: 'Resolved',
    dot: RESPONSE_PHASE_COLORS.resolved,
    activeChip: 'bg-success/15 text-success ring-success/40',
  },
]

// The subdivision perimeter, added FIRST so every incident pin, badge and
// pulse draws above it.
//
// Deliberately only a fill + outline: the basemap underneath stays fully
// visible, so neighbouring streets, Balabag Elementary School and the
// surrounding terrain still provide spatial context. The boundary marks the
// premises, it does not mask everything outside them.
export function setupBoundaryLayers(map) {
  if (!map.getSource(BOUNDARY_SOURCE_ID)) {
    map.addSource(BOUNDARY_SOURCE_ID, { type: 'geojson', data: BOUNDARY_GEOJSON })
  }

  map.addLayer({
    id: 'subdivision-boundary-fill',
    type: 'fill',
    source: BOUNDARY_SOURCE_ID,
    paint: {
      // Data-driven: each feature takes its own phase colour, so adding
      // per-phase rings to the GeoJSON needs no change here.
      'fill-color': phaseFillExpression(),
      'fill-opacity': BOUNDARY_STYLE.fillOpacity,
    },
  })

  // Two stacked strokes, not one. Oxblood (#3C0008) is very dark, and against
  // satellite imagery of vegetation or asphalt a single dark line disappears.
  // The gold casing underneath gives it a bright halo, so the same perimeter
  // reads clearly on BOTH basemaps without needing a per-style colour swap
  // (which would break parity with the mobile map).
  map.addLayer({
    id: 'subdivision-boundary-casing',
    type: 'line',
    source: BOUNDARY_SOURCE_ID,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': BOUNDARY_STYLE.casing,
      'line-width': BOUNDARY_STYLE.casingWidth,
      'line-opacity': 0.55,
      'line-blur': 0.5,
    },
  })

  map.addLayer({
    id: 'subdivision-boundary-line',
    type: 'line',
    source: BOUNDARY_SOURCE_ID,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': BOUNDARY_STYLE.stroke,
      'line-width': BOUNDARY_STYLE.coreWidth,
    },
  })
}

export function setupLayers(map, initialData, opts) {
  const { pinRadius, incidentsRef, onSelectIncidentRef, focusInsetRef, centerOnSelectRef, onHoverRef } = opts

  // NO CLUSTERING. Mapbox's clusterer replaces the real points with synthetic
  // "super-points" that carry only `point_count` — so a clustered incident is
  // not a smaller version of itself, it is GONE, and with it the pulse ring,
  // the phase colour and the id the click handler resolves against. What the
  // dispatcher gets back is a green bubble with a number in it: no emergency
  // type, no response phase, no way to click through to the report.
  //
  // On a subdivision-sized map that trade never pays. The whole estate fits in
  // one screen, so the pins a clusterer would merge are exactly the ones that
  // matter — two reports on the same street, which is a pattern worth seeing,
  // not noise worth collapsing. Every report renders as its own pin at every
  // zoom level.
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: initialData,
  })

  /**
   * ── THE HIT TARGET: WHY THE RING NEEDED ITS OWN LAYER ────────────────────
   *
   * The click handler used to sit on `incident-circles`, the 7px badge. So the
   * pulsating radar ring — the largest, most eye-catching part of the marker,
   * and the part a dispatcher actually aims at — was decoration: 25px of
   * animated colour that did nothing, wrapped around a 7px disc that did.
   * Clicks landed in the ring, hit the basemap, and looked like a dead pin.
   *
   * The obvious fix is to put a handler on `incident-pulse`, and it is wrong.
   * That layer's radius is rewritten fifteen times a second by the animation
   * below; hit-testing reads whatever radius the last tick happened to leave,
   * so the target would breathe between 7px and 25px and a click would
   * register or miss depending on which frame it arrived in. That is worse
   * than a small target — it is a target that works intermittently, which
   * teaches an operator to distrust the map.
   *
   * So the click surface is its own layer: invisible (`circle-opacity: 0`,
   * which Mapbox still hit-tests — only `visibility: none` removes a layer
   * from queryRenderedFeatures), never animated, and sized to exactly where
   * the pulse reaches at its widest. The visible ring and the clickable disc
   * are now the same circle by construction.
   *
   * It is added FIRST so it sits at the bottom and paints nothing over the
   * markers. Z-order does not affect which layers a `map.on('click', id)`
   * handler receives — that is by layer id — so the handlers move here
   * wholesale rather than being duplicated on the badge above.
   */
  map.addLayer({
    id: 'incident-hit',
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': pinRadius + INCIDENT_PULSE_REACH,
      'circle-color': '#000000',
      'circle-opacity': 0,
    },
  })

  // A STEADY ring on whichever incident the details panel is showing.
  //
  // The badge's own 4px stroke already marks the selection, but at 7px it is
  // a hairline on a busy basemap — and the pulse cannot carry the job because
  // it fades to nothing twice a second, so "which one am I looking at" would
  // blink. This is a separate, unanimated ring at the radius the pulse only
  // touches at its peak, so the open incident is legible from across the map
  // for as long as it stays open.
  map.addLayer({
    id: 'incident-selected-halo',
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'selected'], true],
    paint: {
      'circle-radius': pinRadius + INCIDENT_PULSE_REACH - 6,
      'circle-color': '#22C55E',
      'circle-opacity': 0.08,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#22C55E',
      'circle-stroke-opacity': 0.9,
    },
  })

  // Pulse ring lives beneath the solid pin so it visibly expands outward
  // from behind it — radius/opacity are driven every tick by the interval
  // in the component below. Color is per-feature (emergencyWaveColor,
  // computed client-side into `waveColor`), not a single flat color — the
  // "radar" reads as which kind of emergency at a glance, not just that
  // something is active. Only pulses for non-resolved incidents.
  map.addLayer({
    id: 'incident-pulse',
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'active'], true],
    paint: {
      'circle-radius': pinRadius,
      'circle-color': ['get', 'waveColor'],
      'circle-opacity': 0.55,
      'circle-stroke-width': 0,
    },
  })

  // The inner badge — the second half of the dual-layer radar. The pulse ring
  // beneath answers WHAT KIND of emergency; this answers WHERE IT STANDS. Two
  // questions, two channels, both readable in the same glance without a
  // legend lookup or a hover.
  //
  // A squircle avatar pin was tried here and reverted: an avatar is identity,
  // and identity is the one thing a dispatcher already knows by the time they
  // are looking at the map. Spending the badge on it cost the phase read and
  // flattened the two channels into one.
  map.addLayer({
    id: 'incident-circles',
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': pinRadius,
      'circle-color': [
        'match',
        ['get', 'phase'],
        'hot', RESPONSE_PHASE_COLORS.hot,
        'warm', RESPONSE_PHASE_COLORS.warm,
        'resolved', RESPONSE_PHASE_COLORS.resolved,
        RESPONSE_PHASE_COLORS.cold,
      ],
      // The selected pin reads as selected on the map itself, not only in the
      // panel that opened — a thicker brand-colored ring, same treatment in
      // both portals. An out-of-boundary pin gets the oxblood perimeter colour
      // as its ring, tying it visually to the boundary it falls outside of.
      'circle-stroke-width': [
        'case',
        ['==', ['get', 'selected'], true], 4,
        ['==', ['get', 'inBounds'], false], 3,
        2,
      ],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'selected'], true], '#22C55E',
        ['==', ['get', 'inBounds'], false], BOUNDARY_STYLE.casing,
        'rgba(255,255,255,0.85)',
      ],
    },
  })

  map.on('click', 'incident-hit', (event) => {
    // Overlapping an SOS: the nearest marker owns the click (clickOwner).
    if (clickOwner(map, event.point) !== 'incident') return

    // The NEAREST report under the click, not whichever the renderer listed
    // first — two rings overlap often on a busy lot.
    const feature = nearestFeature(map, event.point, 'incident-hit')?.feature ?? event.features?.[0]
    const incident = incidentsRef.current.find((i) => i.id === feature?.properties?.id)
    if (!incident) return

    // Centre BEFORE handing the incident up. The panel that opens covers one
    // edge of the map, and moving the camera after it appears would slide the
    // marker under it — see centerOnFeature for the inset that avoids that.
    // Opt-in: see the `centerOnSelect` prop for why the Admin map declines.
    if (centerOnSelectRef?.current) {
      centerOnFeature(map, feature.geometry.coordinates, focusInsetRef?.current)
    }
    onSelectIncidentRef.current?.(incident)
  })

  // `mousemove`, not `mouseenter`. The panic disc sits over this one, and its
  // own `mouseleave` clears the cursor — with `mouseenter` the pointer would
  // then stay a default arrow while still hovering a clickable incident,
  // because entering already happened and will not fire again. mousemove
  // re-asserts on every frame the cursor is over the disc.
  map.on('mousemove', 'incident-hit', (event) => {
    map.getCanvas().style.cursor = 'pointer'

    // ── THE PREVIEW, AND WHO OWNS IT ────────────────────────────────────────
    // Same owner as the click (clickOwner), so the card previews exactly what
    // a click here would open.
    if (clickOwner(map, event.point) !== 'incident') return

    const feature = nearestFeature(map, event.point, 'incident-hit')?.feature ?? event.features?.[0]
    const incident = incidentsRef.current.find((i) => i.id === feature?.properties?.id)
    if (!incident) return
    // Anchored to the marker's own coordinates, NOT to the cursor. A card that
    // follows the pointer inside a 25px disc jitters, and it stops describing
    // any particular marker the moment two overlap. See the positioning effect
    // in the component below, which re-projects this through a pan.
    onHoverRef?.current?.({ kind: 'incident', id: incident.id, lngLat: feature.geometry.coordinates })
  })
  map.on('mouseleave', 'incident-hit', () => {
    map.getCanvas().style.cursor = ''
    onHoverRef?.current?.(null)
  })
}

/**
 * ── WHO OWNS A CLICK WHERE AN SOS AND A REPORT OVERLAP ─────────────────────
 *
 * Both hit discs are far wider than their markers (25px and 32px), so a report
 * near an SOS shares clicks with it, and both layers' handlers fire. The rule
 * used to be "the emergency always wins", and that made reports unopenable:
 *   • an SOS with no GPS fix is ANCHORED at the premises centre, so every
 *     report filed near the middle of the estate opened the SOS instead;
 *   • a report a few metres from a live SOS could never be opened at all,
 *     because every pixel of its ring was also inside the SOS disc.
 *
 * Now the nearest MARKER wins, by screen distance from the click to each
 * centre, with the SOS taking ties within a few pixels. An anchored (no-fix)
 * SOS never outranks a report: its position is a placeholder, not a place,
 * and it stays reachable from its own centre and from the SOS rail.
 *
 * Returns 'panic', 'incident' or null. Both handlers ask the same question of
 * the same point, so exactly one of them acts.
 */
const SOS_TIE_PX = 4
function nearestFeature(map, point, layer) {
  if (!map.getLayer(layer)) return null
  let best = null
  for (const feature of map.queryRenderedFeatures(point, { layers: [layer] })) {
    const at = map.project(feature.geometry.coordinates)
    const d = Math.hypot(at.x - point.x, at.y - point.y)
    if (!best || d < best.d) best = { feature, d }
  }
  return best
}
function clickOwner(map, point) {
  const panic = nearestFeature(map, point, 'panic-hit')
  const incident = nearestFeature(map, point, 'incident-hit')
  if (!panic) return incident ? 'incident' : null
  if (!incident) return 'panic'
  if (panic.feature.properties?.located === false) return 'incident'
  return panic.d <= incident.d + SOS_TIE_PX ? 'panic' : 'incident'
}

// Optional — only set up when the caller actually passes a `panicAlerts`
// prop (today, only the Guard Dispatch page does). Always-pulsing, larger,
// and visually distinct from ordinary incident pins on purpose: a panic
// alert isn't just "high WPDA priority," it's a different category of event.
// Nothing on this map clusters any more, so this is no longer a special case
// — but it was the first layer to earn the exemption, for the reason that
// eventually applied to all of them: an emergency should never hide inside a
// bubble with a number on it.
//
// ── MARKER SCALE, NOT BILLBOARD SCALE ───────────────────────────────────
// r=10 against the incident pin's r=7, with a 3px ring against their 2px.
// Same size family — it reads as one of the map's markers, not as a shape
// laid over the top of it.
//
// It was briefly r=26 with a halo reaching 90px, chasing 'unmissable'. That
// overshot the goal and cost the thing the map exists for: a disc that wide
// covers most of a phase at working zoom, so the one moment a dispatcher
// most needs to see streets and neighbouring lots was the moment the alert
// hid them. An emergency marker has to be findable, not opaque.
//
// What makes it stand out is not size. It is the only RED marker on a map
// whose pins are green/amber/slate, it is the only one that pulses at 900ms
// against the incident pulse's 1600ms. Those
// separate it at a glance at any zoom, and none of them consume map.
//
// The ring is doing real work, not decoration. Red-on-satellite and
// red-on-dark both lose contrast badly; a light stroke is the one edge that
// survives every style in the switcher.
export function setupPanicLayer(map, initialData, opts) {
  const { panicAlertsRef, onSelectPanicAlertRef, onHoverRef } = opts

  map.addSource(PANIC_SOURCE_ID, { type: 'geojson', data: initialData })

  // Same invisible, unanimated click surface the incident markers got, and for
  // the same reason — see the long note on `incident-hit`. It matters more
  // here: this node's ring is the widest thing on the map and the alert behind
  // it is the most urgent, so an SOS whose halo swallowed the click was the
  // worst version of the bug.
  map.addLayer({
    id: 'panic-hit',
    type: 'circle',
    source: PANIC_SOURCE_ID,
    paint: {
      'circle-radius': PANIC_BASE_RADIUS + PANIC_PULSE_REACH,
      'circle-color': '#000000',
      'circle-opacity': 0,
    },
  })

  map.addLayer({
    id: 'panic-pulse',
    type: 'circle',
    source: PANIC_SOURCE_ID,
    // Base radius matches the core so the halo grows OUT of the node rather
    // than appearing to sit behind a smaller disc.
    paint: {
      'circle-radius': PANIC_BASE_RADIUS,
      'circle-color': EMERGENCY_COLORS.critical,
      'circle-opacity': 0.6,
    },
  })

  map.addLayer({
    id: 'panic-circles',
    type: 'circle',
    source: PANIC_SOURCE_ID,
    paint: {
      'circle-radius': PANIC_BASE_RADIUS,
      'circle-color': EMERGENCY_COLORS.critical,
      'circle-stroke-width': 3,
      // White for a real fix, amber for a centre-anchored one. Data-driven
      // from the feature property, so one layer serves both states and they
      // share a click handler and a pulse.
      'circle-stroke-color': [
        'case',
        ['get', 'located'],
        '#ffffff',
        PANIC_APPROX_RING,
      ],
    },
  })

  map.on('click', 'panic-hit', (event) => {
    if (clickOwner(map, event.point) !== 'panic') return
    const feature = nearestFeature(map, event.point, 'panic-hit')?.feature ?? event.features?.[0]
    const alert = panicAlertsRef.current.find((a) => a.id === feature?.properties?.id)
    if (!alert) return

    // The camera deliberately does NOT move for an SOS.
    //
    // An alert with no GPS fix is anchored at the premises centre (see the
    // panicGeojson note), and centring on that would state a position the
    // alert does not have — the guard would read the camera as the answer to
    // "where are they". The modal's first line says "No GPS fix" and gives
    // the lot instead, which is the honest answer. Locate, from the Panic
    // Alerts page, is still there for a fix worth flying to.
    onSelectPanicAlertRef.current?.(alert)
  })
  map.on('mousemove', 'panic-hit', (event) => {
    map.getCanvas().style.cursor = 'pointer'
    if (clickOwner(map, event.point) !== 'panic') return
    const feature = nearestFeature(map, event.point, 'panic-hit')?.feature ?? event.features?.[0]
    const alert = panicAlertsRef.current.find((a) => a.id === feature?.properties?.id)
    if (!alert) return
    onHoverRef?.current?.({ kind: 'panic', id: alert.id, lngLat: feature.geometry.coordinates })
  })
  map.on('mouseleave', 'panic-hit', () => {
    map.getCanvas().style.cursor = ''
    onHoverRef?.current?.(null)
  })
}

// ── THE RESPONSE ROUTE ────────────────────────────────────────────────────
// Optional, like the panic layer: drawn only from the `route` prop, which only
// the Guard Dispatch page passes. The source is always added so the prop can
// arrive, change and clear without layers being added and removed under a
// running map.
export const ROUTE_SOURCE_ID = 'response-route'
export const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] }

// Two tones, set per feature by the page (`properties.tone`), live and
// preview — see ROUTE_TONE_COLORS. The white casing and the chevrons are the
// same in both.
const ROUTE_CASING = '#FFFFFF'
const ROUTE_ARROW_IMAGE = 'route-arrow'

/**
 * A white chevron pointing along +x, drawn once per style load. A symbol
 * placed on a line turns its icon's x-axis to the line's direction, and the
 * route's coordinates run unit → incident, so every chevron points at the call.
 */
function routeArrowImage() {
  const ratio = 2
  const size = 18 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 2.75 * ratio
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(size * 0.36, size * 0.24)
  ctx.lineTo(size * 0.64, size * 0.5)
  ctx.lineTo(size * 0.36, size * 0.76)
  ctx.stroke()
  return { image: ctx.getImageData(0, 0, size, size), ratio }
}

/**
 * Transport glyphs for the route origin.
 *
 * -- WHY THE GEOMETRY IS READ OFF THE COMPONENT ------------------------------
 * A Mapbox symbol layer needs a raster it can place, not a React component, and
 * the three ways to get one are all worse than this: `renderToStaticMarkup`
 * drags react-dom/server into a map bundle, an <img> of an SVG data URL makes
 * layer setup asynchronous for one 14px glyph, and hand-tracing the shape
 * produces an icon that quietly stops matching the one in the card beside it.
 *
 * This file used to hold a hand-copied COPY of the old icon set's path data,
 * pinned to a version, under a note admitting it would not follow an upgrade.
 * It did not, twice: the move to Hugeicons redrew both glyphs and the move to
 * Material Symbols redrew them again, onto a different grid and as fills
 * rather than strokes. A pinned copy would have survived neither, so the
 * marker on the map and the icon on the card beside it would have been two
 * different pictures of the same thing -- the exact failure the note
 * predicted. Reading the geometry off the component is what makes the second
 * migration a three-line change here instead of a re-trace.
 *
 * `Bike.glyph` and `Footprints.glyph` are the SAME data the card renders (see
 * `Icon.glyph` in shared/icons/createIcon.jsx). One drawing, filled onto a
 * canvas much as `routeArrowImage` above strokes the chevrons -- synchronously,
 * with no extra dependency, and with nothing left to keep in step by hand.
 *
 * -- FILLED, NOT STROKED, AND ON A 960 GRID -----------------------------------
 * Both of those changed with the move to Material Symbols and neither is
 * cosmetic. These glyphs are FILLED shapes: `ctx.stroke()` on one traces the
 * outline of the silhouette, which draws each limb of the bicycle as a pair of
 * hairlines with a gap down the middle rather than as a line. And they are
 * authored on a 960-unit grid whose origin sits at the BASELINE, so every
 * coordinate is negative and a `scale(size / 24)` of it lands the whole glyph
 * off the top of the canvas. The transform below is the one that puts a
 * `0 -960 960 960` viewBox into a `size` x `size` box.
 */
const TRANSPORT_IMAGES = { bike: 'route-transport-bike', foot: 'route-transport-foot' }

/** The Phosphor grid: see ICON_VIEW_BOX in shared/icons/tokens.js. */
const GLYPH_GRID = 256

const TRANSPORT_GEOMETRY = {
  bike: { path: Bike.glyph },
  foot: { path: Footprints.glyph },
}

function transportGlyphImage(kind) {
  const ratio = 2
  const size = 15 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const geometry = TRANSPORT_GEOMETRY[kind] ?? TRANSPORT_GEOMETRY.bike
  // Scale the glyph grid down to the canvas. NO TRANSLATE: Phosphor draws
  // from the top-left, so the paths are already in the box. The set this
  // replaced ran from y = -960 up to y = 0 and needed its origin dropped a
  // full grid, and that translate is gone with it — left in, it would push
  // every glyph one canvas-height below the bottom edge and the marker would
  // come back blank.
  ctx.scale(size / GLYPH_GRID, size / GLYPH_GRID)
  // A fill, not a stroke. There is no line weight to choose here any more --
  // the glyph's apparent weight is the font's wght=400, baked into the shape.
  ctx.fillStyle = '#FFFFFF'

  ctx.fill(new Path2D(geometry.path))

  // getImageData ignores the transform and reads device pixels, so this is the
  // whole canvas despite the scale() above.
  return { image: ctx.getImageData(0, 0, size, size), ratio }
}

/** The live-route layers the travelled-part trim applies to. */
/** How long a unit glides between fixes. The route trim runs on the same clock. */
export const UNIT_TWEEN_MS = 900

const ROUTE_TRIMMED_LAYERS = ['route-glow', 'route-casing', 'route-line']

/**
 * Hide the first `fraction` of the live route — the part already travelled.
 *
 * `line-trim-offset` is a paint property, so moving it is a GPU uniform
 * update: no `setData`, no re-tiling in the worker. That is what lets the
 * travelled part advance every animation frame in step with the marker
 * instead of jumping once per fix. Clamped and guarded, because it runs from
 * an animation frame that can outlive a style swap.
 */
export function applyRouteTrim(map, fraction) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  ROUTE_TRIMMED_LAYERS.forEach((id) => {
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-trim-offset', [0, f])
  })
}

/** The `trim` the route collection carries — the travelled fraction — or 0. */
export function routeTrimOf(collection) {
  const feature = collection?.features?.find(
    (f) => f.properties?.kind === 'route' && Number.isFinite(f.properties?.trim),
  )
  return feature ? feature.properties.trim : 0
}

export function setupRouteLayers(map, initialData) {
  // lineMetrics: the live route is trimmed by `line-trim-offset` (see
  // applyRouteTrim), which reads `line-progress` and needs this to exist.
  map.addSource(ROUTE_SOURCE_ID, {
    type: 'geojson',
    data: initialData ?? EMPTY_COLLECTION,
    lineMetrics: true,
  })
  if (!map.hasImage(ROUTE_ARROW_IMAGE)) {
    const { image, ratio } = routeArrowImage()
    map.addImage(ROUTE_ARROW_IMAGE, image, { pixelRatio: ratio })
  }
  Object.entries(TRANSPORT_IMAGES).forEach(([kind, id]) => {
    if (map.hasImage(id)) return
    const { image, ratio } = transportGlyphImage(kind)
    map.addImage(id, image, { pixelRatio: ratio })
  })

  // UNDER every marker: inserted before the lowest incident layer, so the pin
  // at the route's end still paints over the line and its hit disc still takes
  // the click. A route must never make the incident it leads to harder to open.
  const beforeId = map.getLayer('incident-hit') ? 'incident-hit' : undefined
  const ofKind = (kind) => ['==', ['get', 'kind'], kind]
  // Wider as the camera closes in, so the line stays a road-width stroke at
  // lot detail instead of thinning to a hairline over the tiles.
  const byZoom = (atZ14, atZ18) => ['interpolate', ['linear'], ['zoom'], 14, atZ14, 18, atZ18]
  const toneColor = ['match', ['get', 'tone'], 'live', ROUTE_TONE_COLORS.live, ROUTE_TONE_COLORS.preview]

  // ── THE PART ALREADY TRAVELLED ───────────────────────────────────────────
  //
  // Added FIRST so every live-route layer paints over it. It is the same path
  // in the same colour at a fraction of the weight and opacity: a dispatcher
  // should be able to see the whole route to judge whether a unit is going a
  // sensible way, while never mistaking the part behind the unit for the part
  // ahead of it. A dashed or grey treatment was rejected — grey reads as
  // "failed" next to a green live line, and dashes already mean "not a road"
  // on this map (see the connector layer below).
  map.addLayer(
    {
      id: 'route-covered',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ofKind('covered'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': toneColor, 'line-width': byZoom(4, 7), 'line-opacity': 0.28 },
    },
    beforeId,
  )

  // The glow: a wide, blurred, translucent stroke of the route's own colour.
  // It is what lets the line read at a glance over busy satellite tiles.
  map.addLayer(
    {
      id: 'route-glow',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ofKind('route'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': toneColor,
        'line-width': byZoom(16, 28),
        'line-blur': byZoom(8, 12),
        'line-opacity': 0.4,
      },
    },
    beforeId,
  )
  // White casing under a coloured core — the boundary's two-stroke trick: one
  // coloured line vanishes against satellite imagery, and the casing is the
  // edge that survives both basemaps without a per-style swap.
  map.addLayer(
    {
      id: 'route-casing',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ofKind('route'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ROUTE_CASING, 'line-width': byZoom(8, 14), 'line-opacity': 0.95 },
    },
    beforeId,
  )
  map.addLayer(
    {
      id: 'route-line',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ofKind('route'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': toneColor, 'line-width': byZoom(5, 9) },
    },
    beforeId,
  )
  // Direction: chevrons along the core, pointing from the unit to the call.
  map.addLayer(
    {
      id: 'route-arrows',
      type: 'symbol',
      source: ROUTE_SOURCE_ID,
      // On the part still AHEAD only — a trim cannot hide symbols, so the
      // chevrons get their own feature. A route with no `trim` (the admin
      // heat map's fleet lines) has no 'ahead' feature and keeps them all.
      filter: ['any', ofKind('ahead'), ['all', ofKind('route'), ['!', ['has', 'trim']]]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': byZoom(48, 72),
        'icon-image': ROUTE_ARROW_IMAGE,
        'icon-size': byZoom(0.6, 0.95),
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    beforeId,
  )
  // The off-road legs between each true end and the road graph — dashed,
  // because they are not a road. See routeToGeojson in the security portal.
  map.addLayer(
    {
      id: 'route-connector',
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ofKind('connector'),
      paint: { 'line-color': toneColor, 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] },
    },
    beforeId,
  )
  // Drawn only when the route does NOT start at a live unit (the guardhouse
  // fallback). A live unit is its own marker on the units layer.
  map.addLayer(
    {
      id: 'route-origin',
      type: 'circle',
      source: ROUTE_SOURCE_ID,
      filter: ofKind('origin'),
      paint: {
        // 11, not 6: this disc is now the plate the transport glyph sits on.
        // At the old radius the icon would have overhung its own marker.
        'circle-radius': 11,
        'circle-color': toneColor,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#FFFFFF',
      },
    },
    beforeId,
  )
  // How the unit is travelling, on the marker it is travelling from — the same
  // glyph the telemetry card shows, so the map and the card cannot disagree
  // about which mode is plotted.
  map.addLayer(
    {
      id: 'route-origin-transport',
      type: 'symbol',
      source: ROUTE_SOURCE_ID,
      filter: ofKind('origin'),
      layout: {
        'icon-image': [
          'match',
          ['get', 'transport'],
          'foot',
          TRANSPORT_IMAGES.foot,
          TRANSPORT_IMAGES.bike,
        ],
        // The glyph belongs to the disc under it, so it is placed
        // unconditionally rather than being dropped by label collision.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    beforeId,
  )
  // A style swap rebuilds these layers untrimmed; put the travelled part back.
  applyRouteTrim(map, routeTrimOf(initialData))
}

// ── GUARD UNITS ───────────────────────────────────────────────────────────
// Optional, like the panic layer: drawn only when the page passes `units`
// (the Guard Dispatch map). One marker per on-duty officer with a position,
// coloured by what they are doing:
//   available   green-500   on duty, no call (also while a call waits for
//                           their acknowledgement)
//   responding  emerald-600 pulsing — accepted and moving
//   on_scene    blue-500    arrived, through investigation
// ── ONE MARKER, NOT THREE SHAPES ────────────────────────────────────────────
//
// Units were drawn as a shield inside a disc, the route origin as a plain dot,
// and a unit under way as a separate arrow image — three silhouettes for one
// thing, which is what made a dispatcher check the legend to read their own
// map. There is now a single marker: a white-edged coloured SHIELD (a dot
// until 2026-10-17 — see unitImage), with a translucent beam under it when the
// unit's heading is known.
//
// That is the shape every navigation app converges on, and for a good reason:
// the dot says WHERE and the beam says WHICH WAY, so a unit with no heading
// degrades to exactly the dot rather than to a different icon. State stays in
// the COLOUR, never in the shape:
//   available   green-500   on duty, no call (also while a call awaits their ack)
//   responding  emerald-600 pulsing — accepted and moving
//   on_scene    blue-500    arrived, through investigation
export const UNITS_SOURCE_ID = 'guard-units'
export const UNIT_IMAGE = {
  available: 'unit-dot-available',
  assigned: 'unit-dot-available',
  responding: 'unit-dot-responding',
  on_scene: 'unit-dot-on-scene',
}
const UNIT_HEADING_IMAGE = 'unit-heading'

/** "34, 197, 94" from "#22c55e", for building rgba() stops. */
function hexToRgb(hex) {
  const value = String(hex).replace('#', '')
  const full = value.length === 3 ? value.split('').map((ch) => ch + ch).join('') : value
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/**
 * The unit marker: a white-edged SHIELD in the state colour, with a white star
 * badge on it.
 *
 * ── A SHIELD, NOT A DOT (2026-10-17) ──────────────────────────────────────
 * Units were white-ringed dots, and every incident pin is a ringed dot too.
 * With a responding unit in orange and a two-hour-old report also orange, a
 * report 28 m from a guard was taken for the guard. Colour alone cannot carry
 * "this is a person who responds" against pins whose colour already means age
 * and kind, so the SHAPE now does: nothing else on this map is a shield, and a
 * shield with a badge reads as security without a legend. State still lives in
 * the colour (see UNIT_COLORS), never in the shape, so every unit is the same
 * silhouette.
 *
 * Drawn centred, like the dot it replaced, so `icon-anchor` defaults, the hit
 * layer and the tween all stay as they were.
 */
function unitImage(color) {
  const ratio = 2
  const size = 26 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2

  // Shield outline: flat top with rounded shoulders, sides tapering to a point.
  const shield = (inset) => {
    const top = 2.5 * ratio + inset
    const bottom = size - 2 * ratio - inset
    const left = 4 * ratio + inset
    const right = size - 4 * ratio - inset
    const shoulder = 3 * ratio
    ctx.beginPath()
    ctx.moveTo(left + shoulder, top)
    ctx.lineTo(right - shoulder, top)
    ctx.quadraticCurveTo(right, top, right, top + shoulder)
    ctx.lineTo(right, c)
    ctx.quadraticCurveTo(right, bottom - 4 * ratio, c, bottom)
    ctx.quadraticCurveTo(left, bottom - 4 * ratio, left, c)
    ctx.lineTo(left, top + shoulder)
    ctx.quadraticCurveTo(left, top, left + shoulder, top)
    ctx.closePath()
  }

  // A shadow rather than a glow, so it separates from satellite tiles without
  // joining the pulsing emergency rings' visual family.
  ctx.shadowColor = 'rgba(15, 23, 42, 0.4)'
  ctx.shadowBlur = 3.5 * ratio
  ctx.shadowOffsetY = 1 * ratio
  shield(0)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()

  ctx.shadowColor = 'transparent'
  shield(2.25 * ratio)
  ctx.fillStyle = color
  ctx.fill()

  // The badge: a five-point star, white, slightly above centre where the
  // shield is widest.
  const cy = c - 1 * ratio
  const outer = 5 * ratio
  const inner = outer * 0.45
  ctx.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = c + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  return { image: ctx.getImageData(0, 0, size, size), ratio }
}

/**
 * The heading beam: a soft wedge spreading from the dot along the bearing.
 *
 * Drawn pointing UP so `icon-rotate` can take a compass bearing unmodified
 * under `icon-rotation-alignment: 'map'`. Translucent and fading outwards,
 * because a heading derived from a route is a direction of travel and not a
 * claim about precision — a hard-edged arrow would assert more than the data
 * supports.
 */
function unitHeadingImage(color) {
  const ratio = 2
  const size = 54 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2

  // Fades the MARKER COLOUR's own alpha, not towards transparent white.
  // `rgba(255,255,255,0)` is still white while it fades, so the wedge picked
  // up a grey cast over satellite tiles and read as a shadow rather than as
  // the unit's heading — visible the moment it was rendered, invisible in the
  // code.
  const rgb = hexToRgb(color)
  const gradient = ctx.createLinearGradient(c, c, c, 0)
  gradient.addColorStop(0, `rgba(${rgb}, 0.85)`)
  gradient.addColorStop(1, `rgba(${rgb}, 0)`)

  ctx.beginPath()
  ctx.moveTo(c, c)
  ctx.arc(c, c, c - 2 * ratio, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42)
  ctx.closePath()
  ctx.fillStyle = gradient
  ctx.fill()
  return { image: ctx.getImageData(0, 0, size, size), ratio }
}

/**
 * ── THE NAVIGATION ARROW ───────────────────────────────────────────────────
 *
 * The marker a unit becomes once a navigation session is running: a white
 * chevron inside a blue emblem, ringed in white, turning with the heading.
 *
 * WHY THE DOT IS NOT ENOUGH, HAVING ARGUED THAT IT WAS. The note above this
 * block settles on one silhouette for every unit, with state in the colour,
 * and that is still right for a dispatcher reading a map with four units on
 * it. It is the wrong marker for the officer DRIVING, because a dot with a
 * translucent wedge under it answers "which way is this unit pointing" and the
 * driver's question is "which way am I going" — the same fact, but one needs
 * to survive a glance at a laptop on a passenger seat in daylight.
 *
 * So the shape does change here, and it is the ONE exception, earned by being
 * a MODE rather than a state: it appears when a session starts, it goes when
 * the session ends, and exactly one unit on the map can have it. The dot's
 * three state colours still mean what they meant — they are simply not what a
 * driver is reading. Every other unit on the console is untouched.
 *
 * Drawn pointing UP, like `unitHeadingImage`, so `icon-rotate` takes a compass
 * bearing unmodified under `icon-rotation-alignment: 'map'`.
 *
 * HARD-EDGED, where the heading beam is deliberately soft. The beam fades
 * because a bearing derived from a route is a direction of travel and not a
 * precise claim; this arrow asserts the same thing just as loosely, but it is
 * read while moving, and a gradient-edged arrow at 36px over satellite tiles
 * reads as a smudge. The honesty is carried by WHEN it is drawn — only for a
 * unit with a known bearing on a plotted route — not by its opacity.
 */
const NAV_ARROW_IMAGE = 'unit-nav-arrow'

function navigationArrowImage() {
  const ratio = 2
  const size = 36 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2

  // Same shadow as the unit dot, for the same reason: this has to separate
  // from satellite imagery without a coloured halo, which on this map means
  // "emergency" and not "marker".
  ctx.shadowColor = 'rgba(15, 23, 42, 0.45)'
  ctx.shadowBlur = 4 * ratio
  ctx.shadowOffsetY = 1.5 * ratio
  ctx.beginPath()
  ctx.arc(c, c, c - 4 * ratio, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()

  ctx.shadowColor = 'transparent'
  const r = c - 6 * ratio
  ctx.beginPath()
  ctx.arc(c, c, r, 0, Math.PI * 2)
  ctx.fillStyle = NAV_MARKER_COLORS.arrow
  ctx.fill()

  // The chevron: a triangle with its base notched, which is what makes it read
  // as pointing rather than as a wedge. Every coordinate is a fraction of the
  // emblem's radius, so changing `size` above rescales the whole marker instead
  // of leaving the arrow sitting at the wrong size inside a resized disc.
  ctx.beginPath()
  ctx.moveTo(c, c - r * 0.6)
  ctx.lineTo(c + r * 0.44, c + r * 0.52)
  ctx.lineTo(c, c + r * 0.18)
  ctx.lineTo(c - r * 0.44, c + r * 0.52)
  ctx.closePath()
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()

  return { image: ctx.getImageData(0, 0, size, size), ratio }
}

/**
 * ── THE ORIENTATION CONE ───────────────────────────────────────────────────
 *
 * A field-of-view wedge spreading from the officer's own marker along the
 * direction their DEVICE is pointing, the way Life360 and every phone map
 * draw "you are facing this way".
 *
 * ── IT IS NOT THE HEADING BEAM, AND IT REPLACES IT ─────────────────────────
 * `unitHeadingImage` above draws a wedge too, and the two would be
 * indistinguishable on screen while saying different things: that one is the
 * direction of the ROAD at the unit's position, derived from the route, and
 * this one is the direction the officer is FACING, from the compass. Stacking
 * them produces two overlapping wedges that disagree the moment somebody
 * turns their head, which is worse than either alone.
 *
 * So the cone takes precedence on the marker it applies to — the viewer's own,
 * and only while their compass is actually reporting — and the beam carries
 * every other unit, where a compass reading does not exist (see
 * `useDeviceHeading` for why it is never published).
 *
 * ── WIDER, SOFTER AND LONGER THAN THE BEAM, ON PURPOSE ─────────────────────
 * A compass tells you roughly where somebody is pointed, not precisely, and a
 * phone held in a hand swings. The beam is ±24° because a route bearing is
 * tight; this is ±32° with a gradient that fades to nothing, because the cone
 * is a field of view and a hard edge would claim a precision the sensor does
 * not have. Reach is longer for the opposite reason to the beam's: this one is
 * read while STANDING STILL, at close zoom, where a short wedge is hidden
 * under the dot it comes out of.
 */
const UNIT_CONE_IMAGE = 'unit-orientation-cone'

function unitConeImage(color) {
  // 140px across, against the 36px navigation arrow it sits under. A cone
  // has to project well clear of the marker to read as a direction at all —
  // at 96px the visible part was 37px of fade beyond the dot and rendered as
  // a glow around it rather than as a wedge pointing anywhere. Judged on the
  // real basemap at z18, which is the zoom an officer navigates at.
  const ratio = 2
  const size = 140 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2
  const r = c - 2 * ratio

  // Drawn pointing UP, like every other rotatable image here, so `icon-rotate`
  // takes a compass bearing unmodified under `icon-rotation-alignment: map`.
  //
  // A RADIAL gradient, not the beam's linear one: a field of view fades with
  // DISTANCE from the observer, evenly across the arc, where a linear fade
  // would leave one edge of the wedge brighter than the other and read as a
  // lighting effect rather than as a direction.
  // ── WHERE THE OPACITY ACTUALLY HAS TO BE ────────────────────────────────
  // The first cut peaked at the centre and faded from there, which is the
  // textbook field-of-view gradient and rendered as almost nothing: the
  // innermost quarter of this raster sits UNDER the 22px unit dot, so every
  // bit of the peak was hidden and what remained visible started at a third
  // of it and fell away. Measured on the real basemap, not reasoned about.
  //
  // The ramp now holds near full strength out to the edge of the dot and
  // fades over the part that can be seen. It still reads as a field of view
  // rather than a solid wedge, and it is legible on both basemaps.
  const rgb = hexToRgb(color)
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, r)
  gradient.addColorStop(0, `rgba(${rgb}, 0.6)`)
  gradient.addColorStop(0.25, `rgba(${rgb}, 0.5)`)
  gradient.addColorStop(0.65, `rgba(${rgb}, 0.22)`)
  gradient.addColorStop(1, `rgba(${rgb}, 0)`)

  const halfAngle = 0.56 // ~32 degrees either side of straight ahead
  ctx.beginPath()
  ctx.moveTo(c, c)
  ctx.arc(c, c, r, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle)
  ctx.closePath()
  ctx.fillStyle = gradient
  ctx.fill()

  return { image: ctx.getImageData(0, 0, size, size), ratio }
}

/**
 * The two marker MODES a routed unit moves between, carried on the feature as
 * `navState` so one source feeds every layer below and the filters decide
 * which silhouette is drawn.
 *
 *   standby     a route is plotted from this unit and nobody has pressed Start
 *               Navigation. A radiating ring around the dot: the console is
 *               tracking this position and waiting.
 *   navigating  a session is running. The dot, its heading beam and its
 *               responding flash all give way to the arrow above.
 *
 * Empty string, not null, for "neither". A Mapbox `['get']` on an absent
 * property answers null, and `['==', null, 'standby']` is false, so null would
 * work — but `['!=', ['get','navState'], 'navigating']` is the filter that
 * hides the dot, and relying on a null comparison for the layer that draws
 * EVERY OTHER UNIT is a bet not worth taking for one saved character.
 */
export const NAV_STATE = { none: '', standby: 'standby', navigating: 'navigating' }

/**
 * The turn-by-turn camera.
 *
 * ── WHY A TILTED, ROTATED CAMERA IS SAFE HERE AND NOWHERE ELSE ─────────────
 * This map is built north-up on purpose: `dragRotate`, `pitchWithRotate` and
 * `touchPitch` are all off, and the Reset bearing button was deleted on the
 * grounds that nothing could rotate the map so nothing needed un-rotating
 * (see the mount options and MapControls).
 *
 * None of that changes. Those flags disable GESTURES, not `easeTo`, so pitch
 * and bearing become something the console enters and leaves deliberately
 * rather than a state a stray two-finger drag can strand an operator in. The
 * part that would strand them is leaving it applied, so `exitNavigationCamera`
 * below is not a nicety — it is the only way back, and an officer who ended a
 * session on a tilted, rotated map would have no gesture to fix it.
 *
 * ZOOM 17.5, measured rather than picked: at 17 the next turn is often past
 * the top edge on a phone, and at 18 a single intersection fills the viewport
 * and the officer loses the block they are driving into. PITCH 50 sits in the
 * brief's 45–60 band and is where the horizon lands far enough up the frame to
 * show the road ahead without the sky taking a third of a bottom-sheet-reduced
 * canvas.
 */
export const NAV_CAMERA = { zoom: 17.5, pitch: 50 }

/** The sweep INTO a session. Long enough to read as a move, not a cut. */
export const NAV_ENTER_MS = 1200
/** Per-fix follow, matched to the marker tween so the two arrive together. */
export const NAV_FOLLOW_MS = 900

/** Layers a unit can be clicked or hovered on — the dot, and the arrow it becomes. */
const UNIT_HIT_LAYERS = ['unit-icons', 'unit-nav-arrow']

const UNIT_STATE_TEXT = {
  available: 'Available',
  assigned: 'Dispatched — awaiting acknowledgement',
  responding: 'Responding',
  on_scene: 'On scene',
}

export function setupUnitLayers(map, initialData, { unitsRef, onSelectUnitRef }) {
  /**
   * ── THE IMAGE IDS COME FROM `UNIT_IMAGE`, NOT FROM A SECOND LIST ─────────
   *
   * They used to be written out here as 'unit-available' / 'unit-responding' /
   * 'unit-on-scene' while `UNIT_IMAGE` above — the map the FEATURES are built
   * from — named them 'unit-dot-available' and so on. The two lists disagreed,
   * so `['get', 'image']` resolved to an image that had never been registered
   * and `unit-icons` silently drew NOTHING, on both portals, for every unit.
   *
   * It did not look like a blank layer, which is why it survived: the pulse
   * ring, the heading beam and the self-halo are separate layers and they all
   * kept drawing, so each unit still appeared as a coloured smudge with a
   * wedge under it. The thing that was missing was the white-ringed dot those
   * three are meant to decorate — the marker itself.
   *
   * Mapbox does not complain about an unknown `icon-image` resolved through an
   * expression; it just places nothing. So this is derived from one map now,
   * and `UNIT_IMAGE.assigned` aliasing `available` is why `new Set` is doing
   * the de-duplication rather than a plain list.
   */
  const paletteFor = {
    [UNIT_IMAGE.available]: UNIT_COLORS.available,
    [UNIT_IMAGE.responding]: UNIT_COLORS.responding,
    [UNIT_IMAGE.on_scene]: UNIT_COLORS.on_scene,
  }
  new Set(Object.values(UNIT_IMAGE)).forEach((id) => {
    if (map.hasImage(id)) return
    const { image, ratio } = unitImage(paletteFor[id] ?? UNIT_COLORS.available)
    map.addImage(id, image, { pixelRatio: ratio })
  })

  if (!map.hasImage(UNIT_HEADING_IMAGE)) {
    const { image, ratio } = unitHeadingImage(UNIT_COLORS.responding)
    map.addImage(UNIT_HEADING_IMAGE, image, { pixelRatio: ratio })
  }

  if (!map.hasImage(NAV_ARROW_IMAGE)) {
    const { image, ratio } = navigationArrowImage()
    map.addImage(NAV_ARROW_IMAGE, image, { pixelRatio: ratio })
  }

  if (!map.hasImage(UNIT_CONE_IMAGE)) {
    const { image, ratio } = unitConeImage(NAV_MARKER_COLORS.standby)
    map.addImage(UNIT_CONE_IMAGE, image, { pixelRatio: ratio })
  }

  const inNavState = (state) => ['==', ['get', 'navState'], state]
  const notNavigating = ['!=', ['get', 'navState'], NAV_STATE.navigating]

  map.addSource(UNITS_SOURCE_ID, { type: 'geojson', data: initialData })
  // The responding unit's flash: an emerald ring pulsed by the same timer as
  // the incident rings, but faster, so a moving unit draws the eye.
  map.addLayer({
    id: 'unit-pulse',
    type: 'circle',
    source: UNITS_SOURCE_ID,
    // Not under the navigation arrow. A second ring radiating out from the
    // emblem is two markers' worth of signal on one unit, and the two
    // fight: the flash says "responding" to a dispatcher reading the map,
    // which the arrow has already said louder to the officer reading the road.
    filter: ['all', ['==', ['get', 'state'], 'responding'], notNavigating],
    paint: {
      'circle-radius': 13,
      // The bright emerald, not the shield's own fill: the ring is what has to
      // carry "live, moving" on the dark basemap.
      'circle-color': NAV_MARKER_COLORS.standby,
      'circle-opacity': 0.5,
    },
  })

  /**
   * The orientation cone, at the very bottom of the unit stack.
   *
   * Under the standby ring and under the dot, because it is the GROUND the
   * marker stands on pointing somewhere — not another marker. Drawn only for
   * the feature carrying a compass reading, which is at most one: the viewer's
   * own.
   */
  map.addLayer({
    id: 'unit-cone',
    type: 'symbol',
    source: UNITS_SOURCE_ID,
    filter: ['==', ['get', 'hasCompass'], true],
    layout: {
      'icon-image': UNIT_CONE_IMAGE,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotate': ['coalesce', ['get', 'compassBearing'], 0],
      'icon-rotation-alignment': 'map',
      // Grows with the zoom rather than holding a pixel size: a field of view
      // is a thing in the WORLD, so at lot detail it should cover more of the
      // screen, the way the route line widens.
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 1],
    },
  })

  /**
   * ── STANDBY: THE ROUTE IS PLOTTED AND NOBODY HAS PRESSED GO ──────────────
   *
   * Two layers for one cue, which is the same dual-layer radar the incident
   * pins use (see `setupLayers`) and for the same reason. The RING is steady
   * and always drawn; the PULSE radiates out of it on the shared animation
   * clock. Together they read as a tracked position waiting to move.
   *
   * Splitting them is what makes reduced motion work without losing anything:
   * the pulse parks at half extent, and the steady ring is still there saying
   * the console has this unit. A single animated ring would have had to choose
   * between vanishing and sitting still mid-sweep.
   *
   * It sits UNDER the dot, so the dot is still the position and this is the
   * ground it stands on — the rule `unit-self-halo` already follows.
   */
  map.addLayer({
    id: 'unit-standby-pulse',
    type: 'circle',
    source: UNITS_SOURCE_ID,
    filter: inNavState(NAV_STATE.standby),
    paint: {
      'circle-radius': 13,
      'circle-color': NAV_MARKER_COLORS.standby,
      'circle-opacity': 0.3,
    },
  })
  map.addLayer({
    id: 'unit-standby-ring',
    type: 'circle',
    source: UNITS_SOURCE_ID,
    filter: inNavState(NAV_STATE.standby),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 15, 18, 24],
      'circle-color': NAV_MARKER_COLORS.standby,
      'circle-opacity': 0.18,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': NAV_MARKER_COLORS.standby,
      'circle-stroke-opacity': 0.65,
    },
  })
  /**
   * "You are here", for the officer looking at their own console.
   *
   * Every unit is the same white-ringed dot and state lives in the COLOUR, so
   * a guard glancing at a map with three units on it cannot tell which one is
   * them — the one thing they most need to know while driving to a call.
   *
   * A soft ring rather than a different icon, for the reason the dot is a dot:
   * changing the SHAPE for one unit would make self-ness look like a state,
   * and state is already spoken for. The halo sits beneath everything else, so
   * it reads as ground the marker stands on rather than as another marker.
   *
   * It is not an accuracy circle. `watchPosition` reports an accuracy radius
   * and this does not use it — a fixed ring that happened to look like one
   * would be asserting a precision nobody measured.
   */
  map.addLayer({
    id: 'unit-self-halo',
    type: 'circle',
    source: UNITS_SOURCE_ID,
    /**
     * Only while no navigation state owns this marker.
     *
     * The standby ring above is the same colour at nearly the same radius, and
     * the arrow replaces the dot this halo sits under. Drawing both gave the
     * routed unit two concentric blue rings a pixel or two apart, which reads
     * as a rendering fault rather than as either cue. Standby is the MORE
     * specific statement — "this unit, this call, waiting" against "this one
     * is you" — so it is the one that stays.
     */
    filter: ['all', ['==', ['get', 'isSelf'], true], ['==', ['get', 'navState'], NAV_STATE.none]],
    paint: {
      // Emerald, the responder's colour (see NAV_MARKER_COLORS): this halo is
      // the officer's own "you are here", and blue made it read as route.
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 14, 18, 26],
      'circle-color': NAV_MARKER_COLORS.standby,
      'circle-opacity': 0.16,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': NAV_MARKER_COLORS.standby,
      'circle-stroke-opacity': 0.55,
    },
  })
  // Under the dot, and only for a unit whose heading is known.
  map.addLayer({
    id: 'unit-heading',
    type: 'symbol',
    source: UNITS_SOURCE_ID,
    // Two layers can claim this marker's direction, and only one may draw it.
    //
    // The arrow states its own direction, so the beam is redundant beneath it
    // — a wedge spreading out of a chevron that already points the same way
    // just blurs the one edge a driver is reading. And the COMPASS CONE is the
    // better answer wherever it exists: it is true while stationary, where a
    // route bearing is only meaningful in motion. So the beam is what is left
    // when neither applies, which is every unit on a dispatcher's map.
    filter: [
      'all',
      ['==', ['get', 'hasHeading'], true],
      ['!=', ['get', 'hasCompass'], true],
      notNavigating,
    ],
    layout: {
      'icon-image': UNIT_HEADING_IMAGE,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
      'icon-rotation-alignment': 'map',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 18, 1],
    },
    paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.3, 0.9] },
  })

  map.addLayer({
    id: 'unit-icons',
    type: 'symbol',
    source: UNITS_SOURCE_ID,
    // ONE SILHOUETTE PER UNIT. The dot stands down for the unit that has
    // become an arrow; leaving it drawn would put a coloured disc under a blue
    // emblem and the marker would read as two overlapping units.
    filter: notNavigating,
    layout: {
      'icon-image': ['get', 'image'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 18, 1.05],
    },
    paint: {
      // A position the device has stopped refreshing is drawn faded: it says
      // where the officer WAS.
      'icon-opacity': ['case', ['get', 'stale'], 0.45, 1],
    },
  })

  /**
   * The arrow, on top of everything else this layer group draws.
   *
   * `icon-rotate` reads the SAME `bearing` property the heading beam does, and
   * it is tweened by the same animation as the position (see `unitTweenRef`) —
   * so the arrow turns through a bend instead of snapping at each new fix, and
   * it cannot disagree with the beam it replaced about which way the unit is
   * facing.
   *
   * `icon-rotation-alignment: 'map'` is what makes the bearing a compass
   * bearing: the icon turns with the world, not with the screen, so rotating
   * the map does not send the unit the wrong way.
   */
  map.addLayer({
    id: 'unit-nav-arrow',
    type: 'symbol',
    source: UNITS_SOURCE_ID,
    filter: inNavState(NAV_STATE.navigating),
    layout: {
      'icon-image': NAV_ARROW_IMAGE,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
      'icon-rotation-alignment': 'map',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.75, 18, 1],
    },
    // Stale is the one thing that still fades the arrow. A navigation session
    // running on a position that stopped updating is the case an officer most
    // needs to notice, and it is the only reason this marker is ever less than
    // fully opaque.
    paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.5, 1] },
  })

  // Hover names the unit. Built with textContent, not HTML: the name comes
  // from a Firestore document.
  const hover = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    focusAfterOpen: false,
    offset: 16,
    className: 'map-popup',
  })
  /**
   * Bound over EVERY layer a unit can be drawn on, not just the dot.
   *
   * The dot used to be the only one, and the arrow would have inherited
   * nothing: the moment a session started, the responding unit — the one a
   * dispatcher is most likely to click — became the single marker on the map
   * with no hover card and no click. The filters above decide which silhouette
   * is drawn; this decides what is clickable, and the two have to cover the
   * same set or a marker goes quietly inert.
   */
  UNIT_HIT_LAYERS.forEach((layer) => {
    map.on('mousemove', layer, (event) => {
      // The pointer only where a click does something: a page that passes no
      // `onSelectUnit` gets the hover card and an ordinary cursor, never a
      // hand over a marker that ignores the click.
      map.getCanvas().style.cursor = onSelectUnitRef.current ? 'pointer' : ''
      const feature = event.features?.[0]
      const unit = unitsRef.current.find((u) => u.uid === feature?.properties?.id)
      if (!unit) return
      const card = document.createElement('div')
      card.style.padding = '8px 10px'
      const name = document.createElement('p')
      name.style.cssText = 'margin:0;font-size:12px;font-weight:600;color:var(--color-text-primary)'
      name.textContent = unit.badgeNumber ? `${unit.name} · ${unit.badgeNumber}` : unit.name
      const state = document.createElement('p')
      state.style.cssText = 'margin:2px 0 0;font-size:11px;color:var(--color-text-secondary)'
      state.textContent = `${UNIT_STATE_TEXT[unit.state] ?? ''}${unit.stale ? ' · position stale' : ''}`
      card.append(name, state)
      hover.setLngLat(feature.geometry.coordinates).setDOMContent(card).addTo(map)
    })
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
      hover.remove()
    })
    map.on('click', layer, (event) => {
      const feature = event.features?.[0]
      const unit = unitsRef.current.find((u) => u.uid === feature?.properties?.id)
      if (unit) onSelectUnitRef.current?.(unit)
    })
  })
}

/** `LngLatBounds` around every coordinate in a FeatureCollection, or null. */
export function collectionBounds(collection) {
  const bounds = new mapboxgl.LngLatBounds()
  let points = 0
  const extend = (coordinates) => {
    if (typeof coordinates[0] === 'number') {
      bounds.extend(coordinates)
      points += 1
    } else {
      coordinates.forEach(extend)
    }
  }
  collection.features.forEach((feature) => extend(feature.geometry.coordinates))
  return points ? bounds : null
}
