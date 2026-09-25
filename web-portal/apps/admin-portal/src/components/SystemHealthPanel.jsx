import SectionHeading from '@shared/components/SectionHeading'
import StatusIndicator from '@shared/components/StatusIndicator'
import { describeHealth, describeResponse } from '@shared/hooks/useSystemHealth'
import { clockTime, relativeTime } from '@shared/lib/notifications'
import { DISPATCH_SLA_MINUTES } from '@/hooks/usePortalMetrics'

/** Open reports above which the queue is flagged as busier than usual. */
const OPEN_INCIDENT_THRESHOLD = 10

/**
 * The live system-status strip, shared by the Overview and System Metrics.
 *
 * -- ONE STRIP, TWO DENSITIES ----------------------------------------------
 * Both pages previously answered "is the platform healthy" differently: the
 * Overview did not answer it at all, and System Metrics answered it with four
 * tiles derived from its own arithmetic. This is one component reading one
 * hook, so the two pages cannot report different system states — which is the
 * whole of "system health metrics sync". `variant` changes how much detail is
 * shown, never where a number comes from.
 *
 *   summary  Overview. The four readings worth interrupting a dashboard for.
 *   full     System Metrics. Adds the sync clock and the queue's two backlog
 *            measures, laid out as platform row / operations row.
 *
 * -- WHAT THE TILES ARE JUDGED AGAINST -------------------------------------
 * Every threshold is stated in the tile's own detail slot rather than living
 * in a legend, because a status a reader has to look up is a status they will
 * not check. The two connectivity tiles get their verdict from the hook (see
 * describeHealth / describeResponse) so the words "Connected" and "Slow" mean
 * the same measurement everywhere they appear.
 */
export default function SystemHealthPanel({
  health,
  operations,
  residentCounts,
  residentsLoading,
  variant = 'summary',
}) {
  const feed = describeHealth(health)
  const response = describeResponse(health)
  const full = variant === 'full'

  const feedTile = (
    <StatusIndicator
      key="feed"
      label="Live data feed"
      value={feed.label}
      state={feed.tone}
      detail={feed.detail}
    />
  )
  const responseTile = (
    <StatusIndicator
      key="response"
      label="Server response"
      value={response.value}
      state={response.tone}
      detail={response.detail}
    />
  )
  // The dot agrees with the caption. It used to go amber at one open incident
  // while the same tile read "within normal", which is a contradiction the
  // reader resolves by learning to ignore the amber — and the amber pulses.
  // An open queue is the normal state of a security console; only a queue
  // above the threshold is worth a colour.
  const busy = operations.openCount > OPEN_INCIDENT_THRESHOLD
  const openTile = (
    <StatusIndicator
      key="open"
      label="Open incidents"
      value={operations.openCount}
      state={busy ? 'warn' : 'ok'}
      detail={busy ? 'above normal' : 'within normal'}
    />
  )

  if (!full) {
    return (
      <section className="flex flex-col gap-3">
        <SectionHeading
          title="System health"
          description="Live connection to the incident database, and the queue right now."
        />
        <div className="kpi-grid">
          {feedTile}
          {responseTile}
          {openTile}
          {/* Registered residents is a PLATFORM reading, not an incident one —
              how many accounts the system serves and how many are still
              waiting on a human. It sits here rather than in the analytics row
              above because a pending verification is a task, not a statistic,
              and the strip is where this page puts things somebody must act
              on. */}
          <StatusIndicator
            label="Registered residents"
            value={residentsLoading ? '—' : residentCounts.all}
            state={residentsLoading ? 'idle' : (residentCounts.pending ?? 0) > 0 ? 'warn' : 'ok'}
            detail={residentsLoading ? 'Loading…' : `${residentCounts.pending ?? 0} pending`}
          />
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="System health"
        description={
          health.lastSyncAt
            ? `Platform and queue status · last confirmed sync ${clockTime(health.lastSyncAt)}`
            : 'Platform and queue status'
        }
      />
      {/* Three up rather than the four-up KPI track: `.kpi-grid` is built for
          four, and six tiles on it would break as four plus two at desktop
          widths. Three columns give two even rows, and the split falls exactly
          where the meaning does — platform above, operations below.

          From `xl`, not `lg` — at 1024px with the rail open a third of the
          column is ~221px. Two-up below that is three even rows.

          gap-6, not gap-4. The summary variant above renders through
          `.kpi-grid`, whose gutter is 24px, so this one panel had two gutters
          depending on which page mounted it; and on System Metrics it sits
          directly over a 24px KPI row. */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {feedTile}
        {responseTile}
        <StatusIndicator
          label="Last sync"
          value={clockTime(health.lastSyncAt)}
          state={health.state === 'live' ? 'ok' : health.state === 'checking' ? 'idle' : 'warn'}
          detail={health.lastSyncAt ? relativeTime(health.lastSyncAt) : 'no reading'}
        />
        {openTile}
        <StatusIndicator
          label="Overdue dispatches"
          value={operations.overdueCount}
          state={operations.overdueCount === 0 ? 'ok' : operations.overdueCount > 2 ? 'bad' : 'warn'}
          detail={`target ${DISPATCH_SLA_MINUTES} min`}
        />
        <StatusIndicator
          label="No officer assigned"
          value={operations.unassignedCount}
          state={operations.unassignedCount === 0 ? 'ok' : 'warn'}
          detail="awaiting a responder"
        />
      </div>
    </section>
  )
}
