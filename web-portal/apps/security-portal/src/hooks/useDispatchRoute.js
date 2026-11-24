import { useEffect, useRef, useState } from 'react'
import { auth } from '@shared/lib/firebase'
import { publishRoute, summariseRoute } from '@/lib/guardTelemetry'
import { fetchRoute, distanceMeters } from '@/lib/directions'
import { GUARDHOUSE_LNGLAT } from '@/lib/routeOrigin'

/**
 * Re-plot once the unit has moved this far from where the current route
 * starts, and no more often than every REFETCH_MIN_MS. A guard driving at
 * 20 km/h covers 25 m in about 4.5 s. So a moving unit gets a fresh route
 * every 10 s: close enough to follow on a map, and a few hundred Mapbox
 * Directions requests per response at most.
 */
const REFETCH_MOVE_M = 25
const REFETCH_MIN_MS = 10_000

/**
 * ── RECALCULATING WHEN THE UNIT IS NOT ON THE LINE ─────────────────────────
 *
 * The route already re-plots from the unit's live position every time they
 * move REFETCH_MOVE_M, so a unit that takes a wrong turn is usually handed a
 * corrected route within twenty-five metres without anything special
 * happening. The case that rule misses is narrow and real: a unit that moves
 * only a few metres but ends up far from the LINE — out of a side gate, into
 * a car park, round the back of a block — then stops. They are visibly off
 * the plotted route, they have not moved far enough to trigger a refetch, and
 * nothing re-plots until they drive again.
 *
 * So being off-route is now itself a reason to re-plot, subject to the same
 * time floor. `REROUTE_LIMIT` is what keeps that from becoming a loop: a fix
 * that is genuinely nowhere near any road — a basement car park, a bad
 * indoor fix — comes back off-route against the NEW route too, and without a
 * cap this would re-request directions every ten seconds for as long as the
 * call stayed open. Three attempts, then it stops and the panel's off-route
 * notice stands, which is the honest end state: the console has tried, and a
 * position that no route can reach is information for the officer, not a
 * reason to keep spending the quota.
 *
 * The counter resets the moment the unit is back on a line, so a response
 * with three separate wrong turns gets three separate reroutes.
 */
const REROUTE_LIMIT = 3

const IDLE = { phase: 'idle', route: null, error: null, originSource: null, tone: null, unit: null }

/**
 * The route from a unit to a call, kept current as the unit moves.
 *
 * Which unit:
 *   the call's assigned officer, while DISPATCHED or RESPONDING. Once on site
 *                there is nothing left to route.
 *
 * Where it starts: the unit's live telemetry. A unit with no position falls
 * back to the configured guardhouse (VITE_GUARDHOUSE_LNGLAT), flagged, because
 * a unit that has not left yet is usually standing there. With neither, there
 * is nothing honest to draw.
 *
 * `tone` is 'live' once the officer has acknowledged and is moving, and
 * 'preview' before that. The map draws them emerald and blue.
 */
export function useDispatchRoute({ incident, units, profile, offRoute = false, selfFix = null }) {
  const [state, setState] = useState(IDLE)
  const lastRef = useRef({ key: null, origin: null, at: 0 })
  const controllerRef = useRef(null)

  /**
   * Read through refs inside the effect, and `offRoute` is ALSO a dependency.
   *
   * Both halves are needed and they do different jobs. The dependency is what
   * wakes the effect when a unit strays without a new fix arriving; the ref is
   * what stops the value being captured stale by the closure. Using only the
   * dependency would re-run the effect on every flip of a boolean that
   * flickers around the 45 m threshold; using only the ref would mean a unit
   * that strays and stops never triggers anything, which is the exact case
   * this is for.
   */
  const offRouteRef = useRef(offRoute)
  offRouteRef.current = offRoute
  const rerouteCountRef = useRef(0)
  if (!offRoute && rerouteCountRef.current) rerouteCountRef.current = 0

  const stage = incident?.dispatchStage
  let unitUid = null
  let tone = null
  // An SOS arrives here already shaped as a call in progress — see
  // `sosRouteTarget` in DashboardPage — so it needs no branch of its own.
  // That is the point of shaping it that way: one routing path, one publish
  // path, one set of states the panel can be in.
  if (incident && (stage === 'dispatched' || stage === 'responding') && incident.assignedGuardUid) {
    unitUid = incident.assignedGuardUid
    tone = stage === 'responding' ? 'live' : 'preview'
  }
  const unit = unitUid ? units.find((u) => u.uid === unitUid) ?? null : null
  const hasPin = typeof incident?.lng === 'number' && typeof incident?.lat === 'number'

  /**
   * ── WHERE THE ROUTE STARTS, IN ORDER OF HOW DIRECTLY WE KNOW IT ─────────
   *
   *   unit        the assigned officer's published telemetry. Correct for a
   *               DISPATCHER, who has no other way to know where they are.
   *   self        THIS DEVICE's own fix, when this device is the assigned
   *               officer. Preferred over the first for exactly that case,
   *               because the telemetry path is a write and a read away from
   *               a value already sitting in this browser — see the note on
   *               `fix` in useGuardTelemetry for the five separate ways that
   *               round trip can fail to come back.
   *   guardhouse  the configured fallback, flagged on the panel.
   *
   * The self case was the whole of a reported bug: an officer with location
   * granted and a fix on screen was told "no GPS fix, or location sharing is
   * off", because the only origin the route would consider was one that had
   * to survive a Firestore round trip to get back to them.
   */
  const viewerUid = auth.currentUser?.uid ?? null
  const routingSelf = Boolean(unitUid && viewerUid && unitUid === viewerUid)
  const usableSelfFix =
    routingSelf && Number.isFinite(selfFix?.lat) && Number.isFinite(selfFix?.lng) ? selfFix : null

  let origin = null
  let originSource = null
  if (usableSelfFix) {
    origin = [usableSelfFix.lng, usableSelfFix.lat]
    originSource = 'self'
  } else if (unit?.position) {
    origin = [unit.position.lng, unit.position.lat]
    originSource = 'unit'
  } else if (unitUid && GUARDHOUSE_LNGLAT) {
    origin = GUARDHOUSE_LNGLAT
    originSource = 'guardhouse'
  }

  /**
   * WHICH of the ways to have no origin this is.
   *
   * One sentence used to cover all of them — "no GPS fix, or location sharing
   * is off" — and it was wrong more often than right. An officer whose call
   * is booked to a colleague who has gone home, or a deployment with no
   * guardhouse coordinate configured, both read a message telling them to
   * check a GPS permission that was never the problem. Each cause has a
   * different person who can fix it, so each gets its own sentence.
   */
  let noOriginReason = null
  if (!origin && unitUid) {
    if (routingSelf) noOriginReason = 'self-no-fix'
    else if (!unit) noOriginReason = 'unit-off-duty'
    else if (!unit.position) noOriginReason = 'unit-no-fix'
    if (!GUARDHOUSE_LNGLAT) noOriginReason = `${noOriginReason}:no-guardhouse`
  }

  const key = unitUid && hasPin ? `${incident.id}|${unitUid}|${profile}` : null
  const originLng = origin?.[0]
  const originLat = origin?.[1]
  const destLng = incident?.lng
  const destLat = incident?.lat

  useEffect(() => {
    if (!key) {
      controllerRef.current?.abort()
      lastRef.current = { key: null, origin: null, at: 0 }
      rerouteCountRef.current = 0
      setState(IDLE)
      return
    }
    if (typeof originLng !== 'number') {
      controllerRef.current?.abort()
      lastRef.current = { key, origin: null, at: 0 }
      setState({ ...IDLE, phase: 'no-origin', tone, unit })
      return
    }

    const nextOrigin = [originLng, originLat]
    const last = lastRef.current
    const sameCall = last.key === key && last.origin
    if (sameCall) {
      const moved = distanceMeters(last.origin, nextOrigin)
      const stale = Date.now() - last.at >= REFETCH_MIN_MS
      // The time floor binds in BOTH cases. Movement alone is not enough, and
      // neither is being off-route — what changes when a unit has strayed is
      // that the distance floor is waived, because the whole problem is a unit
      // that is badly placed without having gone far.
      const wantsReroute = offRouteRef.current && rerouteCountRef.current < REROUTE_LIMIT
      if (!stale) return
      if (!wantsReroute && moved < REFETCH_MOVE_M) return
      if (wantsReroute && moved < REFETCH_MOVE_M) rerouteCountRef.current += 1
    }

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    lastRef.current = { key, origin: nextOrigin, at: Date.now() }
    // Keep the old line on screen while a moving unit's route refreshes. Only
    // a new call or a new unit shows the plotting state.
    if (!sameCall) setState((current) => ({ ...current, phase: 'routing', route: null, error: null }))

    fetchRoute({ origin: nextOrigin, destination: [destLng, destLat], profile, signal: controller.signal })
      .then((route) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, phase: 'ready', route, error: null }))
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        console.error('Dispatch route failed', err)
        // A failed refresh keeps the last good route rather than blanking it.
        setState((current) =>
          current.route ? current : { ...current, phase: 'error', error: err?.message ?? 'Could not plot a route.' },
        )
      })
    // `unit` and `tone` are carried in state below, not triggers: a battery
    // update must not re-plot the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, originLng, originLat, destLng, destLat, profile, offRoute])

  useEffect(() => () => controllerRef.current?.abort(), [])

  // ── PUBLISHING THIS UNIT'S OWN ROUTE ──────────────────────────────────────
  //
  // Only ever OUR OWN. This hook also plots PREVIEW routes — the line a
  // dispatcher sees while choosing between units — and those belong to a
  // different officer's unit. `guard_telemetry` may only be written by the
  // officer it describes (firestore.rules), so publishing a preview would be
  // both a rule violation and a lie: nobody is driving it.
  //
  // Deduped on the summary rather than on the route object, which is a new
  // identity on every refresh. Without that, a stationary unit whose route is
  // re-plotted on a timer would rewrite several hundred coordinates to say
  // exactly what the document already said.
  const selfUid = auth.currentUser?.uid ?? null
  const ownUid = unit?.uid && selfUid && unit.uid === selfUid ? selfUid : null
  const publishedRef = useRef(null)

  useEffect(() => {
    if (!ownUid) return undefined

    const sos = incident?.kind === 'sos'
    const summary = state.route
      ? summariseRoute(state.route, {
          incidentId: sos ? null : incident?.id,
          alertId: sos ? incident?.id : null,
          tone,
        })
      : null
    const signature = summary
      ? `${summary.incidentId ?? summary.alertId}:${summary.tone}:${summary.distance}:${summary.duration}:${summary.coordinates.length}`
      : 'cleared'

    if (publishedRef.current !== signature) {
      publishedRef.current = signature
      publishRoute(ownUid, summary)
    }
    return undefined
    // `unit` is deliberately absent: a battery or heading update must not
    // republish a route that has not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownUid, state.route, incident?.id, incident?.kind, tone])

  // Leaving the console mid-call must not strand a line on the dispatcher's
  // map that nothing is updating any more.
  useEffect(
    () => () => {
      if (publishedRef.current && publishedRef.current !== 'cleared' && ownUid) {
        publishedRef.current = 'cleared'
        publishRoute(ownUid, null)
      }
    },
    [ownUid],
  )

  if (!key) return IDLE
  // Straight-line distance, so the drawer has a number even while the road
  // route is plotting or when routing failed.
  const straightM =
    origin && hasPin ? Math.round(distanceMeters(origin, [incident.lng, incident.lat])) : null
  return { ...state, tone, unit, originSource, straightM, noOriginReason, incidentId: incident.id }
}
