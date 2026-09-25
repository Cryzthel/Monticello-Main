import { useEffect, useRef, useState } from 'react'
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

const IDLE = { phase: 'idle', route: null, error: null, originSource: null, tone: null, unit: null }

/**
 * The route from a unit to a call, kept current as the unit moves.
 *
 * Which unit:
 *   the call's assigned officer, while DISPATCHED or RESPONDING. Once on site
 *                there is nothing left to route.
 *   the unit the dispatcher is previewing in the picker, before dispatch. This
 *                shows how far each candidate really is by road.
 *
 * Where it starts: the unit's live telemetry. A unit with no position falls
 * back to the configured guardhouse (VITE_GUARDHOUSE_LNGLAT), flagged, because
 * a unit that has not left yet is usually standing there. With neither, there
 * is nothing honest to draw.
 *
 * `tone` is 'live' once the officer has acknowledged and is moving, and
 * 'preview' before that. The map draws them emerald and blue.
 */
export function useDispatchRoute({ incident, units, previewUid, profile }) {
  const [state, setState] = useState(IDLE)
  const lastRef = useRef({ key: null, origin: null, at: 0 })
  const controllerRef = useRef(null)

  const stage = incident?.dispatchStage
  let unitUid = null
  let tone = null
  if (incident && (stage === 'dispatched' || stage === 'responding') && incident.assignedGuardUid) {
    unitUid = incident.assignedGuardUid
    tone = stage === 'responding' ? 'live' : 'preview'
  } else if (incident && stage === 'none' && previewUid) {
    unitUid = previewUid
    tone = 'preview'
  }
  const unit = unitUid ? units.find((u) => u.uid === unitUid) ?? null : null
  const hasPin = typeof incident?.lng === 'number' && typeof incident?.lat === 'number'

  let origin = null
  let originSource = null
  if (unit?.position) {
    origin = [unit.position.lng, unit.position.lat]
    originSource = 'unit'
  } else if (unitUid && GUARDHOUSE_LNGLAT) {
    origin = GUARDHOUSE_LNGLAT
    originSource = 'guardhouse'
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
      if (moved < REFETCH_MOVE_M || Date.now() - last.at < REFETCH_MIN_MS) return
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
  }, [key, originLng, originLat, destLng, destLat, profile])

  useEffect(() => () => controllerRef.current?.abort(), [])

  if (!key) return IDLE
  // Straight-line distance, so the drawer has a number even while the road
  // route is plotting or when routing failed.
  const straightM =
    origin && hasPin ? Math.round(distanceMeters(origin, [incident.lng, incident.lat])) : null
  return { ...state, tone, unit, originSource, straightM, incidentId: incident.id }
}
