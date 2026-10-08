import { useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useNow } from '@shared/hooks/useNow'
import { db } from '@shared/lib/firebase'

/**
 * Every reporting unit and the route it is driving — for a MONITORING map.
 *
 * ── HOW THIS DIFFERS FROM useGuardUnits ────────────────────────────────────
 * The guardhouse's `useGuardUnits` is a DISPATCHER'S list: it joins telemetry
 * to `guard_shifts` (so a device left signed in after clocking out is not a
 * unit), works each unit's state out from the calls booked to it, measures
 * distance to a target and ranks them for the picker. All of that exists to
 * answer "who should I send".
 *
 * The Hazard Map asks a smaller question — "who is out there, and where are
 * they going" — and answers it from the telemetry documents alone. That keeps
 * a monitoring view from needing the dispatcher's joins, and it is why this is
 * a separate hook rather than the other one moved into @shared: they are not
 * the same list with a different consumer.
 *
 * The cost of the simpler source is stated rather than hidden: `onDuty` here
 * is the flag the DEVICE last published, not the shift record. A device that
 * died mid-shift stops publishing and ages out below; one that clocked out
 * cleanly sets the flag false on its way. Neither is wrong for a map that
 * paints live positions, and both are wrong for a timesheet — which is why the
 * timesheet reads `guard_shifts` and this does not.
 *
 * ── THE ROUTE IS READ, NEVER RECOMPUTED ────────────────────────────────────
 * The responding officer's console already paid the Directions API for this
 * line and published it (see lib/guardTelemetry.js). Asking for a second one
 * here would cost another request and return a route that differs from the one
 * the officer is actually following by however much the two refreshes differ.
 * The admin draws the officer's line, not its own.
 */

/** Past this with no word, a position says where a unit WAS. */
const STALE_AFTER_MS = 180_000
const HIDE_AFTER_MS = 15 * 60_000

/** A published route older than this is not being updated by anyone. */
const ROUTE_STALE_MS = 5 * 60_000

const toMillis = (v) => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : null)

export function useGuardFleet({ enabled = true } = {}) {
  const telemetryQuery = useMemo(
    () => (enabled ? query(collection(db, 'guard_telemetry')) : null),
    [enabled],
  )
  const { data, loading } = useLiveCollection(telemetryQuery)

  // 30s is the shared default and the right granularity here: staleness is
  // measured in minutes, so a finer tick would redraw the map for nothing.
  const now = useNow()

  const units = useMemo(() => {
    return data
      .map((t) => {
        const seenMs = toMillis(t.updatedAt)
        const age = seenMs ? now - seenMs : null
        const position = t.position ?? null
        if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
          return null
        }
        // Not drawn at all past HIDE_AFTER_MS. A pin that old is a claim about
        // the present that nothing supports.
        if (age != null && age > HIDE_AFTER_MS) return null
        if (!t.onDuty) return null

        return {
          uid: t.id,
          name: t.name || 'Guard',
          badgeNumber: t.badgeNumber || '',
          position,
          // The map rotates the marker by this. Published by the device's own
          // watch, so it is the heading the officer is actually facing.
          bearing: Number.isFinite(position.heading) ? position.heading : null,
          state: t.activeIncidentId ? 'responding' : 'available',
          stale: age != null && age > STALE_AFTER_MS,
          activeIncidentId: t.activeIncidentId ?? null,
          route: t.route ?? null,
          lastSeenAgoMs: age,
        }
      })
      .filter(Boolean)
  }, [data, now])

  /**
   * Every live route as ONE FeatureCollection, which is the shape IncidentMap
   * draws: features are styled by `properties.kind`, so several units' lines
   * coexist in one collection without the map needing to know how many.
   */
  const routes = useMemo(() => {
    const features = units
      .filter((u) => {
        const r = u.route
        return (
          r &&
          Array.isArray(r.coordinates) &&
          r.coordinates.length > 1 &&
          (!r.plottedAt || now - r.plottedAt < ROUTE_STALE_MS)
        )
      })
      .map((u) => ({
        type: 'Feature',
        properties: { kind: 'route', tone: 'live', uid: u.uid, incidentId: u.route.incidentId },
        geometry: { type: 'LineString', coordinates: u.route.coordinates },
      }))

    return features.length ? { type: 'FeatureCollection', features } : null
  }, [units, now])

  return { units, routes, loading }
}

export default useGuardFleet
