import { useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { mapPanicAlertDoc } from '@shared/lib/panicAlerts'
import { isPanicLive } from '@shared/lib/panicStatus'

/**
 * Every panic alert ever raised, live, newest first.
 *
 * ── WHY THIS IS NOT THE DISPATCH MAP'S QUERY ──────────────────────────────
 * The map subscribes with `where('status', 'in', ['active', 'acknowledged'])`,
 * which is right for a map: a resolved emergency is not a place a guard needs
 * to go. This is the RECORD, so it is deliberately unfiltered — an emergency
 * log that drops entries once they are handled cannot answer the question a log
 * exists for, which is what happened and when.
 *
 * Sorted here rather than with `orderBy` so an alert whose `createdAt` server
 * timestamp has not resolved yet still appears. A Firestore `orderBy` omits
 * documents missing the field entirely, which for the seconds between a
 * resident pressing SOS and the server stamping it would hide the newest and
 * most urgent row on the page.
 */
export function usePanicAlerts() {
  const alertsQuery = useMemo(() => query(collection(db, 'panic_alerts')), [])
  const { data, loading, error } = useLiveCollection(alertsQuery)

  const alerts = useMemo(
    () =>
      data
        .map(mapPanicAlertDoc)
        .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0)),
    [data],
  )

  const liveCount = useMemo(
    () => alerts.filter((alert) => isPanicLive(alert.status)).length,
    [alerts],
  )

  return { alerts, liveCount, loading, error }
}
