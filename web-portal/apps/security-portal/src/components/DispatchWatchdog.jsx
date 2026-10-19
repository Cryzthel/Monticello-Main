import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@shared/auth/AuthContext'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { playAlert } from '@shared/lib/alertSound'
import { ACK_TIMEOUT_MS } from '@shared/lib/dispatchStage'
import { activeCallsQuery } from '@/hooks/useGuardTelemetry'

/** An escalation older than this when the console loads is history, not news. */
const ESCALATION_FRESH_MS = 10 * 60_000

const toMillis = (value) => (value?.toMillis ? value.toMillis() : null)

/**
 * The console-wide dispatch alarms, mounted once above the routes so they
 * fire on whichever page is open.
 *
 *   New assignment    the officer a call is booked to hears the critical
 *                     tone at once; the bell's feed carries "You have been
 *                     dispatched" (lib/notifications incidentNotification).
 *   Dead-man switch   a call still DISPATCHED 90 s after it was booked means
 *                     the officer has not seen it or cannot answer. Every
 *                     console sounds again, so a dispatcher can reassign;
 *                     the call's drawer shows "No acknowledgement".
 *   Escalation        an officer on scene pressed Emergency escalation.
 *
 * SOUNDS ONLY since 2026-10-19: the floating cards these used to raise were
 * removed by request, because the bell already lists the same calls live.
 *
 * ── CLIENT-SIDE, AND WHY ────────────────────────────────────────────────────
 * The watchdog belongs on a server: a scheduled function that checks every
 * minute whether anyone is looking. Scheduled functions need the Blaze plan,
 * and this project is on Spark. So it runs in every open Guardhouse console.
 * With at least one console open at the gate, which is how the guardhouse
 * runs, the alarm is heard. With none open, nothing would have seen the call
 * either.
 *
 * Also hosts the telemetry publisher, which has the same lifetime and has to
 * run whichever page is open.
 */
export default function DispatchWatchdog() {
  const { user, isAuthenticated } = useAuth()
  const uid = isAuthenticated ? user?.uid : null

  // The telemetry stream itself is mounted by GuardTelemetryProvider, which
  // wraps this component — one watch for the console, and a value the shell
  // can read to tell the officer when their location is not reaching dispatch.

  // Every open call — the same query the telemetry publisher runs, so the SDK
  // shares one listener between them.
  const watchQuery = useMemo(() => (uid ? activeCallsQuery() : null), [uid])
  const { data: watched } = useLiveCollection(watchQuery)

  const alertedRef = useRef(new Set())
  const firstSeenRef = useRef(new Map())
  const [now, setNow] = useState(() => Date.now())

  // The clock only needs to run while a dispatch is waiting on someone.
  const waiting = watched.some((incident) => incident.dispatchStage === 'dispatched')
  useEffect(() => {
    if (!waiting) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waiting])

  useEffect(() => {
    if (!uid) return
    const alerted = alertedRef.current

    watched.forEach((incident) => {
      if (incident.dispatchStage === 'dispatched') {
        // One booking per dispatch write, named by its audit entry, so a
        // reassignment (even back to the same officer) alerts again and
        // nothing else does.
        const booking = `${incident.id}:${incident.lastLogId ?? ''}`
        // A server timestamp still pending on the dispatching console reads
        // as null. It was set moments ago, so the window starts when this
        // console first saw the booking.
        if (!firstSeenRef.current.has(booking)) firstSeenRef.current.set(booking, Date.now())
        const dispatchedAt = toMillis(incident.dispatchedAt) ?? firstSeenRef.current.get(booking)

        if (incident.assignedGuardUid === uid && !alerted.has(`assigned:${booking}`)) {
          alerted.add(`assigned:${booking}`)
          playAlert('critical')
        }

        if (now - dispatchedAt >= ACK_TIMEOUT_MS && !alerted.has(`timeout:${booking}`)) {
          alerted.add(`timeout:${booking}`)
          playAlert('critical')
        }
      }

      const escalatedAt = toMillis(incident.escalation?.at)
      if (escalatedAt && !alerted.has(`escalated:${incident.id}`)) {
        alerted.add(`escalated:${incident.id}`)
        if (Date.now() - escalatedAt > ESCALATION_FRESH_MS) return
        playAlert('critical')
      }
    })
  }, [watched, uid, now])

  return null
}
