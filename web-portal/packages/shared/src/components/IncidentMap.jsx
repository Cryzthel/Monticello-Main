import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  Bike,
  ChevronDown,
  Footprints,
  Map as MapIcon,
  MapPinOff,
  Satellite,
  SlidersHorizontal,
} from '@shared/icons'
import { responsePhase, RESPONSE_PHASE_COLORS, emergencyWaveColor, EMERGENCY_COLORS } from '@shared/lib/wpda'
import { categoryLabel } from '@shared/lib/incidentCategories'
import { relativeTime } from '@shared/lib/notifications'
import MapControls from '@shared/components/MapControls'
import { Skeleton } from '@shared/components/Skeleton'
import { useTheme } from '@shared/theme/ThemeProvider'
import { NAV_MARKER_COLORS, ROUTE_TONE_COLORS, UNIT_COLORS } from '@shared/theme/dispatchColors'
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
const BASEMAP_OPTIONS = [
  { value: 'streets', label: 'Streets', icon: MapIcon },
  { value: 'satellite', label: 'Satellite', icon: Satellite },
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

/**
 * ── THE MARKER PREVIEW ─────────────────────────────────────────────────────
 *
 * What a pulse ring says before anyone commits to opening it.
 *
 * SOLID, like every other surface floating over this map, for the reason the
 * controls panel states in full: a blurred panel over a moving canvas has to
 * recomposite its whole region on every frame of a pan, and the map showing
 * through makes small type unreadable over satellite imagery.
 *
 * Deliberately NOT the shared `Tooltip`. That component anchors to a DOM
 * element it wraps, and these markers are drawn inside a WebGL canvas — there
 * is no element to wrap. The position comes from `map.project()` instead.
 *
 * `aria-hidden`, and honestly so. Mapbox renders the whole map as ONE canvas
 * element, so there is no per-marker node to focus and no keyboard route to
 * this card — announcing it would promise a way in that does not exist. The
 * same facts are reachable without a pointer from the incidents table, which
 * is a real list of real rows, and every one of them opens the same panel.
 */
function HoverPreview({ record }) {
  if (!record) return null

  const isPanic = record.kind === 'panic'
  const data = isPanic ? record.alert : record.incident
  const address = [data.phase && `Phase ${data.phase}`, data.block && `Block ${data.block}`, data.lot && `Lot ${data.lot}`]
    .filter(Boolean)
    .join(' • ')

  // The ring's own colour, so the card and the marker it describes are
  // obviously the same object. An SOS is always critical red.
  const accent = isPanic ? EMERGENCY_COLORS.critical : emergencyWaveColor(data)
  const phase = isPanic ? null : responsePhase(data)

  return (
    <div
      aria-hidden="true"
      className="w-[15.5rem] -translate-x-1/2 -translate-y-full pb-2.5"
    >
      <div className="overflow-hidden rounded-xl border border-hairline bg-base-850 shadow-overlay">
        <div className="flex items-start gap-2 px-3 pb-2 pt-2.5">
          <span
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70"
            style={{ backgroundColor: accent }}
          />
          <div className="min-w-0 flex-1">
            {/* Two lines, not one. The title is the headline of the card, and
                at 248px wide a single truncated line cut most real report
                titles mid-word — "Fallen power line across t…" answers less
                than the category underneath it does. Two lines hold almost
                every title whole; anything longer still ellipsizes. */}
            <p className="line-clamp-2 text-xs font-semibold leading-tight text-text-primary">
              {isPanic ? 'SOS — Emergency' : data.title || categoryLabel(data.category)}
            </p>
            <p className="mt-0.5 truncate text-2xs leading-tight text-text-secondary">
              {isPanic ? data.residentName : categoryLabel(data.category)}
            </p>
          </div>
          {/* The phase word, not a full StatusBadge: this card is 248px wide
              and the badge's padding would push the title into a second line
              on every hover. */}
          {phase ? (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-semibold capitalize"
              style={{ backgroundColor: `${RESPONSE_PHASE_COLORS[phase]}1F`, color: RESPONSE_PHASE_COLORS[phase] }}
            >
              {phase}
            </span>
          ) : null}
        </div>

        <div className="border-t border-hairline px-3 py-2">
          <p className="truncate text-2xs leading-tight text-text-secondary">{address || 'Address unavailable'}</p>
          <p className="mt-0.5 text-2xs leading-tight text-text-muted">
            {relativeTime(isPanic ? data.createdAt : data.reportedAt)}
          </p>
        </div>
      </div>

      {/* The notch. Without it the card floats unattached, and with six pins
          in a cluster there is nothing saying which one it belongs to. Border
          on two sides only, so the card's own bottom edge does not draw
          through it. */}
      <div className="flex justify-center">
        <span className="-mt-[0.4375rem] h-2.5 w-2.5 rotate-45 border-b border-r border-hairline bg-base-850" />
      </div>
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
function setupPanicLayer(map, initialData, opts) {
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
const UNIT_TWEEN_MS = 900

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
function applyRouteTrim(map, fraction) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  ROUTE_TRIMMED_LAYERS.forEach((id) => {
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-trim-offset', [0, f])
  })
}

/** The `trim` the route collection carries — the travelled fraction — or 0. */
function routeTrimOf(collection) {
  const feature = collection?.features?.find(
    (f) => f.properties?.kind === 'route' && Number.isFinite(f.properties?.trim),
  )
  return feature ? feature.properties.trim : 0
}

function setupRouteLayers(map, initialData) {
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
const NAV_STATE = { none: '', standby: 'standby', navigating: 'navigating' }

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
const NAV_CAMERA = { zoom: 17.5, pitch: 50 }

/** The sweep INTO a session. Long enough to read as a move, not a cut. */
const NAV_ENTER_MS = 1200
/** Per-fix follow, matched to the marker tween so the two arrive together. */
const NAV_FOLLOW_MS = 900

/** Layers a unit can be clicked or hovered on — the dot, and the arrow it becomes. */
const UNIT_HIT_LAYERS = ['unit-icons', 'unit-nav-arrow']

const UNIT_STATE_TEXT = {
  available: 'Available',
  assigned: 'Dispatched — awaiting acknowledgement',
  responding: 'Responding',
  on_scene: 'On scene',
}

function setupUnitLayers(map, initialData, { unitsRef, onSelectUnitRef }) {
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
  /**
   * Keep the camera on this unit as it moves, the way a phone does while
   * navigating. Pass the uid to follow, or null for a free camera.
   */
  /**
   * The uid of the unit that is THIS viewer, if they are one. Draws a halo
   * under their own marker so an officer can find themselves on a map where
   * every unit is the same shape.
   */
  selfUnitId = null,
  /**
   * The compass bearing of THIS console's own device, in degrees, or null.
   *
   * Drawn as an orientation cone on `selfUnitId`'s marker and nowhere else —
   * it is this device's hardware reading and means nothing about any other
   * unit. Null whenever the device has no compass, the browser refused the
   * permission, or nothing is listening (see useDeviceHeading), and the
   * marker then falls back to the route-derived heading beam.
   */
  selfHeading = null,
  followUnitId = null,
  /**
   * The uid of the unit the current route STARTS FROM, or null.
   *
   * ── WHY THE MAP IS TOLD THIS SEPARATELY FROM `followUnitId` ──────────────
   * They are usually the same uid and they answer different questions.
   * `followUnitId` is a camera instruction. This one, with `navigating` below,
   * drives the marker's state machine: which unit gets the standby ring, and
   * which one becomes the arrow. A dispatcher can follow a unit without
   * navigating, and a navigation session survives a pan that clears follow
   * mode (see DashboardPage) — so one prop could not have served both without
   * the marker changing shape every time somebody dragged the map.
   */
  routeUnitId = null,
  /**
   * Is a navigation session running for `routeUnitId`?
   *
   * false with a `routeUnitId` set means STANDBY — a route is plotted and
   * nobody has pressed Start Navigation. See NAV_STATE.
   */
  navigating = false,
  /**
   * `{ lat, lng }` to centre the opening navigation flight on, or null.
   *
   * The caller's best answer to "where is this officer RIGHT NOW", for the one
   * frame where that question is worth asking directly: the press of Start
   * Navigation. Read once, at the transition — the per-fix follow takes over
   * immediately afterwards — so a value that goes stale a second later costs
   * nothing.
   *
   * Null is the normal case and not a failure: a dispatcher following somebody
   * else's unit has no better source than the marker, and the camera uses it.
   */
  navAnchor = null,
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
   * A node floated top-centre over the map — the Guardhouse's turn-guidance
   * banner. Rendered inside the map's own frame so it follows the map into
   * its maximised state, where a sibling elsewhere in the page would be
   * covered.
   */
  overlay = null,
  /**
   * A node anchored to the BOTTOM of the map on a phone, and stacked under
   * `overlay` on anything wider — the route details panel.
   *
   * ── WHY THE TWO SLOTS ARE SEPARATE ───────────────────────────────────────
   * They were one. That worked while both lived at the top of the map on
   * every screen, and stopped working the moment the details panel became a
   * bottom sheet: a turn banner is the one thing that must not follow it
   * down there. A driver's eyes go up; the bottom of a phone is where a thumb
   * rests and where a sheet gets dragged over.
   *
   * One CONTAINER, two slots, is what keeps that from needing two sets of
   * positioning maths. The container spans the map, the banner sits at its
   * start, and `mt-auto` pushes the sheet to the far end on a phone and is
   * switched off above `sm`, where the two simply stack. Nothing measures
   * anything.
   */
  sheet = null,
  /**
   * The All / Active / Resolved filter. Off on the guard's dispatch map,
   * which only ever holds OPEN calls: there "Resolved" was always empty and
   * "Active" identical to "All" — a control with nothing to do.
   */
  showStatusFilter = true,
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
   * This panel is a settings drawer — filters and legends — and it was open on
   * every load, taking a 264px column out of the canvas before anyone asked
   * for it. The map is the instrument; the controls are occasional. The
   * floating trigger stays visible so nothing is hidden, only folded.
   *
   * It is now legends and one filter row. The basemap toggle moved to the
   * top-right corner (reading the map, not configuring it) and the
   * page-specific `controlsSlot` was deleted with the simulation and follow
   * controls that were its only tenant, so this no longer holds anything a
   * page passes in.
   */
  const [controlsOpen, setControlsOpen] = useState(false)
  const [ready, setReady] = useState(false)
  /**
   * Which marker the pointer is over — `{ kind, id, lngLat }` or null.
   *
   * The pulse ring was, until now, a thing you could only interrogate by
   * opening it. A dispatcher scanning a cluster of six pins had to open and
   * close six panels to learn what they were, and each one moved the camera
   * and covered the map. The preview answers the question the hover is
   * actually asking — what IS this — without committing to anything.
   */
  const [hovered, setHovered] = useState(null)

  // Read by the navigation transition effect, which must NOT re-run when a
  // fresher fix arrives — that is the follow effect's job.
  const navAnchorRef = useRef(navAnchor)
  navAnchorRef.current = navAnchor

  const incidentsRef = useRef(incidents)
  incidentsRef.current = incidents
  const onSelectIncidentRef = useRef(onSelectIncident)
  onSelectIncidentRef.current = onSelectIncident
  const panicAlertsRef = useRef(panicAlerts ?? [])
  panicAlertsRef.current = panicAlerts ?? []
  const onSelectPanicAlertRef = useRef(onSelectPanicAlert)
  onSelectPanicAlertRef.current = onSelectPanicAlert
  // The node the preview card renders into, positioned imperatively below.
  const hoverCardRef = useRef(null)
  /**
   * `mousemove` fires on every frame the pointer is inside a hit disc, so a
   * handler that called `setHovered` with a fresh object each time would
   * re-render this component — and the whole controls tree with it — sixty
   * times a second while someone simply rests their cursor on a pin.
   *
   * This collapses the stream down to the only event React needs to hear:
   * the hovered marker CHANGED. Re-rendering then happens once per marker,
   * not once per frame. The card's position is not state at all — see the
   * projection effect below.
   */
  const hoveredRef = useRef(null)
  const onHoverRef = useRef(null)
  onHoverRef.current = (next) => {
    const prev = hoveredRef.current
    const same = next === null ? prev === null : prev?.id === next.id && prev?.kind === next.kind
    if (same) return
    hoveredRef.current = next
    setHovered(next)
  }
  // Read at click time, not at layer-setup time. The layers are built once on
  // `load` (and again on a style change), so a plain closure over `focusInset`
  // would freeze whatever the first render happened to pass — and this value
  // changes with the viewport.
  const focusInsetRef = useRef(focusInset)
  // The page's panels, plus the map's own controls panel while it is open.
  focusInsetRef.current = { left: !isCompact && controlsOpen ? CONTROL_PANEL_CLEARANCE : 0, ...focusInset }
  const centerOnSelectRef = useRef(centerOnSelect)
  centerOnSelectRef.current = centerOnSelect
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
            isSelf: Boolean(selfUnitId) && unit.uid === selfUnitId,
            // Only ever one feature can carry this: the viewer's own.
            hasCompass:
              Boolean(selfUnitId) && unit.uid === selfUnitId && Number.isFinite(selfHeading),
            compassBearing: Number.isFinite(selfHeading) ? selfHeading : 0,
            /**
             * Which marker mode this unit is in — '', 'standby' or
             * 'navigating' (see NAV_STATE).
             *
             * Derived on the FEATURE rather than passed to the layers as a
             * paint expression over two uid props, because the tween rewrites
             * these features sixty times a second and a filter reading a
             * property is free where a filter comparing against a closure
             * would have to be re-set on every prop change.
             */
            navState:
              routeUnitId && unit.uid === routeUnitId
                ? navigating
                  ? NAV_STATE.navigating
                  : NAV_STATE.standby
                : NAV_STATE.none,
          },
          geometry: { type: 'Point', coordinates: [unit.position.lng, unit.position.lat] },
        })),
    }),
    [units, selfUnitId, selfHeading, routeUnitId, navigating],
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
        onHoverRef,
      })
      if (hasPanicLayer) {
        setupPanicLayer(map, panicGeojsonRef.current, { panicAlertsRef, onSelectPanicAlertRef, onHoverRef })
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
   * HEADING TWEENS ON THE SAME TERMS. The dot used to slide while the arrow on
   * it snapped, which is the one combination that looks broken: a unit gliding
   * north with its nose already pointing east. Both ends of a turn are reported
   * bearings, and the interpolation takes the short way round the compass — see
   * `lerpBearing` for why that cannot be a plain lerp.
   *
   * Driven imperatively against the Mapbox source rather than through React
   * state: this runs a frame at a time, and re-rendering the dashboard sixty
   * times a second to move a dot would cost far more than it shows.
   */
  const unitTweenRef = useRef({ frame: 0, positions: new Map(), bearings: new Map(), drawn: new Map(), lastTargetAt: 0 })

  /**
   * ── THE NAVIGATION CAMERA RIDES THE MARKER'S FRAMES (2026-10-19) ─────────
   * It used to be a separate `easeTo` per fix, on Mapbox's default curve,
   * restarted whenever ANY unit's data changed — while the marker glided on
   * easeOutQuad. Two animations on two curves, each restarting on its own
   * schedule, is what read as stutter: the dot slid ahead of the centre, the
   * centre lurched to catch up. Now, while a session runs, the tween below
   * places the camera on the drawn marker every frame (`jumpTo`), so the two
   * cannot drift apart.
   *
   *   free       the operator panned or zoomed: hands off until the next fix
   *              ("a pan is a look, not a decision" — DashboardPage)
   *   holdUntil  the session's opening flight owns the camera until then
   */
  const navCameraRef = useRef({ followId: null, navigating: false, free: false, holdUntil: 0 })
  navCameraRef.current.followId = followUnitId
  navCameraRef.current.navigating = navigating

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !hasUnitLayer) return undefined
    const source = map.getSource(UNITS_SOURCE_ID)
    if (!source) return undefined

    const tween = unitTweenRef.current
    const target = new Map(
      unitsGeojson.features.map((f) => [f.properties.id, f.geometry.coordinates]),
    )
    const targetBearing = new Map(
      unitsGeojson.features
        .filter((f) => f.properties.hasHeading)
        .map((f) => [f.properties.id, f.properties.bearing]),
    )

    // A unit appearing for the first time, or returning after its fix went
    // stale, is placed rather than flown in from wherever it used to be.
    //
    // From where the marker is DRAWN, not where the last glide was heading:
    // a fix that lands mid-glide used to restart from the old target, so the
    // dot jumped forward (or back) before setting off again.
    const starts = new Map()
    target.forEach((coords, id) => starts.set(id, tween.drawn.get(id) ?? tween.positions.get(id) ?? coords))

    // Same rule for heading: a unit that had no bearing a moment ago gets the
    // new one outright. Spinning up from a default of 0 would animate a turn
    // the unit never made.
    const startBearings = new Map()
    targetBearing.forEach((deg, id) => startBearings.set(id, tween.bearings.get(id) ?? deg))

    cancelAnimationFrame(tween.frame)

    // A new fix ends a look: the camera comes back to the unit.
    const camera = navCameraRef.current
    camera.free = false

    /**
     * Places the camera on the followed unit's drawn position. Zoom, pitch and
     * bearing are eased toward the navigation camera a little each frame, so
     * a zoom the operator left behind is recovered smoothly rather than
     * snapped. The bearing is the ROUTE's (the unit's `bearing`), as before —
     * never the jittery device compass.
     */
    const followCamera = (coords) => {
      if (!camera.navigating || !camera.followId || camera.free || performance.now() < camera.holdUntil) return
      if (!coords) return
      const unit = unitsRef.current.find((u) => u.uid === camera.followId)
      const zoom = map.getZoom()
      const pitch = map.getPitch()
      const bearing = map.getBearing()
      const delta = Number.isFinite(unit?.bearing) ? ((unit.bearing - bearing + 540) % 360) - 180 : 0
      map.jumpTo({
        center: coords,
        zoom: zoom + (NAV_CAMERA.zoom - zoom) * 0.12,
        pitch: pitch + (NAV_CAMERA.pitch - pitch) * 0.12,
        bearing: bearing + delta * 0.15,
      })
    }

    const settle = () => {
      tween.positions = target
      tween.bearings = targetBearing
      tween.drawn = new Map(target)
    }

    /**
     * Reduced motion gets the fix, not the journey.
     *
     * The tween is a comfort for reading movement, not information — the
     * position it ends on is the only one that is true. Somebody who has asked
     * the OS for less animation is better served by the marker simply being
     * where the unit last reported.
     */
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      source.setData(unitsGeojson)
      settle()
      followCamera(target.get(camera.followId))
      return undefined
    }

    /**
     * STEADY MOTION WHILE NAVIGATING. Off a session each fix is a discrete
     * update and easeOutQuad over 900 ms reads well. During one, fixes arrive
     * about once a second (useLiveDeviceFix), and an ease-out per fix makes
     * the unit surge and brake on every one. So the glide is linear and lasts
     * as long as the gap since the previous fix (clamped), which joins the
     * segments into continuous movement. It still never passes the latest
     * real fix.
     */
    const startedAt = performance.now()
    const gap = tween.lastTargetAt ? startedAt - tween.lastTargetAt : UNIT_TWEEN_MS
    tween.lastTargetAt = startedAt
    const steady = camera.navigating && Boolean(camera.followId)
    const DURATION_MS = steady ? Math.min(1600, Math.max(600, gap)) : UNIT_TWEEN_MS

    /**
     * Shortest way round the compass.
     *
     * A unit turning from 350° to 10° has moved 20° clockwise, but a plain
     * lerp between those numbers sweeps 340° the other way — the arrow spins
     * almost a full turn to express a slight bend in the road. Normalising the
     * delta into ±180 picks the short arc every time.
     */
    const lerpBearing = (a, b, t) => {
      const delta = ((b - a + 540) % 360) - 180
      return (a + delta * t + 360) % 360
    }

    const paint = (t) => {
      const eased = t >= 1 ? 1 : steady ? t : 1 - (1 - t) * (1 - t) // linear | easeOutQuad
      if (eased >= 1) {
        source.setData(unitsGeojson)
        tween.drawn = new Map(target)
        followCamera(target.get(camera.followId))
        return
      }
      const features = unitsGeojson.features.map((feature) => {
        const id = feature.properties.id
        const a = starts.get(id)
        const b = target.get(id)
        const from = startBearings.get(id)
        const to = targetBearing.get(id)
        const moved = a && b
        const turned = from != null && to != null

        if (!moved && !turned) return feature
        return {
          ...feature,
          properties: turned
            ? { ...feature.properties, bearing: lerpBearing(from, to, eased) }
            : feature.properties,
          geometry: moved
            ? {
                type: 'Point',
                coordinates: [a[0] + (b[0] - a[0]) * eased, a[1] + (b[1] - a[1]) * eased],
              }
            : feature.geometry,
        }
      })
      source.setData({ type: 'FeatureCollection', features })
      const drawn = new Map()
      features.forEach((f) => drawn.set(f.properties.id, f.geometry.coordinates))
      tween.drawn = drawn
      followCamera(drawn.get(camera.followId))
    }

    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / DURATION_MS)
      paint(t)
      if (t < 1) tween.frame = requestAnimationFrame(step)
      else settle()
    }

    tween.frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(tween.frame)
  }, [unitsGeojson, ready, hasUnitLayer])

  /**
   * Put the whole route on screen, clear of the map's own furniture.
   *
   * One caller again — a new route arriving, once. It briefly had two, when
   * the navigation panel carried an Overview button, and it stays a callback
   * rather than being folded back into the effect below: the padding has four
   * terms that each track a different piece of chrome, and it reads far
   * better as a named thing than as twenty lines inlined between a
   * `setData` and a `fitBounds`.
   */
  const frameRoute = useCallback(() => {
    const map = mapRef.current
    // `routeRef`, declared with the rest of the prop mirrors above: the
    // callback must not take `route` as a dependency or Overview would be a
    // new function on every refresh of a moving unit's route.
    const collection = routeRef.current
    if (!map || !collection) return
    const bounds = collectionBounds(collection)
    if (!bounds) return

    const { clientWidth, clientHeight } = map.getContainer()
    let padding = {
      top: 72,
      right: 64,
      bottom: barClearance + 16,
      left: !isCompact && controlsOpen ? CONTROL_PANEL_CLEARANCE : 64,
    }
    if (padding.left + padding.right > clientWidth - 120 || padding.top + padding.bottom > clientHeight - 120) {
      padding = 32
    }
    map.fitBounds(bounds, { padding, maxZoom: 18, duration: 700 })
  }, [barClearance, controlsOpen, isCompact])

  /**
   * The travelled part of the route, advancing on the marker's clock.
   *
   * Each fix moves the trim from where it is now to the new fraction over
   * UNIT_TWEEN_MS with the marker tween's easeOutQuad, so the live line's
   * start and the arrow arrive together. A different route (new call, unit or
   * profile) starts from its own value rather than sweeping from the old one,
   * and reduced motion jumps — the same rules the marker follows.
   */
  const routeTrimRef = useRef({ frame: 0, value: 0, key: null })
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return undefined
    const anim = routeTrimRef.current
    const target = routeTrimOf(route)
    const key = routeKey ?? null
    cancelAnimationFrame(anim.frame)

    const jump =
      anim.key !== key ||
      target < anim.value || // a re-plot or a step back: never animate backwards
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    anim.key = key
    if (jump) {
      anim.value = target
      applyRouteTrim(map, target)
      return undefined
    }

    const from = anim.value
    const startedAt = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / UNIT_TWEEN_MS)
      const eased = 1 - (1 - t) * (1 - t) // easeOutQuad, as the marker
      anim.value = from + (target - from) * eased
      applyRouteTrim(map, anim.value)
      if (t < 1) anim.frame = requestAnimationFrame(step)
    }
    anim.frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(anim.frame)
  }, [route, routeKey, ready])

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
    frameRoute()
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

  /**
   * FOLLOW MODE: the camera rides along with one unit.
   *
   * ── IT FOLLOWS THE FIX, NOT THE TWEEN ───────────────────────────────────
   * The marker glides between fixes (see the unit tween below). The camera
   * does not read that glide — it eases to the newest REPORTED position over
   * roughly the same duration, so the two arrive together and the dot stays
   * put in the middle of the screen. Chasing the tweened coordinate instead
   * would mean a camera animating toward a target that is itself animating,
   * which reads as drift and costs a frame of work to produce it.
   *
   * ── THE OPERATOR ALWAYS WINS ────────────────────────────────────────────
   * A camera that keeps yanking back to the unit while a dispatcher is trying
   * to look at the gate is worse than no follow at all, so any real gesture
   * ends it. `originalEvent` is what separates a human drag from this effect's
   * own `easeTo`: Mapbox fires `movestart` for both, and only the human one
   * carries the DOM event that caused it.
   *
   * Breaking is reported upward rather than handled here. The parent holds
   * the state, which is what lets a "Resume" control know it has something to
   * resume — and keeps this component from owning a mode it cannot show.
   */
  // A human pan, zoom or rotate frees the camera until the next fix (see
  // `navCameraRef`). Only gestures carry `originalEvent`; the follow's own
  // `jumpTo` does not, so it never frees itself.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return undefined
    const onMoveStart = (event) => {
      if (event?.originalEvent) navCameraRef.current.free = true
    }
    map.on('movestart', onMoveStart)
    return () => map.off('movestart', onMoveStart)
  }, [ready])

  const wasNavigatingRef = useRef(navigating)
  useEffect(() => {
    const map = mapRef.current

    /**
     * ── THE TRANSITION BELONGS TO THE OTHER EFFECT, NOT THIS ONE ──────────
     * `navigating` is a dependency here because the ease has to RESTATE the
     * navigation camera on every fix (see below). The side effect is that
     * flipping the session also re-runs this — so on that one render both this
     * `easeTo` and the transition effect's `flyTo` are issued against the same
     * map, and whichever runs last wins.
     *
     * It happened to be the right one, because effects run in declaration
     * order and the transition is declared after this. That is not a property
     * worth depending on: reordering two effects would silently swap a 1200ms
     * arc centred on the officer's live GPS reading for a 900ms ease centred on
     * their marker, and nothing would fail — the camera would simply land in a
     * slightly wrong place, which is the symptom this whole pass set out to
     * remove.
     *
     * So the transition render is skipped here explicitly. One owner per
     * camera move, stated rather than inferred.
     */
    const justToggled = wasNavigatingRef.current !== navigating
    wasNavigatingRef.current = navigating

    /**
     * ── THE LATCH IS SYNCED BEFORE THIS GUARD, DELIBERATELY ───────────────
     * It was after, and that was wrong in a way that only showed on the SECOND
     * session of a shift. Ending one clears `followUnitId` as well as
     * `navigating` (see `cameraUnit` in DashboardPage), so this effect bailed
     * out here and never recorded that navigation had stopped. The latch stayed
     * true, the next Start Navigation therefore did not look like a toggle, and
     * the follow ease raced the opening flight again — the exact race the
     * paragraph above exists to prevent, reappearing one session later.
     *
     * Reading a prop into a ref is bookkeeping about renders, not about the
     * map, so it has no business sitting behind a check on whether there is a
     * map to drive.
     */
    if (!map || !ready || !followUnitId) return undefined

    const unit = (unitsRef.current ?? []).find((u) => u.uid === followUnitId)
    const lng = unit?.position?.lng
    const lat = unit?.position?.lat
    // While navigating the unit tween drives the camera frame by frame (see
    // `navCameraRef`); this ease is only for following without a session.
    if (!justToggled && !navigating && typeof lng === 'number' && typeof lat === 'number') {
      /**
       * ── THE FOLLOW EASE MUST RESTATE THE NAVIGATION CAMERA ──────────────
       * This was `easeTo({ center })` alone, which is correct for watching a
       * unit from a desk and wrong during a session: `easeTo` leaves every
       * option you omit at its current value, so the pitch and bearing set on
       * entry survive — until anything else moves the camera. A pan ends at
       * pitch 50 but at whatever bearing the gesture left, the locate button
       * eases to its own zoom, and the next fix would then quietly adopt
       * those as the session's camera. Restating them per fix means the
       * session has one camera and recovers it on the next position, which is
       * also the behaviour the "a pan is a look, not a decision" note in
       * DashboardPage promises.
       *
       * The bearing is the ROUTE's direction at the unit's position, not the
       * device compass. The compass is what the officer's body is facing and
       * it jitters by a few degrees at rest; a camera that tracked it would
       * swing the whole map while somebody sat at a junction. The route
       * bearing points down the road they are driving, changes only when the
       * road does, and is the same value that aims the navigation arrow — so
       * marker and camera cannot disagree about which way is forward. The
       * compass still drives the cone on the marker, which is where "where am
       * I facing" is the actual question.
       */
      map.easeTo({
        center: [lng, lat],
        duration: NAV_FOLLOW_MS,
        essential: true,
        ...(navigating
          ? {
              zoom: NAV_CAMERA.zoom,
              pitch: NAV_CAMERA.pitch,
              ...(Number.isFinite(unit?.bearing) ? { bearing: unit.bearing } : null),
            }
          : null),
      })
    }

    // `unitsGeojson` rather than `units`: it is the memo that actually changes
    // when a position does, so this re-runs per fix and not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUnitId, unitsGeojson, ready, navigating])

  /**
   * ENTERING AND LEAVING A NAVIGATION SESSION — the one-shot camera moves.
   *
   * Separate from the per-fix follow above because they are different events:
   * this runs twice per session, on the press and on the exit, and the follow
   * runs every time a position arrives. Folding them together would re-fly the
   * 1.2s sweep on each fix.
   *
   * ── WHERE "ACCURATELY ON THE OFFICER'S LIVE POSITION" COMES FROM ─────────
   * `navAnchor`, when the caller has something better than the map's own copy
   * of the unit. On the officer's own console that is their live GPS fix read
   * straight from the device at the moment of the press — which is a different
   * and fresher thing than the marker, because the marker's position has been
   * through a telemetry write and a snapshot read (see the note on `fix` in
   * DashboardPage). A dispatcher watching somebody else passes nothing and
   * gets the followed unit, which is the best either of them can know.
   *
   * `flyTo` rather than `easeTo` on the way in: the camera is changing zoom,
   * pitch and bearing at once and the arc is what makes that read as one move
   * into a different mode rather than three simultaneous twitches.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return undefined

    if (!navigating) {
      // ── THE ONLY WAY BACK TO NORTH-UP AND FLAT ────────────────────────────
      // Not conditional on having entered: this also runs on mount, where it
      // is a no-op against a camera already at 0/0, and that is cheaper than
      // tracking whether we are the ones who tilted it. What it must NOT do is
      // touch zoom or centre — an officer who has just exited is looking at
      // the place they exited, and resetting their scale would be the console
      // taking the map away as a parting gesture.
      if (map.getPitch() !== 0 || map.getBearing() !== 0) {
        map.easeTo({ pitch: 0, bearing: 0, duration: 600, essential: true })
      }
      return undefined
    }

    const unit = (unitsRef.current ?? []).find((u) => u.uid === followUnitId)
    const center =
      Number.isFinite(navAnchorRef.current?.lng) && Number.isFinite(navAnchorRef.current?.lat)
        ? [navAnchorRef.current.lng, navAnchorRef.current.lat]
        : Number.isFinite(unit?.position?.lng) && Number.isFinite(unit?.position?.lat)
          ? [unit.position.lng, unit.position.lat]
          : null
    // No position at all: tilt and zoom where the operator is already looking
    // rather than refusing. The route is drawn, the session is on, and the
    // first fix will centre it. The frame-driven follow waits for the flight.
    navCameraRef.current.holdUntil = performance.now() + NAV_ENTER_MS
    navCameraRef.current.free = false
    map.flyTo({
      ...(center ? { center } : null),
      zoom: NAV_CAMERA.zoom,
      pitch: NAV_CAMERA.pitch,
      ...(Number.isFinite(unit?.bearing) ? { bearing: unit.bearing } : null),
      duration: NAV_ENTER_MS,
      essential: true,
    })
    return undefined
    // Deliberately NOT keyed on the anchor or the unit: this is the transition
    // into and out of a session, and re-running it when a position arrives is
    // what the follow effect above is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, ready, followUnitId])

  /**
   * Keep the preview pinned to its marker, without re-rendering React.
   *
   * The card's position is written straight to the node's `transform` rather
   * than held in state, because `move` fires once per frame for the whole of a
   * pan or a zoom — and a position in state would mean a full React render per
   * frame, for a card whose CONTENT has not changed at all. `hovered` changes
   * once per marker; this changes sixty times a second, so the two are kept on
   * different paths deliberately.
   *
   * `mouseout` on the map clears it: a pointer that leaves the canvas quickly
   * enough across a corner can miss the layer's own `mouseleave`, and a card
   * left pinned to a marker nobody is pointing at is worse than no card.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hovered) return undefined

    const place = () => {
      const node = hoverCardRef.current
      if (!node) return
      const { x, y } = map.project(hovered.lngLat)
      // Rounded to whole pixels: a card parked on a half-pixel renders its
      // 1px border and 10px type through a filter, which looks like a
      // rendering fault rather than a sharp panel.
      node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    }
    const clear = () => onHoverRef.current?.(null)

    place()
    map.on('move', place)
    map.on('mouseout', clear)
    return () => {
      map.off('move', place)
      map.off('mouseout', clear)
    }
  }, [hovered])

  /**
   * ── THE PULSE, ON THE COMPOSITOR'S CLOCK ─────────────────────────────────
   *
   * Drives every pulse layer's radius and opacity. This was a 65ms
   * `setInterval`, chosen because "~15fps is plenty for an ambient cue and far
   * cheaper on the GPU". The frame rate was never the problem. Three other
   * things were.
   *
   *   A TIMER DOES NOT STOP. `setInterval` keeps firing in a hidden tab, so a
   *   console left open on a second monitor spent the night writing paint
   *   properties into a map nobody was looking at. `requestAnimationFrame` is
   *   parked by the browser the moment the tab is backgrounded, which is the
   *   whole reason it exists.
   *
   *   65ms DOES NOT DIVIDE INTO A FRAME. At 60Hz a 65ms timer lands 3.9 frames
   *   apart, so the ring advanced by one step on some frames and two on others.
   *   That reads as jank, and the stutter was more visible than the extra
   *   smoothness would have been.
   *
   *   A LINEAR RAMP IS NOT A WAVE. `base + t * reach` expands at a constant
   *   speed and then cuts back to the start, which reads as a second hand
   *   sweeping. Things that actually radiate decelerate as they spread. The
   *   cubic ease-out below does, and the squared opacity falloff gives the
   *   tail a soft edge instead of a straight fade.
   *
   * REDUCED MOTION PARKS THE RING, IT DOES NOT REMOVE IT. The ring is the only
   * thing on this map that says "this one is still live", so switching it off
   * would drop information rather than decoration — the line the shared
   * stylesheet's `prefers-reduced-motion` block draws everywhere else. It is
   * held at half extent and a steady opacity, so a marker still reads as
   * active with nothing moving.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let frame = 0

    /**
     * Write a paint property only when its value has actually changed.
     *
     * Earns its place now that this runs at 60fps rather than 15 — and most of
     * all under reduced motion, where every frame computes the SAME number.
     * Without the cache the version that holds still would be the expensive
     * one, re-dirtying a layer sixty times a second to set it to what it
     * already is.
     */
    const written = new Map()
    function write(layer, prop, value) {
      const key = `${layer}:${prop}`
      if (written.get(key) === value) return
      written.set(key, value)
      map.setPaintProperty(layer, prop, value)
    }

    // Cubic ease-out — quick at the leading edge, settling as it reaches full
    // extent. This is the whole difference between a ripple and a metronome.
    const spread = (t) => 1 - (1 - t) ** 3

    function pulse(layer, period, base, reach, peak, now) {
      if (!map.getLayer(layer)) return
      if (reduceMotion?.matches) {
        // Half extent: a ring clearly outside the badge, rather than a second
        // disc sitting on top of it.
        write(layer, 'circle-radius', base + reach * 0.5)
        write(layer, 'circle-opacity', peak * 0.45)
        return
      }
      const t = (now % period) / period
      write(layer, 'circle-radius', base + spread(t) * reach)
      // Squared, not linear: the ring holds through the first half of its
      // travel and then drops away, so the eye follows the leading edge rather
      // than a uniformly dimming disc.
      write(layer, 'circle-opacity', peak * (1 - t) ** 2)
    }

    /*
     * ── WHY THE RING VANISHED ON ZOOM-OUT ─────────────────────────────────
     * This loop used to bail out on `!map.isStyleLoaded()`. That reads as
     * "the style is being swapped", but Mapbox's Style.loaded() is also false
     * while ANY source still has tiles in flight. Zooming out requests a ring
     * of new tiles, so for the whole fetch the pulse stopped where it was —
     * and with the squared falloff below, about a third of every cycle sits
     * under 10% opacity. An SOS ring zoomed out mid-fade froze invisible,
     * and stayed that way until the last tile landed. It also emptied the
     * write cache every frame, so the parked ring re-wrote itself once
     * the fetch ended.
     *
     * Tiles loading is no reason to stop: setPaintProperty is legal the moment
     * the style JSON is parsed, and `pulse()` already skips a layer that does
     * not exist yet. The only real hazard is a style SWAP, which rebuilds the
     * layers at their defaults behind the cache's back — so the cache is
     * cleared on `style.load`, the one event that marks it, and a write that
     * races the swap is caught rather than allowed to kill the loop.
     */
    const resetCache = () => written.clear()
    map.on('style.load', resetCache)

    function step() {
      frame = requestAnimationFrame(step)
      try {
        tick(Date.now())
      } catch {
        // "Style is not done loading" between setStyle() and its style.load.
        written.clear()
      }
    }

    function tick(now) {

      // INCIDENT_PULSE_REACH, not a literal 18: `incident-hit` is sized from
      // the same constant, so the disc a dispatcher can click and the ring they
      // are aiming at cannot be edited apart from each other.
      pulse('incident-pulse', 1600, pinRadius, INCIDENT_PULSE_REACH, 0.55, now)
      // 900ms against the incident pulse's 1600 — faster, so the two read as
      // different urgencies even in peripheral vision, which is where this has
      // to work. Reaches 32px against the incident ring's 25: a shade wider,
      // and local to the marker. Same constants `panic-hit` is sized from.
      pulse('panic-pulse', 900, PANIC_BASE_RADIUS, PANIC_PULSE_REACH, 0.6, now)
      pulse('unit-pulse', 1100, 13, 14, 0.5, now)
      // 1800ms, the slowest ring on the map, against the responding flash's
      // 1100 and the SOS ring's 900. Standby is the one cue here that is NOT
      // urgent — it says a position is being tracked while everyone waits —
      // and the speed is what says so without needing a second colour.
      pulse('unit-standby-pulse', 1800, 13, 20, 0.3, now)

      if (map.getLayer('unit-icons')) {
        // A responding unit flashes: the marker itself dips, which reads as
        // "moving" where a steady ring would read as "here". Held full under
        // reduced motion — the unit's colour already carries its state, so
        // nothing is lost by holding still.
        const t = (now % 1100) / 1100
        const flash = reduceMotion?.matches ? 1 : 0.55 + 0.45 * Math.abs(Math.cos(Math.PI * t))
        // Cached by the scalar rather than through `write`, because the value
        // handed to Mapbox is a fresh expression array every time and would
        // never compare equal to the last one.
        if (written.get('unit-icons:flash') !== flash) {
          written.set('unit-icons:flash', flash)
          map.setPaintProperty('unit-icons', 'icon-opacity', [
            'case',
            ['get', 'stale'], 0.45,
            ['==', ['get', 'state'], 'responding'], flash,
            1,
          ])
        }
      }
    }

    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      map.off('style.load', resetCache)
    }
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
      onHoverRef,
    })
    if (hasPanicLayer) {
      setupPanicLayer(map, panicGeojsonRef.current, { panicAlertsRef, onSelectPanicAlertRef, onHoverRef })
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

  /**
   * Resolved from the live arrays by id on every render, not captured when the
   * hover started. A pin whose report is resolved, reassigned or closed while
   * the pointer rests on it updates the card in place — and an incident that
   * drops out of the list entirely takes its card with it rather than leaving
   * a stale panel describing a marker that is no longer drawn.
   */
  const hoverRecord = (() => {
    if (!hovered) return null
    if (hovered.kind === 'panic') {
      const alert = (panicAlerts ?? []).find((a) => a.id === hovered.id)
      return alert ? { kind: 'panic', alert } : null
    }
    const incident = incidents.find((i) => i.id === hovered.id)
    return incident ? { kind: 'incident', incident } : null
  })()

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
      data-has-sheet={sheet ? '' : undefined}
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
          {/* ONE control container for the filter row and the legends.
              Previously these were three separate floating overlays
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
                <SlidersHorizontal size="sm" className="shrink-0 text-brand-400" />
                <span className="flex-1 text-xs font-semibold text-text-primary">
                  Map controls
                </span>
                <ChevronDown
                  size="sm"
                  className={`text-text-secondary transition-transform duration-200 ${
                    controlsOpen ? '' : '-rotate-90'
                  }`}
                />
              </button>

              <div
                className={`custom-scrollbar min-h-0 overflow-y-auto transition-[opacity] duration-150 ${
                  controlsOpen ? 'flex-1 opacity-100' : 'hidden opacity-0'
                }`}
              >
                {/* Map style used to open this drawer. It is now a floating
                    capsule in the top-right corner of the canvas — see
                    `basemapControl` below for why it was promoted out of a
                    collapsed panel. */}
                {showStatusFilter ? (
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
                ) : null}

                <ControlSection label="Pin — response phase">
                  <div className="flex flex-col gap-2">
                    {PHASE_LEGEND.filter((item) => showStatusFilter || item.key !== 'resolved').map((item) => (
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

      {overlay || sheet ? (
        <div
          style={{
            '--overlay-left': `${!isCompact && controlsOpen ? CONTROL_PANEL_CLEARANCE : 12}px`,
            '--overlay-right': '12px',
          }}
          /* Spans the map so `mt-auto` has somewhere to push to, and stays
             `pointer-events-none` throughout — every child opts back in. A
             full-bleed transparent layer over a Mapbox canvas that swallowed
             drags would break panning on the whole console.

             `bottom-0` and `inset-x-0` below `sm`: the sheet is flush to the
             screen edges, which is what makes `rounded-t-3xl` read as a sheet
             rather than as a card that happens to be low. Above `sm` the
             12px gutter comes back and the stack returns to the top. */
          className="pointer-events-none absolute inset-x-0 bottom-0 top-3 z-10 flex flex-col gap-2 sm:inset-x-3 sm:bottom-3 lg:[left:var(--overlay-left)] lg:[right:var(--overlay-right)]"
        >
          {/* `pr-14` below `lg`: Mapbox's own zoom / locate / maximise column
              runs down the right edge at every width, and the custom
              `--overlay-right` inset only applies from `lg` up. Without the
              clearance the banner's right corner sits under the zoom buttons
              on a phone — measured at 390px, where a 342px banner and a 44px
              control column cannot both have the full width. */}
          {overlay ? (
            <div className="flex shrink-0 justify-center pl-3 pr-14 sm:pl-0 lg:pr-0">{overlay}</div>
          ) : null}
          {sheet ? (
            <div className="mt-auto flex min-h-0 justify-center sm:mt-0">{sheet}</div>
          ) : null}
        </div>
      ) : null}

      {mapFailure ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-base-900/95 p-6 text-center">
          <div className="max-w-xs">
            <MapPinOff size="lg" aria-hidden="true" className="mx-auto mb-2 text-text-muted" />
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

      {/* Above the z-10 overlays, because a transient card the pointer is
          holding open should not be clipped by a panel it happens to cross,
          and `pointer-events-none` means it can never steal the click it is
          inviting. Left off the compact variant: the dashboard mini-map is
          narrower than the card. */}
      {!isCompact && hoverRecord ? (
        <div
          ref={hoverCardRef}
          className="pointer-events-none absolute left-0 top-0 z-20 will-change-transform"
        >
          <HoverPreview record={hoverRecord} />
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
        /**
         * ── THE BASEMAP TOGGLE IS NOT A SETTING ────────────────────────────
         * It spent its life in the collapsed controls drawer on the left,
         * beside the legends and the status filter, which put it two
         * deliberate actions away. That is right for a legend and wrong for
         * this: switching to satellite is how an operator answers "is that pin
         * on the driveway or the roof", and that is part of READING the map,
         * not configuring it.
         *
         * Top-right, in the same cluster as zoom and locate — the corner that
         * already means "what I can see", which is what a basemap changes.
         * MapControls renders the button; this passes it the two styles and
         * which one is on. See `basemap` there for why the data crosses the
         * boundary and the markup does not.
         *
         * Nothing on the compact variant, along with the rest of that column:
         * the analytics thumbnail is 180px tall and is glanced at rather than
         * read, so it has no camera controls to put this beside.
         */
        basemap={
          isCompact
            ? null
            : { key: mapStyleKey, options: BASEMAP_OPTIONS, onChange: toggleStyle }
        }
      />

      <div ref={containerRef} className="h-full w-full" />

    </div>
  )
}
