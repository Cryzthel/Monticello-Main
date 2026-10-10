import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVoiceGuidance } from '@/hooks/useVoiceGuidance'
import { useSearchParams } from 'react-router-dom'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import IncidentMap from '@shared/components/IncidentMap'
import AppShell from '@/layouts/AppShell'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import PanicAlertModal from '@/components/PanicAlertModal'
import DispatchDetailDrawer, { DRAWER_WIDTH_PX } from '@/components/DispatchDetailDrawer'
import RouteSummaryBadge from '@/components/RouteSummaryBadge'
import { useAuth } from '@shared/auth/AuthContext'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useEvidencePrefetch } from '@shared/hooks/useEvidencePrefetch'
import { db } from '@shared/lib/firebase'
import { describeIncidentLocation, mapIncidentDoc, isResolvedExpired } from '@shared/lib/incidents'
import { isActiveStage } from '@shared/lib/dispatchStage'
import { formatCategory } from '@shared/lib/wpda'
import { useLivePanicAlerts } from '@/components/PanicAlertProvider'
import { useGuardUnits } from '@/hooks/useGuardUnits'
import { useDispatchRoute } from '@/hooks/useDispatchRoute'
import { blockLotLabel } from '@/lib/dispatch'
import { routeProfile, routeToGeojson } from '@/lib/directions'
import { isOffRoute, routeProgress } from '@/lib/routeProgress'
import { useRouteSimulation } from '@/hooks/useRouteSimulation'
import SimulationControl from '@/components/SimulationControl'
import FollowControl from '@/components/FollowControl'
import VoiceControl from '@/components/VoiceControl'
import { loadGuardPrefs, saveGuardPrefs } from '@/lib/guardPrefs'

/**
 * How much of the map the details panel covers, handed to IncidentMap so a
 * clicked marker, and a framed route, sit in what is LEFT of the canvas
 * rather than under the panel. Only `right`: below `lg` the panel is a bottom
 * sheet over most of the screen, and the map discards an inset it cannot
 * honour (see centerOnFeature).
 */
const DETAIL_PANEL_INSET = { right: DRAWER_WIDTH_PX }

export default function DashboardPage() {
  const { user } = useAuth()
  const [selectedId, setSelectedId] = useState(null)
  const [selectedPanicId, setSelectedPanicId] = useState(null)
  const [previewUid, setPreviewUid] = useState(null)
  const [profile, setProfile] = useState(() => routeProfile(loadGuardPrefs().routeProfile).key)
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
    () => rawIncidents.map(mapIncidentDoc).filter((incident) => !isResolvedExpired(incident)),
    [rawIncidents],
  )
  useEvidencePrefetch(reports)

  const { alerts: panicAlerts } = useLivePanicAlerts()
  const selectedPanic = panicAlerts.find((a) => a.id === selectedPanicId) ?? null

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
  const routeIncident = selectedReport ?? myActive

  const target = useMemo(
    () => (typeof routeIncident?.lng === 'number' ? [routeIncident.lng, routeIncident.lat] : null),
    [routeIncident?.lng, routeIncident?.lat],
  )
  const { units } = useGuardUnits(reports, target)

  const route = useDispatchRoute({
    incident: routeIncident,
    units,
    previewUid: routeIncident?.id === selectedId ? previewUid : null,
    profile,
  })
  /**
   * The demonstration simulator (see useRouteSimulation for the rules).
   *
   * Off by default, and switched off again the moment the route it was walking
   * goes away — a call being resolved must not leave a pretend unit driving
   * around a map with nothing to drive along.
   */
  const [simulating, setSimulating] = useState(false)

  /**
   * Camera follow, off by default.
   *
   * OFF is the right default on a DISPATCH console, which is the thing that
   * makes this different from a phone. The officer in the vehicle wants the
   * camera glued to themselves; the dispatcher watching them is usually
   * looking at something else — the gate the unit is heading for, a second
   * call across the subdivision — and a camera that keeps snapping back would
   * fight them for the whole response.
   *
   * `onFollowBreak` clears THIS and nothing else: a drag, scroll or pinch means
   * the dispatcher wants the camera, not that the officer has finished. See
   * `navigating` below for the distinction that used to be missing.
   */
  const [following, setFollowing] = useState(false)

  // Off until asked, which is also what gives speechSynthesis the user gesture
  // it requires before it will utter anything.
  const [voice, setVoice] = useState(false)
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
   * Overview: a counter the map watches, bumped on every press.
   *
   * See `frameRouteSignal` in IncidentMap for why this is a nonce rather than
   * an imperative handle. The short version is that the map's entire interface
   * is props in and callbacks out, and one `ref.frameRoute()` would be the
   * only exception to that.
   */
  const [overviewSignal, setOverviewSignal] = useState(0)
  const showOverview = useCallback(() => setOverviewSignal((n) => n + 1), [])

  const routeCoordinates = route.route?.geometry?.coordinates ?? null

  useEffect(() => {
    if (!routeCoordinates) setSimulating(false)
  }, [routeCoordinates])

  const simulatedPosition = useRouteSimulation({
    coordinates: routeCoordinates,
    speedKmh: routeProfile(profile).simKmh,
    running: simulating,
  })

  /**
   * The fix every live figure is derived from.
   *
   * The simulated position stands in for the unit's own ONLY while the
   * simulator is running; it is null otherwise, so the real telemetry is not
   * merely preferred but is the only thing present. Downstream nothing knows
   * the difference, which is the point — the demonstration exercises the same
   * code path a real response does.
   */
  const fix = simulatedPosition ?? route.unit?.position ?? null

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
  const progress = useMemo(
    () => (route.route && fix ? routeProgress(route.route, fix) : null),
    [route.route, fix],
  )

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
    if (!progress || !uid) return units
    const stray = isOffRoute(progress)
    return units.map((unit) =>
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
  }, [units, progress, route.unit?.uid])

  const routeGeojson = useMemo(
    () =>
      route.route
        ? routeToGeojson(route.route, {
            tone: route.tone,
            withOrigin: route.originSource !== 'unit',
            progress,
          })
        : null,
    [route.route, route.tone, route.originSource, progress],
  )
  // A route that ends, or hands off to a different unit, leaves follow mode
  // pointing at nobody. Clearing it here rather than leaving a toggle that
  // looks armed and does nothing.
  const followUid = route.unit?.uid ?? null
  useEffect(() => {
    if (!followUid) {
      setFollowing(false)
      setNavigating(false)
    }
  }, [followUid])

  const routeKey = route.route ? `${route.incidentId}|${route.unit?.uid ?? 'guardhouse'}|${route.route.profile}` : null

  useVoiceGuidance(progress, { enabled: voice && voiceSupported, routeKey })

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
   * They are different events and now have different owners. Following is the
   * camera. Navigating is the session, and only the explicit control ends it —
   * which is also what keeps the voice prompts running while a dispatcher
   * scrolls across the map, the thing an officer driving actually relies on.
   */
  const toggleNavigation = useCallback(() => {
    setNavigating((current) => {
      const next = !current
      setFollowing(next)
      setVoice(next)
      return next
    })
  }, [])

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
   * `following` survives as the standalone toggle in the controls drawer, for
   * watching a unit WITHOUT running a navigation session.
   */
  const cameraUnit = navigating || following ? followUid : null

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

  const changeProfile = useCallback((key) => {
    const next = routeProfile(key).key
    setProfile(next)
    saveGuardPrefs({ ...loadGuardPrefs(), routeProfile: next })
  }, [])

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
      <div className="h-full min-h-[20rem]">
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
          frameRouteSignal={overviewSignal}
          onFollowBreak={() => {
            // Only the standalone watch. Navigation keeps its camera, and gets
            // it back on the next fix.
            if (!navigating) setFollowing(false)
          }}
          route={routeGeojson}
          routeKey={routeKey}
          controlsSlot={
            <div className="flex flex-col gap-3">
              <FollowControl
                following={following}
                disabled={!followUid}
                onToggle={() => setFollowing((current) => !current)}
              />
              <VoiceControl
                enabled={voice}
                supported={voiceSupported}
                disabled={!routeCoordinates}
                onToggle={() => setVoice((current) => !current)}
              />
              <SimulationControl
                running={simulating}
                disabled={!routeCoordinates}
                profileLabel={routeProfile(profile).label}
                onToggle={() => setSimulating((current) => !current)}
              />
            </div>
          }
          overlay={
            route.phase === 'idle' ? null : (
              <RouteSummaryBadge
                navigating={navigating}
                onToggleNavigation={toggleNavigation}
                route={route}
                progress={progress}
                simulated={simulating}
                profile={profile}
                targetLabel={routeTargetLabel}
                targetDetail={routeTargetDetail}
                stage={routeIncident?.dispatchStage}
                onChangeProfile={changeProfile}
                /* The SAME voice state the controls drawer toggles, not a
                   second one. Mute on the navigation bar and "Voice on" in the
                   drawer are one setting reached two ways — an officer who
                   mutes mid-drive and then opens the controls must not find a
                   switch claiming the voice is still on. */
                voice={voice}
                voiceSupported={voiceSupported}
                onToggleVoice={() => setVoice((current) => !current)}
                onOverview={showOverview}
              />
            )
          }
        />
      </div>

      <DispatchDetailDrawer
        report={selectedReport}
        units={units}
        route={route}
        previewUid={previewUid}
        onPreviewUnit={setPreviewUid}
        onClose={closeDetail}
      />
      <PanicAlertModal alert={selectedPanic} onClose={() => setSelectedPanicId(null)} />
    </AppShell>
  )
}
