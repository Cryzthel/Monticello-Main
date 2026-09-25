import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Satellite, Map as MapIcon, MapPinOff, SlidersHorizontal, ChevronDown } from 'lucide-react'
import { responsePhase, RESPONSE_PHASE_COLORS, emergencyWaveColor, EMERGENCY_COLORS } from '@shared/lib/wpda'
import MapControls from '@shared/components/MapControls'
import SegmentedControl from '@shared/components/SegmentedControl'
import { Skeleton } from '@shared/components/Skeleton'
import { useTheme } from '@shared/theme/ThemeProvider'
import { ROUTE_TONE_COLORS, UNIT_COLORS } from '@shared/theme/dispatchColors'
import {
  BOUNDARY_GEOJSON,
  BOUNDARY_STYLE,
  boundaryCenter,
  boundaryMaxBounds,
  containsPoint,
  phaseFillExpression,
} from '@shared/lib/subdivisionBoundary'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// Derived from the boundary polygon itself, so re-tracing the perimeter also
// re-centres both maps. This was previously a hardcoded pair of coordinates in
// Metro Manila — roughly 500 km from Monticello Villas — carrying a TODO.
const SUBDIVISION_CENTER = boundaryCenter()

const SOURCE_ID = 'incident-points'
const BOUNDARY_SOURCE_ID = 'subdivision-boundary'
const PANIC_SOURCE_ID = 'panic-points'

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
const INCIDENT_PULSE_REACH = 18
const PANIC_BASE_RADIUS = 10
const PANIC_PULSE_REACH = 22

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
const CONTROL_PANEL_CLEARANCE = 264

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

const DEFAULT_STYLE_KEY = 'streets'

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

function resolveMapStyle(key, theme) {
  if (key === 'streets' && theme === 'dark') return DARK_STREETS_STYLE
  return MAP_STYLES[key] ?? MAP_STYLES[DEFAULT_STYLE_KEY]
}

// The basemap toggle, in SegmentedControl's option shape. `title` keeps the
// long name on hover; the segment itself stays short enough for the panel.
const BASEMAP_OPTIONS = [
  { value: 'streets', label: 'Streets', title: 'Standard streets', icon: MapIcon },
  { value: 'satellite', label: 'Satellite', title: 'Satellite', icon: Satellite },
]

// Colour-coded so the selected filter states WHAT it selected, not merely
// that something is selected: Active borrows the "hot" response-phase red,
// Resolved the success green, All stays brand-neutral.
const FILTER_OPTIONS = [
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

// Labelled block inside the unified control container. Divider between
// sections rather than gaps between separate panels, so the whole overlay
// reads as one instrument cluster.
function ControlSection({ label, last = false, children }) {
  return (
    <div className={`p-3 ${last ? '' : 'border-b border-hairline'}`}>
      <p className="mb-2 text-caption font-medium text-text-muted">{label}</p>
      {children}
    </div>
  )
}

const PHASE_LEGEND = [
  { key: 'resolved', label: 'Resolved', description: 'Incident closed and secured' },
  { key: 'hot', label: 'Active — hot', description: 'Reported within the last 2 hours' },
  { key: 'warm', label: 'Stale — warm', description: 'Reported 2–24 hours ago' },
  { key: 'cold', label: 'Expired — cold', description: 'Older than 24 hours, still pending' },
]

// Legend for the pulsing radar ring color, a separate dimension from the
// solid pin's phase color above (pin = how stale; ring = what kind).
const EMERGENCY_LEGEND = [
  { color: EMERGENCY_COLORS.critical, label: 'Critical / medical' },
  { color: EMERGENCY_COLORS.fire, label: 'Fire / hazard' },
  { color: EMERGENCY_COLORS.maintenance, label: 'Maintenance' },
  { color: EMERGENCY_COLORS.security, label: 'Security / other' },
]

// The subdivision perimeter, added FIRST so every incident pin, badge and
// pulse draws above it.
//
// Deliberately only a fill + outline: the basemap underneath stays fully
// visible, so neighbouring streets, Balabag Elementary School and the
// surrounding terrain still provide spatial context. The boundary marks the
// premises, it does not mask everything outside them.
function setupBoundaryLayers(map) {
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

function setupLayers(map, initialData, opts) {
  const { pinRadius, incidentsRef, onSelectIncidentRef, focusInsetRef, centerOnSelectRef } = opts

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
    // ── AN SOS OUTRANKS AN ORDINARY REPORT ────────────────────────────────
    // The two hit discs are 25px and 32px against markers of 7px and 10px, so
    // widening them to match their rings also made them overlap: a report
    // filed at the same lot an SOS was raised from now shares a click. Without
    // a rule, that click opens BOTH panels — the panic modal and the incident
    // drawer, stacked, over the emergency.
    //
    // The emergency wins. `panic-hit` is queried at the click point rather
    // than relying on layer order, because z-order does not decide which
    // handlers fire — both do, independently — and the panic layer's own
    // handler is about to open the alert.
    if (map.getLayer('panic-hit') && map.queryRenderedFeatures(event.point, { layers: ['panic-hit'] }).length) {
      return
    }

    const feature = event.features?.[0]
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
  map.on('mousemove', 'incident-hit', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'incident-hit', () => {
    map.getCanvas().style.cursor = ''
  })
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
function setupPanicLayer(map, initialData, opts) {
  const { panicAlertsRef, onSelectPanicAlertRef } = opts

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
    const feature = event.features?.[0]
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
  map.on('mousemove', 'panic-hit', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'panic-hit', () => {
    map.getCanvas().style.cursor = ''
  })
}

// ── THE RESPONSE ROUTE ────────────────────────────────────────────────────
// Optional, like the panic layer: drawn only from the `route` prop, which only
// the Guard Dispatch page passes. The source is always added so the prop can
// arrive, change and clear without layers being added and removed under a
// running map.
const ROUTE_SOURCE_ID = 'response-route'
const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] }

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
 * Transport glyphs for the route origin, as Lucide draws them.
 *
 * ── WHY THE GEOMETRY IS HERE AS DATA ────────────────────────────────────────
 * A Mapbox symbol layer needs a raster it can place, not a React component, and
 * the three ways to get one are all worse than this: `renderToStaticMarkup`
 * drags react-dom/server into a map bundle, an <img> of an SVG data URL makes
 * layer setup asynchronous for one 14px glyph, and hand-tracing the shape
 * produces an icon that quietly stops matching the one in the card beside it.
 *
 * So these are Lucide's OWN path and circle definitions for `bike` and
 * `footprints` (lucide-react 1.24.0), on the same 24x24 viewBox, stroked onto a
 * canvas exactly as `routeArrowImage` above already does for the chevrons. Same
 * icon as the card, drawn synchronously, no extra dependency.
 *
 * If a Lucide upgrade redraws either icon these will not follow automatically —
 * which is why they are pinned to a version here.
 */
const TRANSPORT_IMAGES = { bike: 'route-transport-bike', foot: 'route-transport-foot' }

const TRANSPORT_GEOMETRY = {
  bike: {
    circles: [
      [18.5, 17.5, 3.5],
      [5.5, 17.5, 3.5],
      [15, 5, 1],
    ],
    paths: ['M12 17.5V14l-3-3 4-3 2 3h2'],
  },
  foot: {
    circles: [],
    paths: [
      'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z',
      'M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z',
      'M16 17h4',
      'M4 13h4',
    ],
  },
}

function transportGlyphImage(kind) {
  const ratio = 2
  const size = 15 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const geometry = TRANSPORT_GEOMETRY[kind] ?? TRANSPORT_GEOMETRY.bike
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = '#FFFFFF'
  // Lucide draws at 2; a touch heavier, because this lands on a coloured disc
  // over satellite imagery rather than on a flat panel.
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  geometry.circles.forEach(([cx, cy, r]) => {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  })
  geometry.paths.forEach((d) => ctx.stroke(new Path2D(d)))

  // getImageData ignores the transform and reads device pixels, so this is the
  // whole canvas despite the scale() above.
  return { image: ctx.getImageData(0, 0, size, size), ratio }
}

function setupRouteLayers(map, initialData) {
  map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: initialData ?? EMPTY_COLLECTION })
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
      filter: ofKind('route'),
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
}

// ── GUARD UNITS ───────────────────────────────────────────────────────────
// Optional, like the panic layer: drawn only when the page passes `units`
// (the Guard Dispatch map). One marker per on-duty officer with a position,
// coloured by what they are doing:
//   available   green-500   on duty, no call (also while a call waits for
//                           their acknowledgement)
//   responding  orange-500  flashing — accepted and moving
//   on_scene    blue-500    arrived, through investigation
// ── ONE MARKER, NOT THREE SHAPES ────────────────────────────────────────────
//
// Units were drawn as a shield inside a disc, the route origin as a plain dot,
// and a unit under way as a separate arrow image — three silhouettes for one
// thing, which is what made a dispatcher check the legend to read their own
// map. There is now a single marker: a white-ringed coloured dot, with a
// translucent beam added under it when the unit's heading is known.
//
// That is the shape every navigation app converges on, and for a good reason:
// the dot says WHERE and the beam says WHICH WAY, so a unit with no heading
// degrades to exactly the dot rather than to a different icon. State stays in
// the COLOUR, never in the shape:
//   available   green-500   on duty, no call (also while a call awaits their ack)
//   responding  orange-500  pulsing — accepted and moving
//   on_scene    blue-500    arrived, through investigation
const UNITS_SOURCE_ID = 'guard-units'
const UNIT_IMAGE = {
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

/** The dot. Sized against the incident pins so neither reads as the other. */
function unitImage(color) {
  const ratio = 2
  const size = 22 * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2

  // A shadow rather than a glow: this has to separate from satellite tiles
  // without the coloured halo that would put it in the same visual family as
  // the pulsing emergency rings, which mean something else entirely.
  ctx.shadowColor = 'rgba(15, 23, 42, 0.38)'
  ctx.shadowBlur = 3.5 * ratio
  ctx.shadowOffsetY = 1 * ratio
  ctx.beginPath()
  ctx.arc(c, c, c - 4 * ratio, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()

  ctx.shadowColor = 'transparent'
  ctx.beginPath()
  ctx.arc(c, c, c - 6.5 * ratio, 0, Math.PI * 2)
  ctx.fillStyle = color
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

const UNIT_STATE_TEXT = {
  available: 'Available',
  assigned: 'Dispatched — awaiting acknowledgement',
  responding: 'Responding',
  on_scene: 'On scene',
}

function setupUnitLayers(map, initialData, { unitsRef, onSelectUnitRef }) {
  const images = { 'unit-available': UNIT_COLORS.available, 'unit-responding': UNIT_COLORS.responding, 'unit-on-scene': UNIT_COLORS.on_scene }
  Object.entries(images).forEach(([id, color]) => {
    if (map.hasImage(id)) return
    const { image, ratio } = unitImage(color)
    map.addImage(id, image, { pixelRatio: ratio })
  })

  if (!map.hasImage(UNIT_HEADING_IMAGE)) {
    const { image, ratio } = unitHeadingImage(UNIT_COLORS.responding)
    map.addImage(UNIT_HEADING_IMAGE, image, { pixelRatio: ratio })
  }

  map.addSource(UNITS_SOURCE_ID, { type: 'geojson', data: initialData })
  // The responding unit's flash: an orange ring pulsed by the same timer as
  // the incident rings, but faster, so a moving unit draws the eye.
  map.addLayer({
    id: 'unit-pulse',
    type: 'circle',
    source: UNITS_SOURCE_ID,
    filter: ['==', ['get', 'state'], 'responding'],
    paint: {
      'circle-radius': 13,
      'circle-color': UNIT_COLORS.responding,
      'circle-opacity': 0.5,
    },
  })
  // Under the dot, and only for a unit whose heading is known.
  map.addLayer({
    id: 'unit-heading',
    type: 'symbol',
    source: UNITS_SOURCE_ID,
    filter: ['==', ['get', 'hasHeading'], true],
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

  // Hover names the unit. Built with textContent, not HTML: the name comes
  // from a Firestore document.
  const hover = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    focusAfterOpen: false,
    offset: 16,
    className: 'map-popup',
  })
  map.on('mousemove', 'unit-icons', (event) => {
    map.getCanvas().style.cursor = 'pointer'
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
  map.on('mouseleave', 'unit-icons', () => {
    map.getCanvas().style.cursor = ''
    hover.remove()
  })
  map.on('click', 'unit-icons', (event) => {
    const feature = event.features?.[0]
    const unit = unitsRef.current.find((u) => u.uid === feature?.properties?.id)
    if (unit) onSelectUnitRef.current?.(unit)
  })
}

/** `LngLatBounds` around every coordinate in a FeatureCollection, or null. */
function collectionBounds(collection) {
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

// The one map both portals render. `variant="full"` (Admin Hazard Map, Guard
// Dispatch Map) gets every widget — style switcher, legend, filter chips,

// and coverage stats — so admins have the exact same spatial view guards work
// from, not a lookalike. Design parity between the two portals is structural:
// same component, same overlays, same marker/pulse/legend styling, no
// per-portal props that change appearance. `variant="compact"` strips all of
// that down to bare pins for embedding inside a smaller card (e.g. the Guard
// Analytics page). Neither variant clusters — see setupLayers.
export default function IncidentMap({
  incidents = [],
  onSelectIncident,
  selectedIncidentId,
  panicAlerts,
  onSelectPanicAlert,
  /**
   * `{ id, lng, lat }` to fly to, or null. Keyed on `id` rather than on the
   * coordinates so asking for the SAME point twice re-runs the flight — an
   * operator who pans away and presses Locate again expects to be taken back,
   * and a coordinate-keyed effect would consider that a no-op.
   */
  focus = null,
  /**
   * Edges of the map a details panel covers, in px — `{ right, bottom }`.
   *
   * Clicking a marker centres it (see centerOnFeature), and centring it in the
   * CONTAINER would put it underneath a drawer pinned to one edge: the click
   * would open a panel over the very thing it opened the panel about. This
   * says how much of each edge is spoken for, so the marker is centred in what
   * is left rather than in the whole canvas.
   *
   * Left as a prop rather than measured here because only the page knows what
   * it renders over the map, and it changes with the breakpoint — a 26rem rail
   * on a desktop, a full-width sheet on a phone.
   */
  focusInset = null,
  /**
   * Edges a panel covers RIGHT NOW, in px — `{ right }` — or null.
   *
   * Not the same as `focusInset`. That one describes where a panel WILL be
   * once a click opens it, so a clicked marker is centred clear of it before
   * it exists. This one describes a panel that is open: the route badge is
   * centred in what it leaves, and a new route is framed clear of it. Pass it
   * only while the panel is open, or the badge sits off-centre over an empty
   * map.
   *
   * The overlay honours it from `lg` up, where the Guardhouse drawer is a
   * rail, and there it also clears the map's own controls panel while that
   * is open. Below `lg` the drawer is a bottom sheet over the whole map.
   */
  panelInset = null,
  /**
   * Should clicking a marker also centre it?
   *
   * OFF by default, which keeps the Admin Hazard Map exactly as it was. The
   * two consoles differ in what they open on a click, and that decides the
   * answer: the Guardhouse opens a rail beside the map, so the camera moving
   * the marker into the space the rail leaves is the other half of one
   * gesture. The Admin console opens a centred modal over a scrim, so a camera
   * move underneath it is motion nobody can see, spent on a map nobody is
   * looking at while the dialog is up.
   *
   * The WIDER HIT TARGET is not behind this flag and is deliberately shared:
   * a pulse ring that ignored clicks was a bug in both portals.
   */
  centerOnSelect = false,
  /**
   * On-duty guard units to draw, or undefined for no units layer at all (the
   * Admin map). `[{ uid, name, badgeNumber, state, position: { lat, lng },
   * stale }]` — see useGuardUnits in the security portal. Units without a
   * position are skipped. `onSelectUnit` is called with the unit on a click.
   */
  units,
  onSelectUnit,
  /**
   * The response route as a GeoJSON FeatureCollection, or null. Features are
   * drawn by their `kind` property — `route`, `connector`, `origin` — and
   * coloured by their `tone` — `live` or `preview` — see setupRouteLayers.
   * The camera frames a route once per call (`routeKey`), not on every refresh
   * as a moving unit's route is re-plotted.
   */
  route = null,
  /** Identifies whose route this is. The camera re-frames only when it changes. */
  routeKey = null,
  /**
   * A node floated top-centre over the map — the Guardhouse's route badge.
   * Rendered inside the map's own frame so it follows the map into its
   * maximised state, where a sibling elsewhere in the page would be covered.
   */
  overlay = null,
  /**
   * An extra section at the BOTTOM of the controls drawer.
   *
   * The drawer is where this map keeps things that are occasionally set and
   * usually ignored — basemap, layers, legends — and it is collapsed by
   * default, so anything mounted here takes two deliberate actions to reach.
   * That is the right depth for a page-specific switch that must not be easy
   * to hit by accident. Pages that pass nothing get no section.
   */
  controlsSlot = null,
  variant = 'full',
  zoom = 15,
}) {
  const isCompact = variant === 'compact'
  // Sets the badge radius and the pulse ring's starting radius, so both halves
  // of the radar scale together between the full and compact variants.
  const pinRadius = isCompact ? 5 : 7
  const hasPanicLayer = panicAlerts !== undefined

  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [mapStyleKey, setMapStyleKey] = useState(DEFAULT_STYLE_KEY)
  const { theme } = useTheme()
  // Read by the mount effect, which runs once and would otherwise close over
  // the theme of the first render.
  const themeRef = useRef(theme)
  themeRef.current = theme
  // The style URL actually on the map. The basemap effect compares against
  // this, so a re-render that wants the same style never reloads it.
  const appliedStyleRef = useRef(null)
  const [statusFilter, setStatusFilter] = useState('all')
  /**
   * Closed by default, on both portals.
   *
   * This panel is a settings drawer — basemap, layers, filters — and it was
   * open on every load, taking a 264px column out of the canvas before anyone
   * asked for it. The map is the instrument; the controls are occasional. The
   * floating trigger stays visible so nothing is hidden, only folded.
   */
  const [controlsOpen, setControlsOpen] = useState(false)
  const [ready, setReady] = useState(false)

  const incidentsRef = useRef(incidents)
  incidentsRef.current = incidents
  const onSelectIncidentRef = useRef(onSelectIncident)
  onSelectIncidentRef.current = onSelectIncident
  const panicAlertsRef = useRef(panicAlerts ?? [])
  panicAlertsRef.current = panicAlerts ?? []
  const onSelectPanicAlertRef = useRef(onSelectPanicAlert)
  onSelectPanicAlertRef.current = onSelectPanicAlert
  // Read at click time, not at layer-setup time. The layers are built once on
  // `load` (and again on a style change), so a plain closure over `focusInset`
  // would freeze whatever the first render happened to pass — and this value
  // changes with the viewport.
  const focusInsetRef = useRef(focusInset)
  // The page's panels, plus the map's own controls panel while it is open.
  focusInsetRef.current = { left: !isCompact && controlsOpen ? CONTROL_PANEL_CLEARANCE : 0, ...focusInset }
  const centerOnSelectRef = useRef(centerOnSelect)
  centerOnSelectRef.current = centerOnSelect
  const panelRight = panelInset?.right ?? 0
  const panelRightRef = useRef(panelRight)
  panelRightRef.current = panelRight
  const routeRef = useRef(route)
  routeRef.current = route
  const hasUnitLayer = units !== undefined
  const unitsRef = useRef(units ?? [])
  unitsRef.current = units ?? []
  const onSelectUnitRef = useRef(onSelectUnit)
  onSelectUnitRef.current = onSelectUnit

  const located = useMemo(
    () => incidents.filter((incident) => typeof incident.lat === 'number' && typeof incident.lng === 'number'),
    [incidents],
  )

  const filtered = useMemo(() => {
    if (statusFilter === 'resolved') return located.filter((incident) => incident.status === 'Resolved')
    if (statusFilter === 'active') return located.filter((incident) => incident.status !== 'Resolved')
    return located
  }, [located, statusFilter])

  const geojson = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: filtered.map((incident) => ({
        type: 'Feature',
        properties: {
          id: incident.id,
          // The two radar channels, computed once here and read by the two
          // layers: `phase` drives the inner badge (how the response stands),
          // `waveColor` drives the outer pulse (what kind of emergency).
          phase: responsePhase(incident),
          active: incident.status !== 'Resolved',
          waveColor: emergencyWaveColor(incident),
          selected: incident.id === selectedIncidentId,
          // Flagged, not filtered. A report pinned outside the premises is
          // either bad GPS or genuinely off-property, and both are things a
          // dispatcher needs to SEE — dropping it from the map would hide a
          // real incident, so it renders with a distinct outline instead
          // (see the 'incident-circles' stroke expression).
          inBounds: containsPoint({ lat: incident.lat, lng: incident.lng }),
        },
        geometry: { type: 'Point', coordinates: [incident.lng, incident.lat] },
      })),
    }),
    [filtered, selectedIncidentId],
  )
  // The coverage bar is centred and absolutely positioned, so the left column
  // has to be told where it ends. `bottom-20` was a hand-picked 80px and the
  // bar's top edge is at 82px — the column overlapped it by 2px. Measuring
  // instead of guessing also survives the bar gaining a stat later.
  /**
   * Bottom clearance for the map's own furniture.
   *
   * Was measured from the phase-coverage bar that used to sit along the bottom
   * of the canvas. That bar is gone — it restated on top of the map what the
   * dashboard already reports beside it, and it did so across the one strip a
   * dispatcher most often needs, the approach to a call at the bottom of the
   * view. With nothing down there to clear, this is just the frame's margin.
   */
  const barClearance = 12

  const geojsonRef = useRef(geojson)
  geojsonRef.current = geojson

  // ── AN SOS WITH NO GPS FIX ──────────────────────────────────────────────
  //
  // The mobile SOS button writes `location` CONDITIONALLY. It waits four
  // seconds for a fix and sends regardless — deliberately, and its own
  // comment says why: "A resident with location services off, or standing
  // somewhere with no fix, still needs security paged — the property record
  // on the alert already says which lot to go to."
  //
  // So a real emergency can arrive with no coordinates: services off,
  // permission denied, or simply indoors on a cold start. Such an alert has
  // no position to plot, and it previously vanished — the map filtered it
  // out and nothing else showed it.
  //
  // It is now anchored at the premises centre and drawn in the SAME huge red
  // circle, distinguished by an AMBER ring instead of a white one. That is a
  // deliberate trade and worth stating plainly: the position is an anchor,
  // not a fix, and a guard who reads it as a fix walks to the wrong place.
  //
  // Three things make that safe enough to prefer over invisibility. The ring
  // colour differs at a glance and is in the legend; the circle is the only
  // way in, and it opens a modal whose first line is "No GPS fix" with the
  // resident's lot; and the premises centre is inside the subdivision the
  // guard is already standing in, so the error is a few hundred metres, not
  // a wrong address. An invisible SOS has no error bound at all.
  const panicGeojson = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: (panicAlerts ?? []).map((alert) => {
        const located =
          typeof alert.lat === 'number' && typeof alert.lng === 'number'
        return {
          type: 'Feature',
          // `located` drives the paint expressions below. Carried as a
          // feature property rather than split into two layers so both
          // states share one click handler and one pulse animation.
          properties: { id: alert.id, located },
          geometry: {
            type: 'Point',
            coordinates: located
              ? [alert.lng, alert.lat]
              : SUBDIVISION_CENTER,
          },
        }
      }),
    }),
    [panicAlerts],
  )
  const panicGeojsonRef = useRef(panicGeojson)
  panicGeojsonRef.current = panicGeojson

  const unitsGeojson = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: (units ?? [])
        .filter((unit) => typeof unit.position?.lng === 'number' && typeof unit.position?.lat === 'number')
        .map((unit) => ({
          type: 'Feature',
          properties: {
            id: unit.uid,
            state: unit.state,
            // The dot is the same shape for everybody; only its colour moves.
            image: UNIT_IMAGE[unit.state] ?? UNIT_IMAGE.available,
            hasHeading: Number.isFinite(unit.bearing),
            bearing: Number.isFinite(unit.bearing) ? unit.bearing : 0,
            stale: Boolean(unit.stale),
          },
          geometry: { type: 'Point', coordinates: [unit.position.lng, unit.position.lat] },
        })),
    }),
    [units],
  )
  const unitsGeojsonRef = useRef(unitsGeojson)
  unitsGeojsonRef.current = unitsGeojson

  /**
   * Why the map is not on screen, when it is not.
   *
   * ── A GREY BOX EXPLAINS NOTHING ─────────────────────────────────────────
   * Three things stop this component ever painting, and until now two of them
   * were silent. A missing token had a message; a device that cannot give
   * Mapbox a WebGL context threw out of the constructor and left an empty
   * frame, and a style or tile request refused at the network (an expired
   * token, a rate limit, a captive portal on guardhouse wifi) left the
   * skeleton up forever. On a phone, over a tunnel, those are exactly the
   * failures you cannot inspect — so each one now says what happened.
   */
  const [mapFailure, setMapFailure] = useState(null)

  useEffect(() => {
    if (mapRef.current || !containerRef.current || !mapboxgl.accessToken) return

    // Checked BEFORE construction, because `new mapboxgl.Map` throws on a
    // device with no usable WebGL context and the throw escapes this effect —
    // React unmounts the tree and the operator gets a blank panel with the
    // reason only in the console, which is not somewhere a guard is looking.
    if (typeof mapboxgl.supported === 'function' && !mapboxgl.supported()) {
      setMapFailure(
        'This browser cannot display the map: WebGL is unavailable or switched off. Try the device\u2019s main browser rather than an in-app one, or enable hardware acceleration.',
      )
      return undefined
    }

    const initialStyle = resolveMapStyle(DEFAULT_STYLE_KEY, themeRef.current)
    appliedStyleRef.current = initialStyle
    const mapOptions = {
      container: containerRef.current,
      style: initialStyle,
      center: SUBDIVISION_CENTER,
      zoom,
      attributionControl: !isCompact,
      // NO maxBounds, NO derived minimum. The camera used to be fenced to the
      // premises, which sounds harmless and was not: a bounds box does not
      // merely stop panning, it also forbids every zoom level whose viewport
      // would be wider than the box. Measured, that put a hard floor around
      // zoom 17 — so "zoom out to see the subdivision in context" was not a
      // missing feature, it was a physically unreachable camera, and each
      // wheel notch into that dead band was computed and then snapped back.
      //
      // Dispatch needs both extremes: street-and-lot detail to tell a guard
      // which house, and macro context to see where a report sits relative to
      // the highway. The premises are drawn as a boundary layer, which is the
      // honest way to say "this is the estate" — a movement restriction was
      // never what communicated that.
      minZoom: 0,
      maxZoom: 22,
      // ── NORTH UP, ALWAYS ─────────────────────────────────────────────────
      // The Reset bearing button is gone (see MapControls), and a gesture
      // that can rotate the map with no button to undo it leaves a dispatcher
      // reading a sideways estate. So the gestures are off. Pitch goes with
      // them: a tilted map misplaces pins against the streets.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // ── PAN FEEL ────────────────────────────────────────────────────────
      // `dragPan` is already on by default; the reason it is written out is
      // that its OPTIONS OBJECT is the only place pan inertia can be tuned.
      // There is no `inertia: true` map option — a key by that name in this
      // constructor is silently ignored, which is the sort of thing that reads
      // as "we tried that and it did nothing".
      //
      // Mapbox merges these over its own defaults (`{...defaults, ...yours}`),
      // so the keys left out — notably `easing` — keep their stock values.
      // Its defaults are linearity 0.3, maxSpeed 1400 px/s, deceleration
      // 2500 px/s².
      //
      // Glide distance works out at roughly `speed² / (2 * deceleration *
      // linearity)`, and speed itself scales with linearity, so distance moves
      // with linearity and against deceleration. Raising one step and lowering
      // the other lands a flick about 1.6x further than stock: the map keeps
      // travelling after the thumb leaves it, which is what "effortless" means
      // on a touch screen, without sliding so far that a dispatcher overshoots
      // the lot they were aiming at.
      //
      // NOTE, so this is not mistaken for a fix to something else: inertia
      // only governs the glide AFTER release. A drag in progress is 1:1 with
      // the pointer and deliberately so — there is no sensitivity multiplier
      // on a map, and there should not be. Nothing here was slowing that down:
      // the map draws 18 GeoJSON layers on the GPU, holds no DOM markers, and
      // binds no `move` or `drag` handler, so no per-frame work runs.
      dragPan: {
        linearity: 0.35,
        maxSpeed: 1800,
        deceleration: 1800,
      },
    }

    /**
     * Construction can still throw after `supported()` says yes: a context is
     * allocated here, and a phone under memory pressure, a browser with a
     * per-tab context cap, or a webview that reports support it does not honour
     * all fail at this line. Caught, because an exception thrown out of an
     * effect unmounts the tree and takes the whole console page with it.
     */
    let map
    try {
      map = new mapboxgl.Map(mapOptions)
    } catch (err) {
      console.error('[map] could not create a Mapbox GL context', err)
      setMapFailure('The map could not start on this device. Reloading the page usually clears it.')
      return undefined
    }

    /**
     * Mapbox reports style, tile and auth failures through `error`, not by
     * throwing — so without this listener a 401 from an expired token, a 429,
     * or a blocked request leaves the skeleton up indefinitely and looks
     * identical to a slow connection.
     *
     * Only the failures that mean NO MAP are surfaced. Individual tile errors
     * fire constantly on a flaky connection and resolve themselves on the next
     * pan; promoting those to a panel would cover a working map with a warning
     * about a square that has since loaded.
     */
    map.on('error', (event) => {
      const status = event?.error?.status
      const message = event?.error?.message ?? ''
      console.error('[map] mapbox error', event?.error ?? event)
      if (status === 401 || status === 403) {
        setMapFailure('Mapbox refused this token. Check its scopes and any URL restrictions on it.')
      } else if (status === 429) {
        setMapFailure('Mapbox is rate-limiting this token right now.')
      } else if (/style/i.test(message) && /load|fetch|network/i.test(message)) {
        setMapFailure('The map style could not be loaded. Check this device’s connection.')
      }
    })

    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()

    // Scroll-to-zoom is on by Mapbox's default; stating it makes the intent
    // explicit and survives someone adding `cooperativeGestures` later. With
    // the camera unfenced above, a wheel notch now always moves the camera:
    // up zooms in, down zooms out, every notch, with nothing left to snap
    // back against.
    map.scrollZoom.enable()
    // Mapbox's stock wheel rate. An earlier pass halved it to 1/900 to tame
    // what looked like coarse zooming; the coarseness was the maxBounds
    // rubber-band, now gone. Across the full 0-22 range 1/450 is roughly a
    // level every three notches, which is the right feel for a map that has
    // to travel between lot detail and regional context.
    //
    // NOTE: this only affects real mouse wheels. Mapbox classifies input as
    // 'wheel' or 'trackpad' from delta magnitude and inter-event timing, and
    // uses its own _defaultZoomRate (1/100) for trackpads — setWheelZoomRate
    // is a no-op there.
    map.scrollZoom.setWheelZoomRate(1 / 450)

    map.on('load', () => {
      setupBoundaryLayers(map)
      setupLayers(map, geojsonRef.current, {
        pinRadius,
        incidentsRef,
        onSelectIncidentRef,
        focusInsetRef,
        centerOnSelectRef,
      })
      if (hasPanicLayer) {
        setupPanicLayer(map, panicGeojsonRef.current, { panicAlertsRef, onSelectPanicAlertRef })
      }
      // Last, because it inserts itself beneath the incident layers above.
      setupRouteLayers(map, routeRef.current)
      if (hasUnitLayer) setupUnitLayers(map, unitsGeojsonRef.current, { unitsRef, onSelectUnitRef })
      // Frame the estate by fitting the boundary rather than trusting a
      // hardcoded zoom. A fixed number only ever frames one viewport size —
      // and with the camera unfenced there is no longer a clamp quietly
      // correcting it.
      //
      // This is now the ONLY place the camera is framed for the operator: the
      // "Reset view" button that repeated it is deleted (see MapControls). A
      // reload is the way back to this shot, which is the same way back a map
      // has always had.
      map.fitBounds(boundaryMaxBounds(), { padding: 32, duration: 0 })
      setReady(true)
    })

    // Mapbox sizes its canvas from the container it was handed, and it does
    // not watch that container. Any resize the component does not forward
    // leaves the canvas at stale dimensions — which is not just a cosmetic
    // stretch: hit-testing happens in canvas pixels, so clicks land at the
    // wrong coordinates and pins stop responding. Maximising the map is the
    // biggest resize it will ever see, so this observer is what keeps pins
    // clickable there.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)

    mapRef.current = map
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(SOURCE_ID)
    if (source) source.setData(geojson)
  }, [geojson, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !hasPanicLayer) return
    const source = map.getSource(PANIC_SOURCE_ID)
    if (source) source.setData(panicGeojson)
  }, [panicGeojson, ready, hasPanicLayer])

  // ── THE ROUTE: DRAW IT, AND FRAME IT ONCE ────────────────────────────────
  //
  // Framed once per route, not once per run. This effect also re-runs after a
  // basemap switch (`ready` flips back) and when the controls panel or the
  // coverage bar change the padding, and none of those should move a camera
  // the operator may have panned since the route arrived.
  //
  // The padding keeps the route clear of the map's own furniture: the route
  // badge along the top, the coverage bar along the bottom, the controls panel
  // down the left while it is open. A map too small to honour that gets a thin
  // uniform margin instead — asked for a padding wider than its canvas, Mapbox
  // simply does not move.
  //
  // maxZoom 18: a route between neighbours is a few dozen metres, and fitting
  // it exactly would zoom until one house filled the screen.
  /**
   * Units glide between fixes instead of teleporting.
   *
   * ── WHAT IS AND IS NOT INVENTED HERE ────────────────────────────────────
   * Telemetry arrives every few seconds, so a marker driven straight from it
   * jumps twenty metres at a time and a dispatcher cannot tell movement from
   * a GPS correction. This tweens between the PREVIOUS fix and the NEW one:
   * both ends are real positions the device reported, and the tween only ever
   * fills the gap between two truths. It never extrapolates past the latest
   * fix, so the marker cannot lead the unit — at worst it is a moment behind,
   * which is the honest direction to err.
   *
   * Driven imperatively against the Mapbox source rather than through React
   * state: this runs a frame at a time, and re-rendering the dashboard sixty
   * times a second to move a dot would cost far more than it shows.
   */
  const unitTweenRef = useRef({ frame: 0, positions: new Map() })
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !hasUnitLayer) return undefined
    const source = map.getSource(UNITS_SOURCE_ID)
    if (!source) return undefined

    const tween = unitTweenRef.current
    const from = tween.positions
    const target = new Map(
      unitsGeojson.features.map((f) => [f.properties.id, f.geometry.coordinates]),
    )

    // A unit appearing for the first time, or returning after its fix went
    // stale, is placed rather than flown in from wherever it used to be.
    const starts = new Map()
    target.forEach((coords, id) => starts.set(id, from.get(id) ?? coords))

    cancelAnimationFrame(tween.frame)
    const DURATION_MS = 900
    const startedAt = performance.now()

    const paint = (t) => {
      const eased = t >= 1 ? 1 : 1 - (1 - t) * (1 - t) // easeOutQuad
      const features = unitsGeojson.features.map((feature) => {
        const id = feature.properties.id
        const a = starts.get(id)
        const b = target.get(id)
        if (!a || !b || eased >= 1) return feature
        return {
          ...feature,
          geometry: {
            type: 'Point',
            coordinates: [a[0] + (b[0] - a[0]) * eased, a[1] + (b[1] - a[1]) * eased],
          },
        }
      })
      source.setData({ type: 'FeatureCollection', features })
    }

    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / DURATION_MS)
      paint(t)
      if (t < 1) {
        tween.frame = requestAnimationFrame(step)
      } else {
        tween.positions = target
      }
    }

    tween.frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(tween.frame)
  }, [unitsGeojson, ready, hasUnitLayer])

  const fittedRouteRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(ROUTE_SOURCE_ID)
    if (source) source.setData(route ?? EMPTY_COLLECTION)

    // Once per call and unit, not once per collection: a responding unit's
    // route is re-plotted every few seconds, and re-framing each time would
    // yank the camera away from whatever the dispatcher panned to.
    const frameKey = routeKey ?? route
    if (!route || fittedRouteRef.current === frameKey) return
    fittedRouteRef.current = frameKey
    const bounds = collectionBounds(route)
    if (!bounds) return

    const { clientWidth, clientHeight } = map.getContainer()
    // Clear of the details drawer when one is open over the right edge, on
    // the same "only if the map is twice as wide" rule centerOnFeature uses.
    const insetRight = panelRightRef.current
    let padding = {
      top: 72,
      right: 64 + (insetRight > 0 && clientWidth > insetRight * 2 ? insetRight : 0),
      bottom: barClearance + 16,
      left: !isCompact && controlsOpen ? CONTROL_PANEL_CLEARANCE : 64,
    }
    if (padding.left + padding.right > clientWidth - 120 || padding.top + padding.bottom > clientHeight - 120) {
      padding = 32
    }
    map.fitBounds(bounds, { padding, maxZoom: 18, duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, routeKey, ready, barClearance, controlsOpen, isCompact])

  // ── LOCATE: FLY TO A POINT THE OPERATOR CANNOT SEE ───────────────────────
  //
  // One caller — the Panic Alerts page's Locate action, arriving as `?panic=`.
  //
  // `flyTo` rather than `jumpTo`: an operator arriving from a TABLE has no idea
  // where on the subdivision they have landed, and the animated sweep is what
  // tells them which way the map moved and how far. That arc is exactly wrong
  // for a marker already on screen — see centerOnFeature, which is what a click
  // uses instead — and exactly right here.
  //
  // z17 because "show me this emergency" means street detail, and `Math.max`
  // means it never zooms OUT: someone already inspecting at z19 wants the
  // camera moved, not their working scale reset. No inset either — nothing is
  // open over the map when a deep link lands.
  //
  // A second mode ('inspect', a gentle re-centre) briefly lived here for the
  // drawer's Recentre button. That button is gone — it duplicated the camera
  // move every marker click already makes — and the branch went with it rather
  // than staying as an unreachable option.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focus) return
    if (typeof focus.lng !== 'number' || typeof focus.lat !== 'number') return

    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: Math.max(map.getZoom(), 17),
      duration: 900,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id, ready])

  // Drives both pulse layers' radius/opacity on a timer rather than a full
  // requestAnimationFrame loop — this is a background ambient cue, not a
  // smooth animation, so ~15fps is plenty and far cheaper on the GPU.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined

    const interval = setInterval(() => {
      if (!map.isStyleLoaded()) return
      const now = Date.now()

      if (map.getLayer('incident-pulse')) {
        const t = (now % 1600) / 1600
        // INCIDENT_PULSE_REACH, not a literal 18: `incident-hit` is sized from
        // the same constant, so the disc a dispatcher can click and the ring
        // they are aiming at cannot be edited apart from each other.
        map.setPaintProperty('incident-pulse', 'circle-radius', pinRadius + t * INCIDENT_PULSE_REACH)
        map.setPaintProperty('incident-pulse', 'circle-opacity', 0.55 * (1 - t))
      }
      if (map.getLayer('panic-pulse')) {
        // 900ms, not 1100 — faster than the incident pulse (1600ms) so the
        // two read as different urgencies even in peripheral vision, which
        // is where this has to work.
        const t = (now % 900) / 900
        // Reaches 32px against the incident pulse's 25px — a shade wider,
        // and local to the marker. At the old 90px it was a wash across a
        // quarter of the viewport that dimmed everything under it. Same
        // constants `panic-hit` is sized from, for the same reason.
        map.setPaintProperty('panic-pulse', 'circle-radius', PANIC_BASE_RADIUS + t * PANIC_PULSE_REACH)
        map.setPaintProperty('panic-pulse', 'circle-opacity', 0.6 * (1 - t))
      }
      if (map.getLayer('unit-pulse')) {
        // A responding unit flashes: its ring pulses at 1.1 s and the marker
        // itself dips, which reads as "moving" where a steady glow would
        // read as "here".
        const t = (now % 1100) / 1100
        map.setPaintProperty('unit-pulse', 'circle-radius', 13 + t * 14)
        map.setPaintProperty('unit-pulse', 'circle-opacity', 0.5 * (1 - t))
        const flash = 0.55 + 0.45 * Math.abs(Math.cos(Math.PI * t))
        map.setPaintProperty('unit-icons', 'icon-opacity', [
          'case',
          ['get', 'stale'], 0.45,
          ['==', ['get', 'state'], 'responding'], flash,
          1,
        ])
      }
    }, 65)

    return () => clearInterval(interval)
  }, [pinRadius])

  // Custom sources/layers don't survive a setStyle() call, so the pins and the
  // panic layer all get re-added once the new style loads.
  function rebuildLayers(map) {
    setupBoundaryLayers(map)
    setupLayers(map, geojsonRef.current, {
      pinRadius,
      incidentsRef,
      onSelectIncidentRef,
      focusInsetRef,
      centerOnSelectRef,
    })
    if (hasPanicLayer) {
      setupPanicLayer(map, panicGeojsonRef.current, { panicAlertsRef, onSelectPanicAlertRef })
    }
    setupRouteLayers(map, routeRef.current)
    if (hasUnitLayer) setupUnitLayers(map, unitsGeojsonRef.current, { unitsRef, onSelectUnitRef })
  }

  function toggleStyle(key) {
    if (key === mapStyleKey) return
    setMapStyleKey(key)
  }

  // ── ONE PLACE DECIDES THE BASEMAP ──────────────────────────────────────
  // Two things choose the style now — the Streets/Satellite toggle and the
  // portal theme — so the switch lives here rather than in the toggle handler,
  // where a theme change would never have reached it.
  //
  // Gated on `ready`. A switch requested while a style is still loading waits,
  // and runs when `ready` returns and the comparison is made again. The old
  // handler switched immediately, so two quick toggles registered two
  // `style.load` listeners that both rebuilt the layers — the second rebuild
  // then threw on sources that already existed.
  //
  // `diff: false` forces a full reload. By default Mapbox tries to DIFF the new
  // style against the current one, and when a diff succeeds it removes this
  // component's custom layers as "not in the new style" without ever firing
  // `style.load` — so the rebuild below would never run and every pin would
  // vanish. A full reload always fires it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const wanted = resolveMapStyle(mapStyleKey, theme)
    if (wanted === appliedStyleRef.current) return
    appliedStyleRef.current = wanted
    setReady(false)
    map.setStyle(wanted, { diff: false })
    map.once('style.load', () => {
      rebuildLayers(map)
      setReady(true)
    })
    // rebuildLayers reads refs only; listing it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyleKey, theme, ready])

  // MAXIMISE IS CSS, NOT THE FULLSCREEN API — and that is the fix for pins
  // going dead in fullscreen.
  //
  // The old control called requestFullscreen() on the map's own wrapper. The
  // browser then renders ONLY that element's subtree in the top layer, and
  // everything else in the document is hidden. Pins were still clickable in
  // the literal sense — the click fired, the incident was selected, React
  // rendered IncidentDetailModal — but the modal lives in the page tree, a
  // sibling of the map, so it was outside the fullscreen subtree and never
  // appeared. Same for the portalled Tooltip and every future floating layer.
  // Indistinguishable, from the guard's chair, from a pin that does nothing.
  //
  // So the map is maximised with position/z-index instead. The whole document
  // stays live, the modal at z-50 opens over the map at z-40, and nothing has
  // to know about the top layer. Native fullscreen is still requested — on
  // documentElement, so the entire app is the fullscreen element and no
  // subtree is excluded — purely to hide browser chrome; if it is refused
  // (no user gesture, an iframe without allowfullscreen) the maximised view
  // works anyway.
  const [maximized, setMaximized] = useState(false)

  function toggleMaximized() {
    const next = !maximized
    setMaximized(next)
    if (next) document.documentElement.requestFullscreen?.().catch(() => {})
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }

  // Two ways out, because there are two ways in and they can come apart.
  //
  // When the browser granted native fullscreen, Escape exits it without
  // telling React and without firing a key event the page can see — only
  // fullscreenchange reports it, so that listener is what stops the maximised
  // flag getting stuck on. When fullscreen was REFUSED (no user gesture, an
  // iframe without allowfullscreen) there is no fullscreenchange to hear and
  // Escape would do nothing at all, leaving the guard covered by a fixed
  // sheet with only the toolbar button to escape it. So the key is handled
  // directly as well, and the two are idempotent.
  useEffect(() => {
    if (!maximized) return undefined
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setMaximized(false)
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setMaximized(false)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('keydown', onKeyDown)
    // The page behind is fully covered, so leaving it scrollable only lets a
    // stray wheel event that the map did not consume drift it out from under
    // the guard while they are looking at something else.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [maximized])

  // The ResizeObserver above already forwards the size change, but it fires
  // from layout and Mapbox needs the canvas correct before the next paint —
  // hit-testing is done in canvas pixels, so a frame at the old size is a
  // frame where clicks land in the wrong place. Resizing again after the
  // browser has settled the new box makes that window impossible.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const frame = requestAnimationFrame(() => map.resize())
    return () => cancelAnimationFrame(frame)
  }, [maximized])

  return (
    // `isolate` creates a stacking context so the z-10 floating overlays are
    // scoped to the map. Without it they compete in the page's root stacking
    // order and can paint over adjacent dashboard cards (the metrics bar on
    // the Guard dispatch view). `overflow-hidden` keeps the Mapbox canvas
    // inside the rounded frame instead of bleeding past the corners.
    //
    // Maximised, the same element becomes a fixed z-40 sheet. z-40 is chosen
    // against the modals at z-50: the map covers the dashboard beneath it and
    // an incident pop-up still opens on top of the map. See toggleMaximized
    // for why this is a CSS state and not the element's own fullscreen.
    <div
      // `relative` MUST live in the branch, not the base. Tailwind emits
      // .relative and .fixed at equal specificity, so listing both on one
      // element is resolved by stylesheet order, not by which came later in
      // the attribute — `relative` wins, the element never leaves the flow,
      // and with h-full also dropped it collapses to zero height. A map with
      // no height has nothing to hit-test, which reads as "fullscreen killed
      // the pins" when the pins were never the problem.
      className={`isolate overflow-hidden ${
        maximized ? 'fixed inset-0 z-40 rounded-none' : 'relative h-full w-full rounded-none lg:rounded-lg'
      }`}
      aria-busy={ready ? undefined : true}
    >
      {/* ── LOADING: A RESERVATION, NOT A SPINNER ───────────────────────────
          Until Mapbox fires `load` its canvas is transparent, so the frame
          showed an empty rectangle with nothing saying a map was coming —
          the one data panel in either portal with no loading state. This
          fills the frame with the same skeleton surface every other panel
          uses and fades out when the first render lands.

          TWO ELEMENTS, NOT ONE. The skeleton's pulse animates `opacity`, and a
          running animation overrides a static `opacity-0`, so a fade class on
          the skeleton itself would leave it pulsing over the map forever. The
          wrapper owns the fade; the inner pulse is switched off once ready, so
          an invisible full-frame layer is not re-composited on every pan.

          Never takes pointer events, sits under the z-10 controls, and the
          frame's `aria-busy` is what a screen reader hears, per the skeleton
          contract. A basemap switch clears `ready` too, so the same veil
          covers the style reload. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-[1] transition-opacity duration-300 ease-out ${
          ready ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <Skeleton variant="surface" className={`h-full w-full rounded-none ${ready ? 'animate-none' : ''}`} />
      </div>

      {/* No banner, no pill, no floating card. Everything a panic alert has
          to say is on the map itself — the circle announces it, and clicking
          the circle opens the controls. */}
      {!isCompact ? (
        <>
          {/* ONE control container, three labelled sections: style, filters,
              legend. Previously these were three separate floating overlays
              (left column + top-right chips) that each had to be positioned
              and kept clear of one another by hand; consolidating them means
              the layout can't collide as any section's content grows, and both
              portals inherit the identical arrangement.

              Bounded top-3 → the measured top of the coverage bar, with an
              internally scrollable body — the map container itself must NOT be
              overflow-y-auto or it would fight Mapbox's scroll-to-zoom. */}
          <div
            style={{ bottom: barClearance }}
            className="pointer-events-none absolute left-3 top-3 z-10 flex w-[15rem] flex-col"
          >
            {/* Solid surface, not glass. A backdrop-blur panel sitting on top of
                a moving map has to recomposite the blurred region every frame
                while panning, and the map showing through made the legend
                swatches hard to read against satellite imagery. Slate-900 with
                a crisp border and a soft shadow is cheaper and more legible. */}
            <div
              className={`pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-xl border border-hairline bg-base-850 shadow-overlay ${
                controlsOpen ? '' : 'self-start'
              }`}
            >
              <button
                type="button"
                onClick={() => setControlsOpen((prev) => !prev)}
                aria-expanded={controlsOpen}
                className={`flex shrink-0 items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-tint/[0.03] ${
                  controlsOpen ? 'border-b border-hairline' : ''
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-brand-400" />
                <span className="flex-1 text-xs font-semibold text-text-primary">
                  Map controls
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200 ${
                    controlsOpen ? '' : '-rotate-90'
                  }`}
                />
              </button>

              <div
                className={`custom-scrollbar min-h-0 overflow-y-auto transition-[opacity] duration-150 ${
                  controlsOpen ? 'flex-1 opacity-100' : 'hidden opacity-0'
                }`}
              >
                <ControlSection label="Map style">
                  {/* Segmented toggle: exactly two basemaps, so a segmented
                      control reads faster than a dropdown that would hide one
                      of the only two choices behind a click. */}
                  <SegmentedControl
                    fullWidth
                    ariaLabel="Map style"
                    segmentClassName="px-2.5"
                    options={BASEMAP_OPTIONS}
                    value={mapStyleKey}
                    onChange={toggleStyle}
                  />
                </ControlSection>

                <ControlSection label="Response status">
                  {/* One line, always. `flex-wrap` let All / Active /
                      Resolved break to a second row inside the control panel
                      at narrower widths, which pushed everything below them
                      down and made the panel change height as the map
                      resized. Three chips at the compact inset fit the panel
                      with room to spare, and `min-w-0` lets a label ellipsize
                      rather than force a wrap if it ever does not. */}
                  <div className="flex flex-nowrap gap-1">
                    {FILTER_OPTIONS.map((chip) => {
                      const selected = statusFilter === chip.key
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setStatusFilter(chip.key)}
                          // A filter chip in its status's own colour when on;
                          // the dot is the status key, so the fill stays tonal.
                          // Compact inset: `.chip` ships px-3 py-1.5 for a
                          // standalone filter row; inside the map's control
                          // panel that is more padding than the space allows.
                          className={`chip min-w-0 px-2.5 py-1 ${
                            selected ? `border-transparent ring-1 ring-inset ${chip.activeChip}` : 'chip-idle'
                          }`}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: chip.dot }}
                          />
                          {chip.label}
                        </button>
                      )
                    })}
                  </div>
                </ControlSection>

                <ControlSection label="Pin — response phase">
                  <div className="flex flex-col gap-2">
                    {PHASE_LEGEND.map((item) => (
                      <div key={item.key} className="flex items-start gap-2">
                        <span
                          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/70"
                          style={{ backgroundColor: RESPONSE_PHASE_COLORS[item.key] }}
                        />
                        <div className="min-w-0">
                          <p className="text-caption font-medium leading-tight text-text-primary">{item.label}</p>
                          <p className="text-2xs leading-tight text-text-secondary">{item.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ControlSection>

                <ControlSection label="Premises">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-0 w-4 shrink-0 rounded-full border-t-[3px]"
                        style={{
                          borderColor: BOUNDARY_STYLE.stroke,
                          boxShadow: `0 0 0 1px ${BOUNDARY_STYLE.casing}`,
                        }}
                      />
                      <p className="text-caption text-text-secondary">Monticello Villas boundary</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-transparent"
                        style={{ borderColor: BOUNDARY_STYLE.casing }}
                      />
                      <p className="text-caption text-text-secondary">Pin outside premises</p>
                    </div>
                  </div>
                </ControlSection>

                {hasUnitLayer ? (
                  <ControlSection label="Units and routes">
                    <div className="flex flex-col gap-2">
                      {[
                        ['available', 'Available', 'On duty, no call'],
                        ['responding', 'Responding', 'Flashing — en route'],
                        ['on_scene', 'On scene', 'Arrived, investigating'],
                      ].map(([key, label, description]) => (
                        <div key={key} className="flex items-start gap-2">
                          <span
                            className="mt-0.5 h-3 w-3 shrink-0 rounded-full ring-2 ring-white/80"
                            style={{ backgroundColor: UNIT_COLORS[key] }}
                          />
                          <div className="min-w-0">
                            <p className="text-caption font-medium leading-tight text-text-primary">{label}</p>
                            <p className="text-2xs leading-tight text-text-secondary">{description}</p>
                          </div>
                        </div>
                      ))}
                      {[
                        ['live', 'Live route — unit en route'],
                        ['preview', 'Preview — not yet acknowledged'],
                      ].map(([tone, label]) => (
                        <div key={tone} className="flex items-center gap-2">
                          <span
                            className="h-1 w-4 shrink-0 rounded-full"
                            // Solid swatch, no coloured halo. The glow was
                            // decoration imitating the route's glow layer on
                            // the canvas, where that stroke does real work
                            // holding the line legible over satellite tiles.
                            // In a legend it was doing none of that.
                            style={{ backgroundColor: ROUTE_TONE_COLORS[tone] }}
                          />
                          <p className="text-caption text-text-secondary">{label}</p>
                        </div>
                      ))}
                    </div>
                  </ControlSection>
                ) : null}

                {controlsSlot ? (
                  <ControlSection label="Demonstration" last>
                    {controlsSlot}
                  </ControlSection>
                ) : null}

                <ControlSection label="Pulse ring — emergency type" last>
                  <div className="flex flex-col gap-1.5">
                    {EMERGENCY_LEGEND.map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        {/* Hollow ring, not a solid dot — this legend row
                            describes the expanding pulse, so it should look
                            like one rather than duplicating the pin swatch. */}
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border-2"
                          style={{ borderColor: item.color }}
                        />
                        <p className="text-caption text-text-secondary">{item.label}</p>
                      </div>
                    ))}
                    {/* ONE SOS key, not two. The amber-ringed variant had its
                        own row reading "SOS — location approximate"; the legend
                        now names the marker, and the reason a particular one is
                        amber is stated in full where it is actionable — the
                        alert modal, which leads with "No GPS fix" and the lot to
                        respond to. See PanicAlertModal. */}
                    {hasPanicLayer ? (
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/60"
                          style={{ backgroundColor: EMERGENCY_COLORS.critical }}
                        />
                        <p className="text-caption font-medium text-text-primary">Panic alerts (SOS)</p>
                      </div>
                    ) : null}
                  </div>
                </ControlSection>
              </div>
            </div>
          </div>

        </>
      ) : null}

      {overlay ? (
        <div
          style={{
            '--overlay-left': `${!isCompact && controlsOpen ? CONTROL_PANEL_CLEARANCE : 12}px`,
            '--overlay-right': `${12 + panelRight}px`,
          }}
          className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center lg:[left:var(--overlay-left)] lg:[right:var(--overlay-right)]"
        >
          {overlay}
        </div>
      ) : null}

      {mapFailure ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-base-900/95 p-6 text-center">
          <div className="max-w-xs">
            <MapPinOff aria-hidden="true" className="mx-auto mb-2 h-6 w-6 text-text-muted" />
            <p className="text-sm font-medium text-text-primary">The map is not available</p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">{mapFailure}</p>
          </div>
        </div>
      ) : null}

      {!mapboxgl.accessToken ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-base-950 text-sm text-text-secondary">
          Set VITE_MAPBOX_TOKEN to enable the incident map.
        </div>
      ) : null}

      {/* Rendered as a sibling of the canvas, not a Mapbox control: these are
          ordinary React buttons, so they get the portal's tokens, the shared
          Tooltip, and state (bearing, fullscreen) without an adapter class. */}
      <MapControls
        map={mapRef.current}
        ready={ready}
        compact={isCompact}
        maximized={maximized}
        onToggleMaximized={toggleMaximized}
      />

      <div ref={containerRef} className="h-full w-full" />

    </div>
  )
}
