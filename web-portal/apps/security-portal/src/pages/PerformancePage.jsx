import { useMemo } from 'react'
import AppShell from '@/layouts/AppShell'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import PriorityBreakdownChart from '@shared/components/PriorityBreakdownChart'
import KpiCard from '@shared/components/KpiCard'
import { SkeletonKpiRow } from '@shared/components/Skeleton'
import { useIncidentFeed } from '@shared/hooks/useIncidentFeed'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'
import { useMetricsClock } from '@/hooks/useMetricsClock'
import { OVERDUE_SLA_MINUTES, computeResponseMetrics } from '@/lib/responseMetrics'

/**
 * Response Metrics.
 *
 * ── HOW THIS STAYS IN STEP WITH THE DISPATCH MAP ──────────────────────────
 * Two mechanisms, and both are needed — either one alone leaves a stale number
 * on the screen:
 *
 *   the listener  `useLiveCollection` is `onSnapshot`, not a fetch. When a
 *                 guard moves a call through a dispatch stage in the drawer,
 *                 lib/dispatchWorkflow.js writes that document and this
 *                 page receives it — including the `dispatchedAt` /
 *                 `onSceneAt` / `resolvedAt` stamps the same write applies. No
 *                 refresh, no polling, no second aggregate to keep in sync,
 *                 because every figure below is derived from those documents
 *                 rather than stored anywhere.
 *
 *   the clock     `useMetricsClock` ticks every 15s. The Overdue count
 *                 measures against the present, and a snapshot listener does
 *                 not fire when the only thing that changed is the time. See
 *                 the hook for why a quiet shift is the case that needs it.
 *
 * `computeResponseMetrics` takes the array and the instant and returns the
 * whole row, so every card reads the same clock and there is one file to look
 * in for what any of these numbers means.
 */
export default function PerformancePage() {
  // The SAME feed the admin Overview and Metrics read, so the two consoles
  // count one population. This page used to run its own query — newest 500 by
  // `reportedAt`, deleted reports included — so a report an administrator
  // deleted kept counting as Active here while it vanished from the admin's
  // figures, and a call open longer than the newest 500 dropped out of the
  // guard's counts while the admin still had it. useIncidentFeed is live
  // (onSnapshot), uncapped and excludes soft-deleted reports by default.
  const { incidents: reports, loading } = useIncidentFeed()

  const now = useMetricsClock()
  const metrics = useMemo(() => computeResponseMetrics(reports, now), [reports, now])

  // The SOS feed the dispatch map and the alert sound already listen to. Its
  // own listener, because these are panic_alerts, not incidents.
  const { liveCount: liveSos, loading: sosLoading } = usePanicAlerts()

  return (
    <AppShell
      dutyLock={false}
      title="Response metrics"
      subtitle="What is open, waiting for a unit or running late — live."
      topBarSlot={<GuardHeaderActions />}
    >
      <div className="flex flex-col gap-6">
        {/* ── WHAT NEEDS ACTING ON, AND NOTHING ELSE ──────────────────────
            Four cards, each a thing a guard can do something about right now:
            calls open, SOS alerts unanswered, reports waiting for a unit, and
            dispatches running late. The average time to assign rides under
            "Awaiting dispatch" because it is that queue's speed.

            Removed 2026-10-17: the Duty Status panel (clock-in lives on the
            duty-lock overlay of every console page, clock-out in the header),
            and On-Site ETA, Resolution Rate and Avg Resolution Time — outcome
            measures that belong to the administrator's Metrics page.

            Four cards, so the shared `kpi-grid` (one, two, then four up) fits
            exactly, and the skeleton uses the same grid. */}
        {loading || sosLoading ? (
          <SkeletonKpiRow count={4} />
        ) : (
          <div className="kpi-grid">
            <KpiCard
              label="Active calls"
              value={metrics.activeCount}
              helpText="Every report not yet resolved"
            />
            <KpiCard
              label="Active SOS"
              value={liveSos}
              tone="danger"
              helpText="Emergency alerts not yet resolved"
            />
            <KpiCard
              label="Awaiting dispatch"
              value={metrics.awaitingDispatchCount}
              helpText={
                metrics.avgDispatchTime !== 'No data yet'
                  ? `Avg time to assign: ${metrics.avgDispatchTime}`
                  : 'Reports with no unit assigned yet'
              }
            />
            <KpiCard
              label="Overdue"
              value={metrics.overdueCount}
              tone="danger"
              helpText={`Dispatched more than ${OVERDUE_SLA_MINUTES} min ago`}
            />
          </div>
        )}

        <p className="-mt-3 text-xs text-text-muted">
          Figures update live as statuses change on the dispatch map.
        </p>

        {/* Active Incidents by Priority — full width now that the mini map
            is gone; the full dispatch map lives on /dashboard. */}
        <PriorityBreakdownChart incidents={metrics.activeReports} loading={loading} />

        {/* Response time BY CATEGORY (report → resolution) was the last
            panel here and was removed with Avg Resolution Time on 2026-10-17:
            it is the same outcome measure drawn as a chart, and resolution
            analytics live on the administrator's Metrics page. */}
      </div>
    </AppShell>
  )
}
