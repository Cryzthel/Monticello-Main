import { useEffect, useRef } from 'react'
import { ARRIVAL_RADIUS_M } from '@shared/lib/dispatchStage'
import { autoArrival } from '@/lib/dispatchWorkflow'
import { distanceMeters } from '@/lib/directions'

/**
 * Stamps the arrival on the officer's own call, once, without asking them.
 *
 * ── WHAT THIS REPLACED ─────────────────────────────────────────────────────
 * A button: "I have arrived", which moved the call into an ON-SITE stage that
 * no longer exists. It was pressed by a guard standing at a scene with their
 * phone out, which is friction at the worst possible moment, and the
 * timestamps it produced were frequently a measurement of when somebody
 * remembered rather than when they arrived.
 *
 * The console already knows where the unit is — it is drawing the marker from
 * the same fix this measures. So the event survived and the press did not.
 *
 * ── ONLY THE OFFICER'S OWN DEVICE WRITES IT ────────────────────────────────
 * Gated on the signed-in user being the assigned guard. Every console on the
 * estate can see that unit's position, so without this gate a dispatcher's
 * browser would race the officer's to stamp an arrival it merely observed —
 * and `status_log` would record the dispatcher as the actor. The officer's
 * own device is the one with standing to say it got there.
 *
 * ── AND ONLY FROM A FIX THIS DEVICE PRODUCED ───────────────────────────────
 * `fix` is the position from the local telemetry stream, not the one read
 * back out of Firestore. The round trip adds seconds to a measurement whose
 * whole point is when something happened, and it can fail in several ways
 * that have nothing to do with the officer's location (see the note on `fix`
 * in useGuardTelemetry).
 *
 * ── FIRED ONCE, DEFENDED THREE TIMES ───────────────────────────────────────
 * A geofence that straddles its own boundary fires repeatedly as a fix
 * jitters across it, so:
 *   1. `attemptedRef` stops a second attempt for the same call in this tab
 *   2. `report.onSceneAt` stops it across a reload, and across tabs
 *   3. firestore.rules refuses a write to a document that already has one,
 *      which is the only one of the three an attacker cannot skip
 */
export function useAutoArrival({ report, fix, uid, role }) {
  const attemptedRef = useRef(null)

  const incidentId = report?.id ?? null
  const stage = report?.dispatchStage
  const mine = Boolean(uid) && report?.assignedGuardUid === uid
  const stamped = Boolean(report?.onSceneAt)

  useEffect(() => {
    if (!incidentId || !mine || stamped) return
    // `on_site` and `investigating` are legacy stages that already imply an
    // arrival; only a call still in flight under the short machine qualifies.
    if (stage !== 'responding') return
    if (attemptedRef.current === incidentId) return
    if (!Number.isFinite(fix?.lat) || !Number.isFinite(fix?.lng)) return
    if (!Number.isFinite(report?.lat) || !Number.isFinite(report?.lng)) return

    const distanceM =
      Math.round(distanceMeters([fix.lng, fix.lat], [report.lng, report.lat]) * 10) / 10
    /**
     * A metre of margin under the radius.
     *
     * firestore.rules re-measures the same fix with its own geodesic formula,
     * and a haversine 29.99 m can come back as 30.01 m there — refusing a
     * write this hook had already decided to make. The old manual check
     * carried the same margin for the same reason; it is not a different
     * number because it is not a different problem.
     */
    if (distanceM > ARRIVAL_RADIUS_M - 1) return

    attemptedRef.current = incidentId
    autoArrival(
      report,
      { verdict: 'within', fix, distanceM, accuracyM: fix.accuracy ?? null },
      { role },
    )
      .then((done) => {
        // `notify` is the resident's "a guard is here now" push, and it is
        // the whole reason the arrival event was kept when its stage went.
        if (done?.notify) done.notify()
      })
      .catch((err) => {
        // Never surfaced. Nobody pressed anything, so there is no action to
        // report a failure for — and the officer standing at the scene can
        // do nothing about a refused write. The arrival is simply not
        // recorded, which is the same honest gap as a fix that never came.
        // Clearing the latch lets the next fix try again.
        console.warn('Automatic arrival stamp failed', err)
        attemptedRef.current = null
      })
  }, [incidentId, stage, mine, stamped, fix, report, role])
}
