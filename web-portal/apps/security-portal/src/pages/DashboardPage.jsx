import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVoiceGuidance } from '@/hooks/useVoiceGuidance'
import { useSearchParams } from 'react-router-dom'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import IncidentMap from '@shared/components/IncidentMap'
import AppShell from '@/layouts/AppShell'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import PanicAlertModal from '@/components/PanicAlertModal'
import DispatchDetailDrawer, { DRAWER_WIDTH_PX } from '@/components/DispatchDetailDrawer'
import RouteSummaryBadge from '@/components/RouteSummaryBadge'
import GuidanceBanner from '@/components/GuidanceBanner'
import GpsLockBadge from '@/components/GpsLockBadge'
import PanicAlertRail from '@/components/PanicAlertRail'
import { useAuth } from '@shared/auth/AuthContext'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useEvidencePrefetch } from '@shared/hooks/useEvidencePrefetch'
import { db } from '@shared/lib/firebase'
import { describeIncidentLocation, mapIncidentDoc, isDeleted, isResolvedExpired } from '@shared/lib/incidents'
import { isActiveStage } from '@shared/lib/dispatchStage'
import { formatCategory } from '@shared/lib/wpda'
import { useLivePanicAlerts } from '@/components/PanicAlertProvider'
import { useGuardTelemetryState } from '@/components/GuardTelemetryProvider'
import { describeDevice, getLastFix } from '@/lib/guardTelemetry'
import { useGuardUnits } from '@/hooks/useGuardUnits'
import { useDispatchRoute } from '@/hooks/useDispatchRoute'
import { blockLotLabel } from '@/lib/dispatch'
import { withLiveSelfUnit } from '@/lib/liveSelfUnit'
import { pickBestFix } from '@/lib/bestFix'
import { DEFAULT_ROUTE_PROFILE, routeToGeojson } from '@/lib/directions'
import { isOffRoute, routeProgress } from '@/lib/routeProgress'
import { useDeviceHeading } from '@/hooks/useDeviceHeading'
import { useOffRoute } from '@/hooks/useOffRoute'
import { useAutoArrival } from '@/hooks/useAutoArrival'

/**
 * How much of the map the details panel covers, handed to IncidentMap so a
 * clicked marker, and a framed route, sit in what is LEFT of the canvas
 * rather than under the panel. Only `right`: below `lg` the panel is a bottom
 * sheet over most of the screen, and the map discards an inset it cannot
 * honour (see centerOnFeature).
 */
const DETAIL_PANEL_INSET = { right: DRAWER_WIDTH_PX }

export default function DashboardPage() {
  const { user, role } = useAuth()
  const [selectedId, setSelectedId] = useState(null)
  const [selectedPanicId, setSelectedPanicId] = useState(null)
  const [previewUid, setPreviewUid] = useState(null)
  /**
   * ── THE ROUTING PROFILE IS FIXED, BECAUSE ITS CONTROL IS GONE ───────────
   *
   * This was state, restored from `guardPrefs.routeProfile` and driven by a
   * Ride / Walk segmented control in the map's controls drawer. The brief
   * deletes that control, and a PERSISTED setting with nothing left to set it
   * is worse than no setting: an officer who happened to leave it on Walk
   * would get walking routes for every call from then on, with no way to see
   * why or change it back.
   *
   * So it is a constant at the patrol default. The stored preference is
   * deliberately not read — see the note in the commit for the one case this
   * gives up, a road the driving graph refuses that walking would have found.
   */
  const profile = DEFAULT_ROUTE_PROFILE
  const [searchParams, setSearchParams] = useSearchParams()

  /**
   * A camera request, or null. `{ id, lat, lng }`, from the `?panic=` and
   * `?incident=` deep links. The id carries a timestamp so the same point
   * asked for twice flies twice (the map's effect keys on `focus.id`).
   */
  const [focus, setFocus] = useState(null)

  const activeQuery = useMemo(
    () => query(collection(db, 'incidents'), where('status', 'not-in', ['resolved', 'closed', 'false_alarm'])),
    [],
  )
  const { data: rawIncidents } = useLiveCollection(activeQuery)
  const reports = useMemo(
    // Deleted reports out, as on every admin surface (see useIncidentFeed):
    // a soft delete leaves the document matching this status query, so without
    // this a report the office deleted stayed on the dispatch map as open.
    () =>
      rawIncidents
        .map(mapIncidentDoc)
        .filter((incident) => !isDeleted(incident) && !isResolvedExpired(incident)),
    [rawIncidents],
  )
  useEvidencePrefetch(reports)

  const { alerts: panicAlerts, muted: sirenMuted, setMuted: setSirenMuted } = useLivePanicAlerts()
  const selectedPanic = panicAlerts.find((a) => a.id === selectedPanicId) ?? null

  /**
   * The SOS this console is responding to, if any.
   *
   * ── WHY AN SOS IS SHAPED LIKE A CALL ───────────────────────────────────
   * `panic_alerts` and `incidents` are two collections with two schemas, and
   * everything downstream of here — the routing hook, the route publish, the
   * marker state machine, the navigation panel, the voice guidance — takes a
   * call. Teaching each of them about a second shape would be five branches
   * for one feature, and five places for the two paths to drift.
   *
   * So the adaptation happens once, here, at the boundary: an accepted alert
   * becomes an object with the four fields the route needs, already at
   * `responding` and already assigned to the officer who pressed the button,
   * because both of those are true the moment they press it. `kind: 'sos'` is
   * the one field that survives further in, and only so the published
   * telemetry records the alert id in a field that is not `incidentId`.
   *
   * It is deliberately NOT written to Firestore as an incident. An SOS is its
   * own record with its own lifecycle and its own escalation sweep; this is a
   * routing target, held in memory on the console that is driving it.
   */
  const [respondingAlertId, setRespondingAlertId] = useState(null)
  const respondingAlert = panicAlerts.find((a) => a.id === respondingAlertId) ?? null
  const sosRouteTarget = useMemo(() => {
    if (!respondingAlert || !user?.uid) return null
    if (!Number.isFinite(respondingAlert.lat) || !Number.isFinite(respondingAlert.lng)) return null
    return {
      kind: 'sos',
      id: respondingAlert.id,
      lat: respondingAlert.lat,
      lng: respondingAlert.lng,
      dispatchStage: 'responding',
      assignedGuardUid: user.uid,
      category: 'emergency',
      severity: 'critical',
    }
  }, [respondingAlert, user?.uid])

  // An alert somebody else resolved, or that the sweep closed, stops being a
  // thing to drive to — the route and the session go with it rather than
  // leaving a line to a finished emergency on the map.
  useEffect(() => {
    if (respondingAlertId && respondingAlert && respondingAlert.status !== 'active') {
      setRespondingAlertId(null)
    }
  }, [respondingAlertId, respondingAlert])

  // The open call is read from its OWN document listener, not picked out of
  // the live list. The list only holds open calls, so a call resolved while
  // its drawer is open would vanish from under the officer's thumb at the
  // moment they most want to see the outcome. Firestore shares the underlying
  // data with the list query, so this costs one small listener.
  const [selectedDoc, setSelectedDoc] = useState(null)
  useEffect(() => {
    if (!selectedId) {
      setSelectedDoc(null)
      return undefined
    }
    return onSnapshot(
      doc(db, 'incidents', selectedId),
      (snap) => setSelectedDoc(snap.exists() ? mapIncidentDoc({ id: snap.id, ...snap.data() }) : null),
      (err) => console.error('Selected incident listener failed', err),
    )
  }, [selectedId])
  const selectedReport =
    (selectedDoc?.id === selectedId ? selectedDoc : null) ?? reports.find((r) => r.id === selectedId) ?? null

  // The signed-in officer's own active call. Its route stays on the map with
  // no drawer open, so an officer following it on a phone keeps the line.
  const myActive = useMemo(
    () => reports.find((r) => r.assignedGuardUid === user?.uid && isActiveStage(r.dispatchStage)) ?? null,
    [reports, user?.uid],
  )
  /**
   * AN SOS OUTRANKS EVERYTHING. A guard who has pressed Respond to SOS is
   * driving to it, and a routine call they happen to click afterwards must
   * not quietly re-plot the line under them mid-response. Clearing the SOS is
   * an explicit act — Exit navigation, or the alert being resolved.
   */
  /**
   * A call navigation was started on from its drawer. It holds the route
   * after the drawer closes — without it, closing the panel on anything but
   * the officer's own active call dropped the route and ended the session the
   * button had just started. Live from the list, so a call that resolves or is
   * deleted ends the session with it. While a session runs it outranks the
   * drawer, for the same reason an SOS does: a call clicked mid-drive must not
   * re-plot the line under the driver.
   */
  const [navTargetId, setNavTargetId] = useState(null)
  const navTarget = navTargetId ? reports.find((r) => r.id === navTargetId) ?? null : null
  const routeIncident = sosRouteTarget ?? navTarget ?? selectedReport ?? myActive
  const routeIncidentRef = useRef(routeIncident)
  routeIncidentRef.current = routeIncident

  const target = useMemo(
    () => (typeof routeIncident?.lng === 'number' ? [routeIncident.lng, routeIncident.lat] : null),
    [routeIncident?.lng, routeIncident?.lat],
  )
  const { units } = useGuardUnits(reports, target)

  /**
   * Off-route is read from the PREVIOUS render's progress, through a ref.
   *
   * It has to be: `progress` is computed from `route`, so passing it straight
   * back in would be a cycle React cannot evaluate. A fix that strays
   * therefore reaches the routing hook one render late, which is a few
   * milliseconds against a ten-second refetch floor — and the alternative,
   * lifting the whole progress computation above the route it measures
   * against, is not available at any price.
   */
  const offRouteRef = useRef(false)
  /**
   * This device's own position, straight from the telemetry stream rather
   * than back out of Firestore.
   *
   * Used only when the signed-in officer IS the unit being routed (see
   * `useDispatchRoute`), which is the case where the round trip buys nothing
   * and can fail in five separate ways — all of which used to reach the
   * officer as one sentence telling them to check a GPS permission that was
   * already granted.
   */
  const { fix: deviceFix, mode: telemetryMode, locationError } = useGuardTelemetryState()

  /**
   * ── ONE DECISION ABOUT WHERE THIS OFFICER IS ────────────────────────────
   *
   * A guard on shift often has the console open on a laptop AND the mobile app
   * in their pocket, both signed in as them, both publishing to the same
   * telemetry document. The laptop knows its position from visible Wi-Fi; the
   * phone knows it from a GPS chip. Preferring the local reading
   * unconditionally — which is what this did — made the laptop trust its own
   * ±600 m guess over the ±8 m fix the officer's own phone had just published.
   *
   * `pickBestFix` resolves that once, here, and the answer feeds everything:
   * the marker, the route origin, the progress figures and the camera. Doing
   * it per-consumer is how two surfaces end up drawing the same officer in two
   * places.
   */
  const publishedSelf = units.find((unit) => unit.uid === (user?.uid ?? null))?.position ?? null
  const selfFix = useMemo(
    () => pickBestFix(deviceFix, publishedSelf),
    [deviceFix, publishedSelf],
  )
  // Read once: whether this console is itself running on a phone, for the
  // accuracy badge's "open this on your phone" hint.
  const onMobile = useMemo(() => describeDevice().mobile, [])

  /**
   * This officer's own marker, driven by this device rather than by the
   * server's echo of it. See `withLiveSelfUnit` for why that round trip made
   * the dot late, and what it deliberately does not do for other units.
   */
  const selfUid = user?.uid ?? null
  const liveUnits = useMemo(
    () =>
      withLiveSelfUnit(units, {
        uid: selfUid,
        fix: selfFix,
        mode: telemetryMode,
        name: user?.displayName || user?.email,
      }),
    [units, selfUid, selfFix, telemetryMode, user?.displayName, user?.email],
  )

  const route = useDispatchRoute({
    incident: routeIncident,
    /**
     * ── `liveUnits`, NOT `units` — AND THIS IS WHY THE DOT SAT OFF THE ROAD ─
     *
     * The route hook finds its origin unit with `units.find(u => u.uid ===
     * unitUid)`, and `units` is built purely from the `guard_telemetry`
     * documents. An officer whose document has not landed — the first minutes
     * of a shift, a throttled write, a refused rule — is therefore NOT FOUND,
     * so `route.unit` is null.
     *
     * The route itself still plotted, because the hook prefers this device's
     * own fix for the origin regardless. But everything keyed on
     * `route.unit?.uid` quietly stopped applying, and the one that shows is
     * the snap: `mapUnits` only moves a marker onto the route line for the
     * unit the route belongs to, so the officer's dot was drawn at its raw
     * GPS coordinate while the line ran along the carriageway beside it.
     *
     * That is exactly the mismatch in the screenshots — mobile puts the dot
     * ON the road, the console put it in the gardens a few metres off, and
     * both were "correct" readings of the same ±14 m fix. Snapping is what
     * every navigation app does with a raw fix, and the console was skipping
     * it for the one unit that always has a live position.
     */
    units: liveUnits,
    previewUid: routeIncident?.id === selectedId ? previewUid : null,
    profile,
    offRoute: offRouteRef.current,
    selfFix,
  })

  /**
   * The unit this route starts from, or null.
   *
   * Declared HERE, directly under the route it reads, and not beside the
   * follow-mode effect that was its only consumer when it was written.
   * Three things now depend on it — the camera, the marker state machine and
   * the compass — and the compass hook runs well above that effect, so a
   * `const` further down is a temporal-dead-zone throw rather than a lint
   * warning. The whole page renders as "Cannot access 'followUid' before
   * initialization" and the build says nothing, which is the second time
   * this exact shape has bitten this file (see `routeKey` below).
   */
  const followUid = route.unit?.uid ?? null

  /**
   * ── WHAT THE CONTROL CANVAS NO LONGER CARRIES ───────────────────────────
   *
   * Three pieces of state and a hook stood here and are gone with the four
   * controls that drove them:
   *
   *   `simulating`  the demonstration simulator, which moved a pretend unit
   *                 along the plotted route. It was the only control in either
   *                 console that made the map show something that was not
   *                 happening, and it is now the only one that cannot.
   *   `following`   standalone camera follow, for watching a unit without
   *                 running a session. Folded into `navigating` below — the
   *                 camera follows during a session and is free otherwise,
   *                 which is the only arrangement either role actually used.
   *   `voice`       a dispatcher's own mute. Spoken guidance is mandatory
   *                 during a session by protocol, so the toggle could only
   *                 ever be overruled; `speaking` is now just the session.
   *
   * `useRouteSimulation`, `SimulationControl`, `FollowControl`, `VoiceControl`
   * and `RouteProfileControl` were deleted outright rather than hidden behind
   * a flag. A control nobody can reach is a control nobody can test.
   */
  const voiceSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  /**
   * The navigation SESSION, as its own state.
   *
   * Declared here beside the two things it switches, and deliberately above
   * the effect that clears it when the route ends — a `useState` read from an
   * effect further up happens to work, because effects run after render, but
   * it reads like a mistake and the next edit would make it one.
   */
  const [navigating, setNavigating] = useState(false)

  /**
   * This device's compass — live from the moment there is a route, not just
   * once a session starts.
   *
   * ── STANDBY IS WHERE IT EARNS ITS KEEP ──────────────────────────────────
   * An officer who has just been handed an alert is standing still, looking
   * at a map, working out which way to set off — and standing still is
   * precisely when the route bearing says nothing, because there is no
   * motion to derive it from. The cone is the only thing on the console that
   * can answer them.
   *
   * Still not always-on. The orientation sensor costs power, and a cone on a
   * dispatcher's desktop would point wherever that monitor happens to face —
   * so it runs when this console has a route to its name, which is the same
   * condition that puts a standby ring on the officer's own marker.
   */
  const { heading: deviceHeading, request: requestCompass } = useDeviceHeading({
    enabled: Boolean(followUid),
  })

  /**
   * The fix every live figure is derived from.
   *
   * ── THIS DEVICE'S OWN FIX COMES FIRST, AND THAT IS THE WHOLE FIX ────────
   * The order here was `route.unit?.position ?? (originSource === 'self' ?
   * selfFix : null)`, which put the Firestore echo AHEAD of the device's own
   * reading — so on the officer's own console every live figure, the marker,
   * and therefore the camera, were derived from a position that had been
   * written to a server and read back, while the route it was being measured
   * against started from the live fix. The two were allowed to disagree about
   * where the same officer was.
   *
   * That is not a small gap. `publishTelemetry` is throttled, the reader drops
   * anything older than fifteen minutes but is perfectly happy with fourteen,
   * and a stale-but-present document therefore WON over a fresh local fix
   * rather than being ignored. Pressing Start Navigation centred the camera on
   * wherever that document said the officer was.
   *
   * `originSource === 'self'` is `useDispatchRoute` stating that it already
   * made this judgement for the route's origin. Honouring the same judgement
   * here is what keeps the marker, the progress and the camera on the one
   * position the route was actually plotted from.
   *
   * A dispatcher watching somebody else is unaffected: `originSource` is
   * 'unit' for them and the published telemetry is the only thing either end
   * could know.
   */
  const fix =
    (route.originSource === 'self' ? selfFix : null) ?? route.unit?.position ?? null

  /**
   * Where the responding unit actually is along the plotted route.
   *
   * Derived from the unit's own telemetry fix, not from elapsed time — the
   * marker advances because a new position arrived, never because the clock
   * moved. `route.unit.position` is null whenever the fix is missing or too
   * old (see useGuardUnits), and `routeProgress` answers null for that, which
   * collapses every live figure below back to the route's original numbers
   * rather than to a confident guess.
   */
  /**
   * WHICH set of instructions is on screen: this call, this unit, this
   * profile. Declared HERE rather than beside the map props it is passed to,
   * because the step latch below keys on it and a `const` read before its
   * declaration is a temporal-dead-zone throw, not a lint warning.
   */
  const routeKey = route.route ? `${route.incidentId}|${route.unit?.uid ?? 'guardhouse'}|${route.route.profile}` : null

  /**
   * The furthest step this console has accepted, latched per route.
   *
   * ── WHY THE STEP INDEX IS STATE AND NOT A PURE DERIVATION ───────────────
   * It used to be a pure function of the fix, and that is what let a unit
   * standing at the gate be told to make the last turn: on a route that comes
   * back down a street near its own start, projecting a position onto the
   * line has two correct answers and distance alone picks the wrong one. The
   * gate fixes it by requiring that every corner was physically VISITED,
   * which is a fact about history, and history has to be remembered.
   *
   * A ref rather than `useState`, because nothing renders from it directly —
   * it is an input to the memo below, and `setState` here would schedule a
   * second render per telemetry fix to produce the value this render already
   * has. Written during render, which is the same thing `routeRef` and the
   * other prop mirrors in IncidentMap do.
   */
  const stepLatchRef = useRef({ key: null, index: 0, point: null })
  const progress = useMemo(() => {
    if (!route.route || !fix) return null
    // A new call, a new unit or a new profile is a new set of instructions,
    // and the latch must not carry step 7 of the old route into step 7 of a
    // route that has four — nor the previous position, which belongs to a
    // different line. `routeKey` is already exactly this identity.
    if (stepLatchRef.current.key !== routeKey) {
      stepLatchRef.current = { key: routeKey, index: 0, point: null }
    }
    const { index, point } = stepLatchRef.current
    const next = routeProgress(route.route, fix, { stepFloor: index, prevPoint: point })
    // The SNAPPED point goes back in, matching what the gate compares
    // against — see the note on `point` in gateStepIndex.
    if (next?.step) stepLatchRef.current = { key: routeKey, index: next.step.index, point: next.snapped }
    offRouteRef.current = isOffRoute(next)
    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.route, fix, routeKey])

  /**
   * The responding unit, pointed along the road and sitting on it.
   *
   * ── SNAPPED, BUT ONLY WHEN THAT IS HONEST ───────────────────────────────
   * A raw GPS fix inside a built-up subdivision sits a few metres off the
   * carriageway, so an un-snapped marker drifts through front gardens while
   * the route line runs past it. Every navigation app snaps the marker to the
   * line, and so does this — UNTIL the fix is far enough off that snapping
   * would be a lie rather than a tidy-up, at which point the real position is
   * drawn where it actually is and the card says the unit is off route.
   *
   * `bearing` is what turns the marker into a direction arrow (see
   * navigationArrowImage). It comes from the ROUTE's direction at the unit's
   * position, not from consecutive fixes: telemetry carries no heading, and
   * deriving one from two noisy points makes a marker that spins on the spot
   * whenever the unit is stationary.
   */
  const mapUnits = useMemo(() => {
    const uid = route.unit?.uid
    if (!progress || !uid) return liveUnits
    const stray = isOffRoute(progress)
    return liveUnits.map((unit) =>
      unit.uid !== uid
        ? unit
        : {
            ...unit,
            bearing: progress.bearing,
            position: stray
              ? unit.position
              : { ...unit.position, lng: progress.snapped[0], lat: progress.snapped[1] },
          },
    )
  }, [liveUnits, progress, route.unit?.uid])

  const routeGeojson = useMemo(
    () =>
      route.route
        ? routeToGeojson(route.route, {
            tone: route.tone,
            /**
             * ── THE DUPLICATE TRANSPORT ICON, AND WHERE IT CAME FROM ──────
             *
             * `route-origin` draws a tinted disc with a bike or a pair of
             * walking feet on it at the start of the line, and the layer's own
             * comment says it is "drawn only when the route does NOT start at
             * a live unit (the guardhouse fallback)". The condition did not
             * say that. `!== 'unit'` is true for 'self' as well, and 'self' IS
             * a live unit — it is the officer reading the screen, who already
             * has a marker on the units layer carrying the standby pulse ring
             * and becoming the navigation arrow.
             *
             * So the officer's own position was drawn twice, and the second
             * drawing was a pedestrian glyph sitting on top of the emblem that
             * is supposed to be the only thing representing them. The disc is
             * 11px with a 2.5px white stroke, so on a phone it did not read as
             * two markers — it read as the arrow having a walking icon stuck
             * to it.
             *
             * `=== 'guardhouse'` is the condition the comment always described:
             * the one origin that has nothing else to mark it, because no unit
             * is standing there.
             */
            withOrigin: route.originSource === 'guardhouse',
            progress,
            // The guard's live position, so the line visibly starts AT them —
            // see the origin leg in routeToGeojson.
            unitPosition: fix && Number.isFinite(fix.lng) ? [fix.lng, fix.lat] : null,
            offRoute: isOffRoute(progress),
          })
        : null,
    [route.route, route.tone, route.originSource, progress, fix],
  )
  /**
   * Off-route, but only once it has HELD for five seconds.
   *
   * `offRouteRef` above still carries the instantaneous reading, and the two
   * are used for different things on purpose: re-plotting a route is cheap,
   * reversible and invisible, so it can act on the first stray fix, while
   * TELLING an officer they have left the route is a claim about them and
   * has to be true. See useOffRoute.
   */
  const offRoute = useOffRoute(progress)

  /**
   * The arrival stamp that replaced the "I have arrived" button.
   *
   * Mounted on the dispatch page rather than inside the drawer, because the
   * drawer only exists while somebody has a call OPEN — and an officer
   * driving with the panel closed is exactly who this is for. `myActive` is
   * their own call whether or not they are looking at it.
   */
  useAutoArrival({ report: myActive, fix: selfFix, uid: user?.uid ?? null, role })

  // Spoken guidance IS the session now. The dispatcher's mute went with the
  // control that offered it (see above), so there is no second input that
  // could disagree with this.
  const speaking = navigating && voiceSupported
  useVoiceGuidance(progress, { enabled: speaking, routeKey })

  // A route that ends, or hands off to a different unit, leaves a session
  // pointing at nobody.
  useEffect(() => {
    if (!followUid) setNavigating(false)
  }, [followUid])

  // A session that ends (any way) releases the call it was started on.
  useEffect(() => {
    if (!navigating) setNavTargetId(null)
  }, [navigating])


  /**
   * NAVIGATING IS ITS OWN STATE, and the previous version got this wrong.
   *
   * It used to be derived — `following && voice` — which read neatly and was a
   * bug: panning the map fires `onFollowBreak`, that cleared `following`, and
   * navigation therefore ENDED ITSELF the first time a dispatcher looked at
   * the gate. The session appeared to time out on its own. Nothing timed out;
   * the derivation simply could not tell "the camera was taken back" apart
   * from "the officer is finished".
   *
   * It is now the only one of the three left: the camera and the spoken turns
   * are both derived FROM it, rather than being separate states kept in step
   * beside it. Only the explicit control ends a session, which is what keeps
   * the voice prompts running while a dispatcher scrolls across the map — the
   * thing an officer driving actually relies on.
   */
  /**
   * Where the opening navigation flight should centre, or null.
   *
   * ── READ FROM THE DEVICE, NOT FROM REACT STATE ──────────────────────────
   * `selfFix` is published on the telemetry SEND cadence — ten seconds by
   * default, and deliberately so: the provider sits above the router, and
   * setting state on every `watchPosition` callback would re-render the whole
   * console several times a second to move a number nothing reads that often.
   *
   * `getLastFix()` is the same device's latest raw reading, recorded by
   * `rememberFix` on every callback before that throttle applies. It is module
   * state and therefore not reactive, which is exactly why it is read HERE, in
   * an event handler, rather than during render — and why it is read once. At
   * 20 km/h ten seconds is about fifty-five metres, which at the navigation
   * camera's zoom is a fifth of the viewport: enough to open a session looking
   * at the wrong junction.
   *
   * Only for the officer's own console. A dispatcher following somebody else
   * has no device reading to prefer, so this stays null and the map centres on
   * the unit's marker (see `navAnchor` in IncidentMap).
   */
  const [navAnchor, setNavAnchor] = useState(null)

  const toggleNavigation = useCallback(() => {
    setNavigating((current) => {
      const next = !current
      if (next) {
        const live = route.originSource === 'self' ? getLastFix() : null
        setNavAnchor(
          Number.isFinite(live?.lat) && Number.isFinite(live?.lng)
            ? { lat: live.lat, lng: live.lng }
            : null,
        )
      } else {
        setNavAnchor(null)
      }
      // Safari will not deliver orientation events unless permission was
      // asked for from a user gesture, and there is no second chance — this
      // press is the gesture. Fired without awaiting: a refusal leaves the
      // cone off and changes nothing else, so the navigation session must not
      // wait on a permission dialog to start.
      if (next) requestCompass()
      return next
    })
    // Ending a session also ends an SOS response. Exit navigation is the
    // explicit act that releases the alert's hold on the route (see
    // `routeIncident`) — without this the line would stay drawn to an
    // emergency the officer has just stepped away from.
    setRespondingAlertId((id) => (navigatingRef.current ? null : id))
    // Starting a session on a call pins it, from either control (the route
    // sheet or the drawer), so closing the drawer keeps the route.
    if (!navigatingRef.current) {
      const target = routeIncidentRef.current
      if (target && target.kind !== 'sos') setNavTargetId(target.id)
    }
  }, [requestCompass, route.originSource])

  // Read inside the callback above without making `navigating` a dependency,
  // which would rebuild the handler on every toggle.
  const navigatingRef = useRef(navigating)
  navigatingRef.current = navigating

  /**
   * WHILE NAVIGATING, THE CAMERA ALWAYS FOLLOWS — there is no Re-centre button
   * because there is nothing to recover from.
   *
   * It briefly had one. A pan cleared follow mode and a control appeared to
   * put it back, which is how a phone behaves and is wrong here: the camera
   * re-centres on the next real fix anyway, seconds later, so the button was
   * offering to do a thing that was about to happen by itself.
   *
   * A pan is therefore a look, not a decision. The dispatcher gets the map for
   * as long as it takes the next GPS update to arrive, and an officer driving
   * never has to find a control to get their own position back.
   *
   * The standalone `following` toggle that used to survive here is gone with
   * its control, so the session is now the only thing that claims the camera.
   * That is a simplification rather than a loss: a dispatcher who wants to
   * watch a unit clicks its marker, and the camera they are then given is
   * theirs until they ask for something else.
   */
  const cameraUnit = navigating ? followUid : null

  /**
   * WHERE the unit is going, and WHAT it is going to — two labels, not one.
   *
   * This used to be a single string that fell back through block/lot, then the
   * stored location, then the category, so a call with no block recorded put
   * "Medical" in the slot reserved for an address and the panel lost the
   * category line entirely. They are different facts and the panel has a row
   * for each.
   *
   * `describeIncidentLocation` rather than `blockLotLabel`, because it carries
   * the PHASE as well — and inside a gated subdivision the phase is the part
   * that tells an officer which gate to come in by. It also prefers a stored
   * `propertyLabel` when the resident's property has one, which block and lot
   * alone would have thrown away.
   */
  const routeTargetLabel = routeIncident
    ? describeIncidentLocation(routeIncident) || blockLotLabel(routeIncident) || 'Location not recorded'
    : ''
  const routeTargetDetail = routeIncident ? formatCategory(routeIncident.category) : ''

  // ── ONE CLICK, ONE PANEL ─────────────────────────────────────────────────
  // A pin click opens the details drawer directly. The popup card that used
  // to stand between them, with its own Acknowledge & Respond button, is
  // gone. The drawer is where every stage is driven, so the pin's job is only
  // to say which call.
  const handleMapSelect = useCallback((incident) => {
    setSelectedId(incident.id)
    setPreviewUid(null)
  }, [])
  const closeDetail = useCallback(() => {
    setSelectedId(null)
    setPreviewUid(null)
  }, [])

  /**
   * Start navigation from the call's drawer: hold the call as the route
   * target, start the session, and close the drawer so the map — which the
   * drawer covers on a phone — is what the officer sees.
   */
  const drawerNavigation = (() => {
    if (!selectedReport) return null
    const forThisCall = routeIncident?.id === selectedReport.id && !sosRouteTarget
    if (forThisCall && navigating) return { state: 'active', onExit: toggleNavigation }
    const state = !forThisCall
      ? 'unavailable'
      : route.phase === 'ready'
        ? 'ready'
        : route.phase === 'routing'
          ? 'routing'
          : 'unavailable'
    const reason = !forThisCall
      ? sosRouteTarget
        ? 'You are responding to an SOS. Exit that navigation first.'
        : 'Another call is being navigated. Exit that navigation first.'
      : route.phase === 'no-origin'
        ? 'Waiting for a location fix to plot the route from.'
        : route.phase === 'error'
          ? route.error || 'Could not plot a route to this call.'
          : null
    return {
      state,
      reason,
      onStart: () => {
        if (!navigating) toggleNavigation()
        closeDetail()
      },
    }
  })()

  // ── DEEP LINKS ───────────────────────────────────────────────────────────
  // `?panic=<id>` flies to an SOS from the Panic Alerts page without opening
  // anything. `?incident=<id>` opens a call from a dispatch alert (see
  // DispatchWatchdog) and centres it. Each is consumed once resolved, so
  // panning away does not snap the camera back. An id that never resolves
  // (already closed) is left alone and simply finds nothing.
  const panicFocusId = searchParams.get('panic')
  const incidentFocusId = searchParams.get('incident')
  useEffect(() => {
    if (panicFocusId) {
      const alert = panicAlerts.find((a) => a.id === panicFocusId)
      if (!alert || typeof alert.lat !== 'number' || typeof alert.lng !== 'number') return
      setFocus({ id: `panic:${alert.id}:${Date.now()}`, lat: alert.lat, lng: alert.lng })
      setSearchParams({}, { replace: true })
      return
    }
    if (incidentFocusId) {
      const report = reports.find((r) => r.id === incidentFocusId)
      if (!report) return
      setSelectedId(report.id)
      setPreviewUid(null)
      if (typeof report.lat === 'number') {
        setFocus({ id: `incident:${report.id}:${Date.now()}`, lat: report.lat, lng: report.lng })
      }
      setSearchParams({}, { replace: true })
    }
  }, [panicFocusId, incidentFocusId, panicAlerts, reports, setSearchParams])

  return (
    <AppShell
      title="Live dispatch"
      subtitle="Live incidents, on-duty units, and every response in progress."
      topBarSlot={<GuardHeaderActions />}
      scroll={false}
      bleed
      inlineTitle
    >
      {/* ── FILLS THE VIEWPORT ────────────────────────────────────────────
          `h-full` at every width, paired with `bleed` on the shell so this is
          edge-to-edge below `lg`.

          `h-full` resolves here because the shell's content box is a flex item
          with a height the flex algorithm has already settled — measured, not
          assumed: 700px at 375x812 before the padding came off. What it cannot
          resolve against is a parent whose height is `auto`, which is what
          `min-h-[20rem] lg:h-full` left below `lg` and why this rendered a
          0px canvas inside a correctly-sized empty box on every phone and
          tablet.

          The floor stays for a very short landscape window, where it is better
          to overflow and scroll than to show a letterbox. */}
      {/* ── THE MAP AND THE SOS RAIL SHARE THE ROW ──────────────────────
          `lg:flex-row` with the rail `shrink-0` at a fixed width and the map
          `flex-1 min-w-0`: the map keeps every pixel the rail is not using,
          and `min-w-0` is what lets it actually shrink — without it a flex
          item refuses to go below its content's intrinsic width and the rail
          would be pushed off the edge instead.

          Below `lg` they STACK, map first — a 320px rail beside a 320px map
          would leave neither usable. The rail lands under the map and collapses
          itself to a 56px summary bar there, so the map keeps 91% of a 812px
          screen and the queue is one tap away (measured; see PanicAlertRail).

          The rail renders nothing at all when there are no alerts, so the map
          is full-bleed in the state the console is in almost all of the
          time. */}
      <div className="flex h-full min-h-[20rem] flex-col lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1">
        <IncidentMap
          variant="full"
          incidents={reports}
          selectedIncidentId={selectedId}
          onSelectIncident={handleMapSelect}
          panicAlerts={panicAlerts}
          onSelectPanicAlert={(alert) => setSelectedPanicId(alert.id)}
          units={mapUnits}
          focus={focus}
          focusInset={DETAIL_PANEL_INSET}
          panelInset={selectedReport ? DETAIL_PANEL_INSET : null}
          centerOnSelect
          selfUnitId={user?.uid ?? null}
          followUnitId={cameraUnit}
          /* The marker state machine. `followUid` is the unit the route starts
             from, which is the one that carries the standby ring and becomes
             the arrow; `navigating` says which of the two it is right now.
             Deliberately NOT `cameraUnit` — that one is cleared by a pan, and
             a dispatcher looking at the gate must not change what shape the
             officer's own marker is. */
          routeUnitId={followUid}
          navigating={navigating}
          /* This device's own compass, for the orientation cone. Null unless
             a session is running and the hardware is reporting. */
          selfHeading={deviceHeading}
          /* The live position to open the flight on — this device's own GPS
             when this device is the unit. See `navAnchor` above. */
          navAnchor={navAnchor}
          /* No `onFollowBreak`. The only follow state left is the session, and
             a pan during one is a look rather than a decision: the camera
             comes back on the next fix, which is what the officer driving
             relies on and what a dispatcher glancing at the gate wants. */
          route={routeGeojson}
          routeKey={routeKey}
          /* THE TURN BANNER, top-centre on every screen. Only while a
             session is running and there is a maneuver to show: a near-black
             plate over the map for a call nobody is driving to is a mode
             indicator asserting a mode that is off. An off-route unit gets
             no banner either, because an instruction computed from a
             position that is not on the line is a confident wrong turn. */
          overlay={
            /* A COLUMN, because the map's overlay slot is a centred ROW — two
               children handed to it straight would sit side by side and the
               chip would ride alongside the turn plate instead of above it.
               Wrapped here rather than changing the slot, which the Admin map
               also renders into. */
            <div className="flex w-full flex-col items-center gap-2">
              {/* ── THE LOCK STATE, ABOVE THE TURN PLATE ──────────────────
                  In the overlay slot rather than pinned to a corner of the
                  canvas, because that slot is the one piece of this map that
                  already solves the two problems a floating chip has: it
                  keeps clear of the control column on a phone (`pr-14`) and
                  it is the stacking context the guidance banner lives in, so
                  the two cannot overlap however either one grows.

                  Above the banner, not below: it is one line and the banner
                  is the thing being read at speed, so the plate keeps the
                  position closest to the middle of the screen. */}
              <GpsLockBadge
                mode={telemetryMode}
                locationError={locationError}
                fix={selfFix}
                // pickBestFix hands back one of its two inputs, so identity
                // says which: anything but this device's own fix came from
                // the officer's other device through the telemetry document.
                source={selfFix && selfFix !== deviceFix ? 'other-device' : 'this-device'}
                onMobile={onMobile}
              />
              {navigating && progress?.step && !offRoute ? (
                <GuidanceBanner maneuver={progress.step} waypointM={progress.waypointM ?? null} />
              ) : null}
            </div>
          }
          /* THE ROUTE PANEL: a bottom sheet on a phone, a card up here on a
             console. */
          sheet={
            route.phase === 'idle' ? null : (
              <RouteSummaryBadge
                navigating={navigating}
                onToggleNavigation={toggleNavigation}
                route={route}
                progress={progress}
                targetLabel={routeTargetLabel}
                targetDetail={routeTargetDetail}
                stage={routeIncident?.dispatchStage}
                offRoute={offRoute}
              />
            )
          }
        />
        </div>

        <PanicAlertRail
          onOpenAlert={(alert) => setSelectedPanicId(alert.id)}
          /* The officer's own position, for the distance on each card. The
             best-of-both fix, so the rail measures from the same place the
             route starts — see `pickBestFix`. */
          origin={selfFix}
          muted={sirenMuted}
          onToggleMute={() => setSirenMuted(!sirenMuted)}
        />
      </div>

      <DispatchDetailDrawer
        report={selectedReport}
        /* `liveUnits` so the picker and the assigned-unit panel measure
           distance to the call from this officer's real position rather than
           from the last one Firestore echoed back — the same reason the route
           takes it. One list, one answer about where everybody is. */
        units={liveUnits}
        previewUid={previewUid}
        onPreviewUnit={setPreviewUid}
        onClose={closeDetail}
        navigation={drawerNavigation}
      />
      <PanicAlertModal
        alert={selectedPanic}
        onClose={() => setSelectedPanicId(null)}
        /**
         * Respond to SOS: take the alert as the route target, close the
         * modal, and start the session in one go.
         *
         * STRAIGHT INTO NAVIGATING, with no standby step in between. The
         * standby ring exists so a dispatcher can look at a plotted route
         * and decide; somebody who has just pressed "Respond to SOS" has
         * decided, and making them press Start Navigation as well would be a
         * second confirmation on the most urgent action this console has.
         *
         * `setNavigating` rather than `toggleNavigation`, because toggling
         * from an unknown state could switch a running session OFF — and the
         * one case where that happens is a guard pressing Respond on a
         * SECOND alert while already driving to the first, which must start
         * the new response, not end navigation entirely.
         */
        onRespond={(alert) => {
          setRespondingAlertId(alert.id)
          setSelectedPanicId(null)
          setSelectedId(null)
          setNavigating(true)
          // The camera and the spoken turns follow `navigating` now rather
          // than being set alongside it, so there is nothing else to switch on
          // here and no way for the three to end up disagreeing.
          requestCompass()
        }}
      />
    </AppShell>
  )
}
