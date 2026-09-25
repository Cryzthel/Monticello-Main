import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@shared/auth/AuthContext'
import { useToast } from '@shared/components/ToastProvider'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { describeIncidentLocation } from '@shared/lib/incidents'
import { formatCategory } from '@shared/lib/wpda'
import { playAlert } from '@shared/lib/alertSound'
import { ACK_TIMEOUT_MS } from '@shared/lib/dispatchStage'
import { ROUTES } from '@/config/portal'
import { incidentReference } from '@/lib/dispatch'
import { activeCallsQuery } from '@/hooks/useGuardTelemetry'

/** An escalation older than this when the console loads is history, not news. */
const ESCALATION_FRESH_MS = 10 * 60_000

const toMillis = (value) => (value?.toMillis ? value.toMillis() : null)

/**
 * The console-wide dispatch alarms, mounted once above the routes so they
 * fire on whichever page is open.
 *
 *   New assignment    the officer a call is booked to is told at once, with
 *                     the critical tone. This is how a guard learns they
 *                     have been dispatched.
 *   Dead-man switch   a call still DISPATCHED 90 s after it was booked means
 *                     the officer has not seen it or cannot answer. Every
 *                     console is told, so a dispatcher can reassign.
 *   Escalation        an officer on scene pressed Emergency escalation.
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
  const { notify } = useToast()
  const navigate = useNavigate()

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
    const open = (id) => () => navigate(`${ROUTES.dashboard}?incident=${id}`)

    watched.forEach((incident) => {
      const place = describeIncidentLocation(incident) || 'Location not recorded'
      const category = formatCategory(incident.category)
      const reference = incidentReference(incident.id)

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
          notify({
            tone: 'warning',
            priority: 'critical',
            title: `You have been dispatched · ${reference}`,
            detail: `${category}. Open it and press Acknowledge & respond.`,
            propertyLabel: place,
            at: new Date(dispatchedAt),
            dedupeKey: `assigned:${incident.id}`,
            onView: open(incident.id),
          })
          playAlert('critical')
        }

        if (now - dispatchedAt >= ACK_TIMEOUT_MS && !alerted.has(`timeout:${booking}`)) {
          alerted.add(`timeout:${booking}`)
          const mine = incident.assignedGuardUid === uid
          notify({
            tone: 'error',
            priority: 'critical',
            title: mine
              ? `Acknowledge now · ${reference}`
              : `No acknowledgement from ${incident.assignedGuardName || 'the unit'}`,
            detail: mine
              ? 'The dispatcher has been alerted that you have not responded.'
              : `${category} · ${reference}. Dispatched over 90 s ago. Reassign the call.`,
            propertyLabel: place,
            at: new Date(dispatchedAt + ACK_TIMEOUT_MS),
            dedupeKey: `timeout:${incident.id}`,
            onView: open(incident.id),
          })
          playAlert('critical')
        }
      }

      const escalatedAt = toMillis(incident.escalation?.at)
      if (escalatedAt && !alerted.has(`escalated:${incident.id}`)) {
        alerted.add(`escalated:${incident.id}`)
        if (Date.now() - escalatedAt > ESCALATION_FRESH_MS) return
        notify({
          tone: 'error',
          priority: 'critical',
          title: `Escalated by ${incident.escalation.byName || 'the officer on scene'}`,
          detail: `${incident.escalation.reason} · ${reference}`,
          propertyLabel: place,
          at: new Date(escalatedAt),
          dedupeKey: `escalated:${incident.id}`,
          onView: open(incident.id),
        })
        playAlert('critical')
      }
    })
  }, [watched, uid, now, notify, navigate])

  return null
}
