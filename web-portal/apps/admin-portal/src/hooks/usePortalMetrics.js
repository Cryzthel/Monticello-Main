import { useMemo } from 'react'
import { useIncidentFeed } from '@shared/hooks/useIncidentFeed'
import { useResidents } from '@shared/hooks/useResidents'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'
import { useSystemHealth } from '@shared/hooks/useSystemHealth'
import {
  computeCategoryBreakdown,
  computeDataIntegrityRate,
  formatMinutes,
  meanMinutesToRespond,
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
 * They come apart on exactly one card — average response time, where a fall is
 * the best outcome — and keeping them as separate fields is what lets that card
 * render a green arrow pointing down instead of having to pick between a
 * correct arrow and a correct colour. See KpiCard.
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
 * `activeCount`, `activeSosCount`, the resident counts and everything in
 * `operations` are live totals, not windowed figures, and that is not an
 * oversight — "open right now" is not a question about the last 7 days.
 * Windowing the first would hide a report that has been open for three weeks,
 * which is the single most important row on the page. Each card says so in its
 * help text.
 */
export function usePortalMetrics(rangeDays) {
  const { incidents, loading } = useIncidentFeed()
  const { counts: residentCounts, loading: residentsLoading } = useResidents()
  const { liveCount: activeSosCount, loading: sosLoading } = usePanicAlerts()

  // Measured, not asserted — see the hook. Read here rather than in the panel
  // so the Overview's summary strip and the Metrics page's fuller one are
  // reporting the same probe rather than opening two.
  const health = useSystemHealth()

  const inRange = useMemo(() => selectInRange(incidents, rangeDays), [incidents, rangeDays])

  const metrics = useMemo(() => {
    const previous = selectInRange(incidents, rangeDays, rangeDays)

    const currentResolved = inRange.filter((i) => i.status === 'Resolved').length
    const previousResolved = previous.filter((i) => i.status === 'Resolved').length
    const currentRate = inRange.length ? Math.round((currentResolved / inRange.length) * 100) : 0
    const previousRate = previous.length ? Math.round((previousResolved / previous.length) * 100) : 0

    const currentResponse = meanMinutesToRespond(inRange)
    const previousResponse = meanMinutesToRespond(previous)

    return {
      totalIncidents: inRange.length,
      totalDelta: formatDelta(inRange.length, previous.length),
      resolutionRate: inRange.length ? `${currentRate}%` : 'No data yet',
      resolutionDelta: formatDelta(currentRate, previousRate),
      avgResponseTime: currentResponse == null ? 'No data yet' : formatMinutes(currentResponse),
      avgResponseDelta:
        currentResponse == null || previousResponse == null
          ? null
          : formatDelta(currentResponse, previousResponse, { lowerIsBetter: true }),
      activeCount: incidents.filter((i) => ACTIVE_STATUSES.has(i.status)).length,
      // Windowed like everything else in this block. It used to be computed
      // all-time on the Metrics page while sitting in a row of cards captioned
      // "Selected range" — one card quietly answering a different question
      // from its four neighbours.
      evidenceRate: computeDataIntegrityRate(inRange),
      // Windowed, like the KPI cards directly above it. The chart and the
      // "Total Incidents" number are guaranteed to describe the same set.
      categoryBreakdown: computeCategoryBreakdown(inRange),
    }
  }, [incidents, inRange, rangeDays])

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
    residentCounts,
    residentsLoading,
    activeSosCount,
    sosLoading,
    health,
    operations,
    ...metrics,
  }
}
