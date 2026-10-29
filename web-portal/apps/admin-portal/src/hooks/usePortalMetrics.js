import { useEffect, useMemo, useState } from 'react'
import { useIncidentFeed } from '@shared/hooks/useIncidentFeed'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'
import { isPanicLive } from '@shared/lib/panicStatus'
import {
  computeCategoryBreakdown,
  selectInRange,
} from '@shared/lib/incidents'
import { minutesWaiting } from '@shared/lib/wpda'
import { ACTIVE_STATUSES } from '@shared/theme/statusStyles'

/** Threshold, in minutes, past which a dispatched call counts as overdue. */
export const DISPATCH_SLA_MINUTES = 20

/**
 * A period-over-period change, as the KPI chip needs it.
 *
 * `direction` is what the figure DID and `tone` is whether that is good news.
 * They come apart on any lower-is-better figure (the retired average response
 * time was one), and keeping them as separate fields is what lets such a card
 * render a green arrow pointing down. See KpiCard.
 */
function formatDelta(current, previous, { lowerIsBetter = false } = {}) {
  if (!previous) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  const rose = pct >= 0
  return {
    text: `${rose ? '+' : ''}${pct}%`,
    direction: rose ? 'up' : 'down',
    tone: (lowerIsBetter ? !rose : rose) ? 'positive' : 'negative',
  }
}

/** How often the rolling window's end moves forward. */
const WINDOW_TICK_MS = 60_000

/**
 * Every headline number on the Admin portal's two analytics surfaces, derived
 * once from one set of live subscriptions.
 *
 * -- WHAT "SYNCHRONISED" ACTUALLY REQUIRES ---------------------------------
 * Not a refresh mechanism — Firestore's `onSnapshot` already pushes adds,
 * edits and deletes to every subscriber without asking. What was missing is
 * narrower and more stubborn: the metrics did not agree on WHICH INCIDENTS
 * THEY WERE COUNTING, and the two pages that show the same figures each
 * derived them independently.
 *
 * Four disagreements, all of which this collapses:
 *
 *   1. Deleted reports. The Overview counted them; the tickets table did not.
 *      See `useIncidentFeed` — that is the one that made a delete look like it
 *      had failed.
 *   2. The window. `selectInRange` for the Overview's KPIs, but MetricsPanel
 *      used a local `withinLast` that is unbounded at the top, so a report with
 *      a future timestamp counted in every window on one page and none on the
 *      other.
 *   3. The category vocabulary. The donut bucketed raw strings while the rest
 *      of the portal normalised them, so 'Security' and 'security' were two
 *      slices whose sum was the KPI's single number.
 *   4. TWO PAGES, TWO IMPLEMENTATIONS. System Metrics restated Total Incidents
 *      and Resolution Rate off its own subscription and its own arithmetic.
 *      Both pages read this hook now, so a figure shown twice is computed once.
 *
 * -- WHAT DELIBERATELY IGNORES THE TIMEFRAME -------------------------------
 * `activeCount`, `activeSosCount` and everything in
 * `operations` are live totals, not windowed figures, and that is not an
 * oversight — "open right now" is not a question about the last 7 days.
 * Windowing the first would hide a report that has been open for three weeks,
 * which is the single most important row on the page. Each card says so in its
 * help text.
 */
export function usePortalMetrics(rangeDays) {
  const { incidents, loading: incidentsLoading } = useIncidentFeed()
  const { alerts, liveCount: activeSosCount, loading: sosLoading } = usePanicAlerts()

  // ── ONE "LOADED" FOR BOTH FEEDS (2026-10-29) ─────────────────────────────
  // The totals now sum two subscriptions. Reporting loaded when only the
  // incidents had arrived drew a Total that jumped again a moment later when
  // the SOS snapshot landed — two numbers for one figure, in sequence.
  const loading = incidentsLoading || sosLoading

  // ── THE WINDOW MOVES ON ITS OWN ──────────────────────────────────────────
  // `selectInRange` read Date.now() only when a snapshot arrived, so on a
  // quiet estate the "last 7 days" stopped advancing: a report could age out
  // of the period and stay counted until some unrelated write re-ran the
  // memo. The window's end now ticks once a minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), WINDOW_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const inRange = useMemo(() => selectInRange(incidents, rangeDays, 0, now), [incidents, rangeDays, now])

  // ── SOS ALERTS COUNT AS REPORTS (2026-10-29, by request) ─────────────────
  // An emergency raised from the app is a report like any other, so it now
  // feeds Total reports and, once resolved, Resolved reports — in the same
  // snapshot that moves it off the live SOS list. Windowed by when it was
  // raised, exactly as an incident is by when it was filed. Kept out of
  // `inRange` itself: the volume chart and category donut are about incident
  // categories, and an SOS has none.
  const sosAsReports = useMemo(
    () => alerts.map((alert) => ({ reportedAt: alert.createdAt, resolved: !isPanicLive(alert.status) })),
    [alerts],
  )

  const metrics = useMemo(() => {
    const previous = selectInRange(incidents, rangeDays, rangeDays, now)
    const sosNow = selectInRange(sosAsReports, rangeDays, 0, now)
    const sosBefore = selectInRange(sosAsReports, rangeDays, rangeDays, now)

    const currentTotal = inRange.length + sosNow.length
    const previousTotal = previous.length + sosBefore.length
    const currentResolved =
      inRange.filter((i) => i.status === 'Resolved').length + sosNow.filter((a) => a.resolved).length
    const previousResolved =
      previous.filter((i) => i.status === 'Resolved').length + sosBefore.filter((a) => a.resolved).length
    const currentRate = currentTotal ? Math.round((currentResolved / currentTotal) * 100) : 0
    const previousRate = previousTotal ? Math.round((previousResolved / previousTotal) * 100) : 0

    // ── TOTAL AND RESOLVED REPORTS (2026-10-29) ─────────────────────────
    // "Avg response time" left the Overview for these two, by request: the
    // two counts a reader can check against the tickets and SOS lists. Both
    // are windowed and both are counted from the same two sets, so Resolved
    // can never exceed Total and the resolution rate beside them is exactly
    // their ratio.
    return {
      totalReports: currentTotal,
      totalDelta: formatDelta(currentTotal, previousTotal),
      resolvedReports: currentResolved,
      resolvedDelta: formatDelta(currentResolved, previousResolved),
      resolutionRate: currentTotal ? `${currentRate}%` : 'No data yet',
      resolutionDelta: formatDelta(currentRate, previousRate),
      activeCount: incidents.filter((i) => ACTIVE_STATUSES.has(i.status)).length,
      // Windowed, like the KPI cards directly above it. The chart and the
      // "Total reports" number are guaranteed to describe the same set.
      categoryBreakdown: computeCategoryBreakdown(inRange),
    }
  }, [incidents, inRange, sosAsReports, rangeDays, now])

  /**
   * The live operational picture — the figures the status strips judge against
   * thresholds rather than report raw.
   *
   * `activeIncidents` is exported alongside the counts because the priority
   * breakdown chart plots the same set, and passing it down rather than
   * re-filtering keeps that chart and these tiles describing one population.
   */
  const operations = useMemo(() => {
    const activeIncidents = incidents.filter((i) => i.status !== 'Resolved')
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
    incidents,
    inRange,
    loading,
    activeSosCount,
    sosLoading,
    operations,
    ...metrics,
  }
}
