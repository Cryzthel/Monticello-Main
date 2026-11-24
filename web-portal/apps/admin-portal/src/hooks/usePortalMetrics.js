import { useEffect, useMemo, useState } from 'react'
import { useIncidentFeed } from '@shared/hooks/useIncidentFeed'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'
import { isPanicLive } from '@shared/lib/panicStatus'
import {
  computeOverviewMetrics,
  incidentAsReport,
  isResolvedIncident,
  panicAlertAsReport,
} from '@shared/lib/overviewMetrics'
import { minutesWaiting } from '@shared/lib/wpda'

/** Threshold, in minutes, past which a dispatched call counts as overdue. */
export const DISPATCH_SLA_MINUTES = 20

/** How often the rolling window's end moves forward. */
const WINDOW_TICK_MS = 60_000

/**
 * Every headline number on the Admin portal's two analytics surfaces, derived
 * once from one array.
 *
 * -- WHAT "SYNCHRONISED" ACTUALLY REQUIRES ---------------------------------
 * Not a refresh mechanism. Firestore's `onSnapshot` already pushes adds, edits
 * and deletes to every subscriber without asking, and this hook was already the
 * single hook the Overview read. The numbers still disagreed, because one hook
 * is not one pipeline: this hook handed out SEVERAL arrays, and a widget that
 * counts a different array from the card above it disagrees with that card
 * forever, however live both of them are.
 *
 * Five disagreements, all of which this collapses. The first four were fixed
 * earlier and are listed because the fix is only visible as an absence:
 *
 *   1. Deleted reports. The Overview counted them; the tickets table did not.
 *      `useIncidentFeed` excludes them by default now - that is the one that
 *      made a delete look as though it had failed.
 *   2. The window. One `selectInRange` here, a local unbounded `withinLast`
 *      in MetricsPanel, so a report with a future timestamp counted in every
 *      window on one page and none on the other.
 *   3. The category vocabulary. The donut bucketed raw strings while the rest
 *      of the portal normalised them, so 'Security' and 'security' were two
 *      slices whose sum was the KPI's single number.
 *   4. Two pages, two implementations. System Metrics restated Total Incidents
 *      and Resolution Rate off its own subscription and its own arithmetic.
 *
 *   5. THE ONE THAT WAS REPORTED, and the reason this file was rewritten.
 *      `totalReports` and `resolvedReports` were incidents PLUS panic alerts.
 *      `categoryBreakdown` was incidents only. So on any estate with a single
 *      SOS alert in the period, the donut's slices summed to less than the
 *      Total reports card beside them - and the donut's own caption printed
 *      that smaller number as a fact. A third count existed too: the volume
 *      chart re-summed its midnight day buckets for "N in range", which is not
 *      the same span as the rolling window the cards used.
 *
 *      The fix is a SHAPE rather than another filter. Incidents and SOS alerts
 *      are projected into one report record (see overviewMetrics.js) and after
 *      that nothing downstream knows which collection a row came from. Every
 *      figure on the page is a filter over that one array, so no two figures
 *      can describe different populations.
 *
 * -- TWO LISTENERS, ONE DERIVATION -----------------------------------------
 * Two Firestore collections cannot be read by one `onSnapshot`, so there are
 * two subscriptions and there is no way around that. What matters is that
 * neither of them is derived from independently: both land in `records`, and
 * `records` is the only thing this hook computes from. Both go through
 * `useLiveCollection`, which unsubscribes on unmount and re-attaches through
 * `subscribeWithRetry` after an error - no listener is opened here directly.
 *
 * -- WHAT DELIBERATELY IGNORES THE TIMEFRAME -------------------------------
 * `activeSosCount` and everything in `operations` are live totals, not windowed
 * figures, and that is not an oversight - "open right now" is not a question
 * about the last 7 days. Windowing the first would hide a report that has been
 * open for three weeks, which is the single most important row on the page.
 * Each card says so in its help text.
 */
export function usePortalMetrics(rangeDays) {
  const { incidents, loading: incidentsLoading } = useIncidentFeed()
  const { alerts, liveCount: activeSosCount, loading: sosLoading } = usePanicAlerts()

  // -- ONE "LOADED" FOR BOTH FEEDS (2026-10-29) ----------------------------
  // The totals sum two subscriptions. Reporting loaded when only the incidents
  // had arrived drew a Total that jumped again a moment later when the SOS
  // snapshot landed - two numbers for one figure, in sequence.
  const loading = incidentsLoading || sosLoading

  // -- THE WINDOW MOVES ON ITS OWN -----------------------------------------
  // `selectInRange` read Date.now() only when a snapshot arrived, so on a quiet
  // estate the "last 7 days" stopped advancing: a report could age out of the
  // period and stay counted until some unrelated write re-ran the memo. The
  // window's end now ticks once a minute, and the same `now` is threaded into
  // the day buckets so the chart and the cards cannot drift apart across
  // midnight either.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), WINDOW_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  /**
   * THE one array. Everything the Overview shows is a filter over this.
   *
   * Deliberately NOT memoised on `loading`: while the SOS snapshot is still
   * opening, `alerts` is `[]` and the records are incidents only. The page
   * withholds every figure until `loading` clears (see DashboardPage), so that
   * intermediate array is never counted on screen - which is why a partial
   * total cannot be rendered and then corrected.
   */
  const records = useMemo(
    () => [
      ...incidents.map(incidentAsReport),
      // `isPanicLive` decides live-ness, not a string comparison here: the
      // panic vocabulary reads any status it does not recognise as a LIVE
      // emergency, and that asymmetry is deliberate (panicStatus.js).
      ...alerts.map((alert) => panicAlertAsReport(alert, { live: isPanicLive(alert.status) })),
    ],
    [incidents, alerts],
  )

  const metrics = useMemo(
    () => computeOverviewMetrics(records, rangeDays, now),
    [records, rangeDays, now],
  )

  /**
   * The live operational picture - the figures the status strips judge against
   * thresholds rather than report raw.
   *
   * INCIDENTS ONLY, and unlike the figures above that is stated rather than
   * assumed: these are dispatch questions (is a unit overdue, is a call
   * unassigned) and a panic alert has no assigned guard or dispatch SLA in this
   * schema. The SOS equivalent is `activeSosCount`, reported separately.
   *
   * `activeIncidents` is exported alongside the counts because the priority
   * breakdown chart plots the same set, and passing it down rather than
   * re-filtering keeps that chart and these tiles describing one population.
   *
   * One predicate for "not resolved", shared with every count above. This used
   * to hold two - `ACTIVE_STATUSES.has(i.status)` for the open count and
   * `i.status !== 'Resolved'` for this list - which meant the same thing by two
   * routes and would have come apart the moment either vocabulary changed.
   */
  const operations = useMemo(() => {
    const activeIncidents = incidents.filter((incident) => !isResolvedIncident(incident))
    return {
      activeIncidents,
      openCount: activeIncidents.length,
      overdueCount: activeIncidents.filter(
        (i) => i.status === 'Dispatched' && minutesWaiting(i.reportedAt) > DISPATCH_SLA_MINUTES,
      ).length,
      unassignedCount: activeIncidents.filter((i) => !i.assignedGuardUid).length,
    }
  }, [incidents])

  return {
    // The raw incident list, for the surfaces that need the DOCUMENTS rather
    // than the counts - the recent-activity table, the ticket modal, the
    // per-category durations on System Metrics. Report records carry only what
    // the arithmetic needs, so a table cannot be built from them.
    incidents,
    records,
    loading,
    activeSosCount,
    sosLoading,
    operations,
    ...metrics,
  }
}
