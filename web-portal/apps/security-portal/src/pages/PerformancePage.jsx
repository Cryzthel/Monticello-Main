import { useMemo, useState } from 'react'
import { collection, query, orderBy, limit } from 'firebase/firestore'
import AppShell from '@/layouts/AppShell'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import DutyPanel from '@/components/DutyPanel'
import PriorityBreakdownChart from '@shared/components/PriorityBreakdownChart'
import CategoryBreakdownPanel from '@/components/CategoryBreakdownPanel'
import KpiCard from '@shared/components/KpiCard'
import { Skeleton, SkeletonKpiRow } from '@shared/components/Skeleton'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useMetricsClock } from '@/hooks/useMetricsClock'
import { db } from '@shared/lib/firebase'
import { mapIncidentDoc } from '@shared/lib/incidents'
import {
  OVERDUE_SLA_MINUTES,
  SHIFT_WINDOW_HOURS,
  computeResponseMetrics,
} from '@/lib/responseMetrics'

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
 *   the clock     `useMetricsClock` ticks every 15s. Three of these metrics
 *                 measure against the present, and a snapshot listener does
 *                 not fire when the only thing that changed is the time. See
 *                 the hook for why a quiet shift is the case that needs it.
 *
 * `computeResponseMetrics` takes the array and the instant and returns the
 * whole row, so every card reads the same clock and there is one file to look
 * in for what any of these numbers means.
 */
export default function PerformancePage() {
  // Window for the category breakdown only — the KPI row above it is a fixed
  // rolling shift window, which is a different question.
  const [rangeDays, setRangeDays] = useState(30)

  const historyQuery = useMemo(
    () => query(collection(db, 'incidents'), orderBy('reportedAt', 'desc'), limit(500)),
    [],
  )
  const { data: rawIncidents, loading } = useLiveCollection(historyQuery)
  const reports = useMemo(() => rawIncidents.map(mapIncidentDoc), [rawIncidents])

  const now = useMetricsClock()
  const metrics = useMemo(() => computeResponseMetrics(reports, now), [reports, now])

  return (
    <AppShell
      dutyLock={false}
      title="Response metrics"
      subtitle="Shift performance, dispatch efficiency and response times by category."
      topBarSlot={<GuardHeaderActions />}
    >
      <div className="flex flex-col gap-6">
        {/* ── THE DUTY PANEL ──────────────────────────────────────────────
            First, and on this page specifically, because this is the only
            console page that renders with `dutyLock={false}` — so it is the
            only one where the OFF-duty half of the panel can ever be seen.
            It takes the page's own `reports` array rather than subscribing
            again; the same documents answering two listeners is two answers
            that can disagree. */}
        <DutyPanel reports={reports} />

        {/* ── THE RESPONSE ROW ────────────────────────────────────────────
            Six cards, in the order a call passes through them: how much is
            open, how much of it is late, how fast we assign, when the next
            deadline lands, how much we close, and how long a case takes end to
            end.

            An explicit 3-up rather than the shared `kpi-grid`. That class is
            built for four cards — one, two, then four up — so six on it would
            break as four plus two at desktop widths. (It used to be `auto-fit
            minmax(14rem, 1fr)`, which orphaned the sixth card on a 1440px
            laptop with the rail collapsed.) Six divides evenly by three and by
            two, so fixing the column count keeps the row balanced at every
            width it actually breaks at.

            The 3-up waits for `xl`, not `lg`, so this row changes shape at the
            same breakpoint as every other dashboard row (see .page-grid). That
            is a consistency call, not a rescue: at 1024px with the rail open
            three cards would be 221px, and the Overview's four-up cards measure
            223px at 1280px with nothing clipped — they only grow one line of
            help text taller. From 1024 to 1279px the six sit two-up in three
            even rows, which is roomier rather than more correct.

            Average Dispatch Time, On-Site ETA and Resolution Rate are new
            here; every one of them moves the moment a status changes on the
            dispatch map, which is the point of this pass. */}
        {/* The placeholder takes the SAME explicit 3-up grid the real row
            does, not the shared `kpi-grid` — the note above is the reason, and
            a skeleton that wrapped differently from the content it precedes
            would reintroduce the shift it exists to prevent. */}
        {loading ? (
          <SkeletonKpiRow
            count={6}
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
          />
        ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            label="Active now"
            value={metrics.activeCount}
            helpText="Everything not yet resolved"
          />
          <KpiCard
            label="Overdue"
            value={metrics.overdueCount}
            tone="danger"
            helpText={`Dispatched > ${OVERDUE_SLA_MINUTES} min`}
          />
          {/* Report submitted -> unit assigned. The half of the response the
              guardhouse actually controls: everything after it depends on how
              far the unit has to drive. */}
          <KpiCard
            label="Avg dispatch time"
            value={metrics.avgDispatchTime}
            helpText="Report to unit assigned"
          />
          {/* A deadline, not a prediction — nothing here knows where a unit
              is. This is the soonest on-site target still running across every
              open call; see nextOnSiteDeadline for why the soonest rather
              than the average. */}
          <KpiCard
            label="On-Site ETA"
            value={metrics.onSiteEta}
            tone={metrics.onSiteEtaBreached ? 'danger' : 'neutral'}
            helpText="Soonest on-site target still open"
          />
          <KpiCard
            label="Resolution rate"
            value={metrics.resolutionRateLabel}
            tone="success"
            helpText={`${metrics.resolvedCount} of ${reports.length} reports closed`}
          />
          <KpiCard
            label="Avg resolution time"
            value={metrics.avgResolutionTime}
            helpText="Report to resolved"
          />
        </div>
        )}

        {/* Resolved This Shift moved into the Resolution Rate card's supporting
            line as "N of M closed", which says the same thing with a
            denominator. The rolling window it used is still the basis of
            `resolvedThisShift` in the metrics module for any surface that
            wants the raw count. */}
        {loading ? (
          <Skeleton variant="muted" className="-mt-3 h-3 w-96 max-w-full" />
        ) : (
          <p className="-mt-3 text-xs text-text-muted">
            {`${metrics.resolvedThisShift} resolved in the last ${SHIFT_WINDOW_HOURS}h · figures update live as statuses change on the dispatch map.`}
          </p>
        )}

        {/* Active Incidents by Priority — full width now that the mini map
            is gone; the full dispatch map lives on /dashboard. */}
        <PriorityBreakdownChart incidents={metrics.activeReports} loading={loading} />

        {/* The ticket queue used to sit here. It is its own page now
            (/tickets) — this one is analytics only. */}
        {/* `loading` was already a prop on this panel, with a skeleton branch
            behind it, and this page never passed it — so the branch had never
            once rendered and the panel showed its "Nothing resolved in this
            window yet." empty state during every initial load. */}
        <CategoryBreakdownPanel
          incidents={reports}
          rangeDays={rangeDays}
          onRangeChange={setRangeDays}
          loading={loading}
        />
      </div>
    </AppShell>
  )
}
