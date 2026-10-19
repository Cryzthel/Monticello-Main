import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ChevronDown, MapPinOff, SlidersHorizontal } from '@shared/icons'
import { responsePhase, RESPONSE_PHASE_COLORS, emergencyWaveColor, EMERGENCY_COLORS } from '@shared/lib/wpda'
import { categoryLabel } from '@shared/lib/incidentCategories'
import { relativeTime } from '@shared/lib/notifications'
import MapControls from '@shared/components/MapControls'
import { Skeleton } from '@shared/components/Skeleton'
import { useTheme } from '@shared/theme/ThemeProvider'
import { ROUTE_TONE_COLORS, UNIT_COLORS } from '@shared/theme/dispatchColors'
import { BOUNDARY_STYLE, boundaryMaxBounds, containsPoint } from '@shared/lib/subdivisionBoundary'

import {
  SUBDIVISION_CENTER,
  SOURCE_ID,
  PANIC_SOURCE_ID,
  INCIDENT_PULSE_REACH,
  PANIC_BASE_RADIUS,
  PANIC_PULSE_REACH,
  CONTROL_PANEL_CLEARANCE,
  DEFAULT_STYLE_KEY,
  resolveMapStyle,
  BASEMAP_OPTIONS,
  FILTER_OPTIONS,
  setupBoundaryLayers,
  setupLayers,
  setupPanicLayer,
  ROUTE_SOURCE_ID,
  EMPTY_COLLECTION,
  UNIT_TWEEN_MS,
  applyRouteTrim,
  routeTrimOf,
  setupRouteLayers,
  UNITS_SOURCE_ID,
  UNIT_IMAGE,
  NAV_STATE,
  NAV_CAMERA,
  NAV_ENTER_MS,
  NAV_FOLLOW_MS,
  setupUnitLayers,
  collectionBounds,
} from '@shared/components/incidentMap/mapLayers'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

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
                        respond to. See ConditionalPanicResolutionModal. */}
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
