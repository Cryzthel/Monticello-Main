import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import KpiCard from '@shared/components/KpiCard'
import SectionHeading from '@shared/components/SectionHeading'
import { Skeleton, SkeletonChart, SkeletonKpiRow } from '@shared/components/Skeleton'
import { phaseColor } from '@shared/lib/subdivisionBoundary'
import Card from '@shared/components/Card'
import PriorityBreakdownChart from '@shared/components/PriorityBreakdownChart'
import {
  computeCategoryResolutionTimes,
  computePhaseHotspots,
  formatMinutes,
} from '@shared/lib/incidents'
import { categoryLabel } from '@shared/lib/incidentCategories'
import { CHART_MARGIN, yAxisWidth } from '@shared/theme/chartAxis'

const TREND_WEEKS = 8

function computeWeeklyResolutionTrend(incidents) {
  const weeks = []
  for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    end.setDate(end.getDate() - i * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    weeks.push({ start, end, reported: 0, resolved: 0 })
  }

  incidents.forEach((incident) => {
    if (!incident.reportedAt) return
    const reportedDate = new Date(incident.reportedAt)
    const bucket = weeks.find((w) => reportedDate >= w.start && reportedDate <= w.end)
    if (!bucket) return
    bucket.reported += 1
    if (incident.status === 'Resolved') bucket.resolved += 1
  })

  return weeks.map((w) => ({
    label: w.start.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
    Reported: w.reported,
    Resolved: w.resolved,
  }))
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-hairline bg-base-850 px-3 py-2 text-xs shadow-overlay">
      <p className="mb-1 text-text-secondary">Week of {label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} style={{ color: entry.color }}>
          {entry.dataKey}: {entry.value}
        </p>
      ))}
    </div>
  )
}

function DurationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { category, avgMinutes, count } = payload[0].payload
  return (
    <div className="rounded-xl border border-hairline bg-base-850 px-3 py-2 text-xs shadow-overlay">
      <p className="font-medium text-text-primary">{categoryLabel(category)}</p>
      <p className="text-text-secondary">
        {formatMinutes(avgMinutes)} avg · {count} closed
      </p>
    </div>
  )
}

/**
 * The System Metrics page's charts and its key-indicator row.
 *
 * -- WHAT THIS COMPONENT NO LONGER COMPUTES --------------------------------
 * Total incidents, resolution rate, average response time and the evidence
 * rate all arrive as finished props from `usePortalMetrics` — the same hook
 * the Overview reads. It previously derived each of them here, from a private
 * `withinLast` window that disagreed with the Overview's `selectInRange` at
 * both ends, which is how one console came to display two different answers to
 * "how many incidents were there this month".
 *
 * What is left is genuinely local: three views nothing else renders.
 *
 * -- PLAIN WORDS -----------------------------------------------------------
 * "Overall MTTR" and "Data Integrity Rate" are gone as labels. The figures are
 * unchanged; the acronym and the compliance-audit phrasing are not, because a
 * dashboard that requires a glossary is not a dashboard. Every card now says
 * what it measures in the words an administrator would use out loud, and each
 * states its period rather than leaving the reader to infer it.
 */
export default function MetricsPanel({
  incidents = [],
  inRange = [],
  days = 30,
  totalIncidents,
  resolutionRate,
  avgResponseTime,
  evidenceRate,
  activeIncidents = [],
  /**
   * Whether the incident feed is still opening.
   *
   * Every empty state on this page is a SENTENCE about the property —
   * "Nothing closed yet.", "No phase data for this period." — and each one was
   * reachable before the data had arrived, so the System Metrics page opened by
   * telling an administrator three false things about their own subdivision
   * and then quietly replacing them with charts.
   */
  loading = false,
}) {
  const { weeklyTrend, categoryDurations, phaseHotspots, maxWeekly, maxPhaseCount } = useMemo(() => {
    const trend = computeWeeklyResolutionTrend(incidents)
    const hotspots = computePhaseHotspots(inRange)
    return {
      weeklyTrend: trend,
      categoryDurations: computeCategoryResolutionTimes(incidents).slice(0, 7),
      phaseHotspots: hotspots,
      maxWeekly: Math.max(1, ...trend.map((w) => Math.max(w.Reported, w.Resolved))),
      maxPhaseCount: Math.max(1, ...hotspots.map((h) => h.count)),
    }
  }, [incidents, inRange])

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionHeading title="Key numbers" />
        {loading ? (
          <SkeletonKpiRow count={4} />
        ) : (
        <div className="kpi-grid">
          <KpiCard
            label="Total incidents"
            value={totalIncidents}
            helpText="Reports filed in this period"
          />
          <KpiCard
            label="Avg response time"
            value={avgResponseTime}
            helpText="Report filed to security dispatched"
          />
          <KpiCard
            label="Resolution rate"
            value={resolutionRate}
            helpText="Share of this period's reports now closed"
          />
          {/* Was "Data Integrity Rate", which sounds like a database health
              check. It is the share of reports that arrived with a photo or a
              video attached — an evidence question, and the one an admin is
              actually asking when they look at it. */}
          <KpiCard
            label="Reports with evidence"
            value={evidenceRate}
            helpText="Photo or video attached"
          />
        </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Trends and hot-spots" />

        {/* Open reports by urgency — live, not windowed, and captioned as such
            inside the chart itself. */}
        <PriorityBreakdownChart incidents={activeIncidents} loading={loading} />

        <Card className="flex h-72 flex-col p-5">
          <p className="mb-2 text-sm font-semibold text-text-primary">
            Reports filed vs. closed — last {TREND_WEEKS} weeks
          </p>
          {loading ? (
            /* This one keeps its legend, because the real chart has one — two
               series, Reported and Resolved. The placeholder reserving a legend
               the chart will not draw is the same error as omitting one it
               will: either way the plot area resizes on swap. */
            <SkeletonChart height="h-full" className="min-h-0 flex-1" />
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyTrend} margin={CHART_MARGIN}>
              <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--color-chart-axis)', fontSize: 10 }} axisLine={{ stroke: 'var(--color-chart-grid)' }} tickLine={false} />
              <YAxis
                allowDecimals={false}
                domain={[0, maxWeekly]}
                tick={{ fill: 'var(--color-chart-axis)', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={yAxisWidth(maxWeekly)}
              />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: 'var(--color-chart-cursor)' }} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-axis)' }} />
              <Bar dataKey="Reported" fill="var(--color-chart-neutral)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Resolved" fill="var(--color-chart-line)" radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </Card>

        {/* Halves from `xl`, not `lg`: with the rail open at 1024px each half
            would be ~343px, too narrow for a 90px category axis plus bars.
            See .page-grid in the shared stylesheet. */}
        <div className="page-grid">
          <Card className="col-span-12 flex h-72 flex-col p-5 xl:col-span-6">
            <p className="mb-1 shrink-0 text-sm font-semibold text-text-primary">
              How long each type takes to close
            </p>
            <p className="mb-3 shrink-0 text-xs text-text-secondary">
              Average across every closed report
            </p>
            {loading ? (
              <SkeletonChart height="h-full" className="min-h-0 flex-1" showLegend={false} />
            ) : categoryDurations.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-sm text-text-secondary">
                Nothing closed yet.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryDurations}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke="var(--color-chart-grid)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--color-chart-axis)', fontSize: 11 }} axisLine={false} tickLine={false} hide />
                  <YAxis
                    type="category"
                    dataKey="category"
                    tickFormatter={categoryLabel}
                    tick={{ fill: 'var(--color-chart-axis)', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={90}
                  />
                  <Tooltip content={<DurationTooltip />} cursor={{ fill: 'var(--color-chart-cursor)' }} />
                  {/* The primary series token, not a literal. This was
                      `#38BDF8` (sky-400) — a colour that exists in no token in
                      this system and does not move between themes, so the bar
                      stayed the same blue on the dark canvas while the grid,
                      axes and cursor around it all flipped. Every other mark in
                      both charts already reads a `--color-chart-*` token, which
                      is also the proof Recharts accepts `var()` here. Almost
                      certainly residue from the retired blue-brand pass. */}
                  <Bar dataKey="avgMinutes" fill="var(--color-chart-line)" radius={[0, 6, 6, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card className="col-span-12 flex h-72 min-h-0 flex-col p-5 xl:col-span-6">
            <p className="mb-1 shrink-0 text-sm font-semibold text-text-primary">
              Reports by Phases
            </p>
            <p className="mb-3 shrink-0 text-xs text-text-secondary">
              Reports in the last {days} days
            </p>
            {loading ? (
              /* The real content is a list of labelled progress bars, so the
                 placeholder is too — a chart block here would be standing in
                 for the wrong shape entirely. */
              <div
                className="flex min-h-0 flex-1 flex-col justify-center gap-2.5"
                aria-busy="true"
                aria-label="Loading phase breakdown"
              >
                {[0, 1, 2, 3, 4].map((n) => (
                  <div key={n}>
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Skeleton variant="circle" className="h-2 w-2" />
                        <Skeleton className="h-2.5 w-20" />
                      </div>
                      <Skeleton variant="muted" className="h-2.5 w-6" />
                    </div>
                    <Skeleton variant="muted" className="h-1.5 w-full rounded-full" />
                  </div>
                ))}
              </div>
            ) : phaseHotspots.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-sm text-text-secondary">
                No phase data for this period.
              </p>
            ) : (
              <div className="custom-scrollbar flex min-h-0 flex-1 flex-col justify-center gap-2.5 overflow-y-auto">
                {phaseHotspots.map(({ phase, count }) => (
                  <div key={phase}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-text-primary">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: phaseColor(phase) }}
                        />
                        Phase {phase}
                      </span>
                      <span className="text-text-secondary">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-tint/5">
                      {/* Phase colour, not severity red: this bar answers
                          "which phase", and reusing danger red here would imply
                          a severity the chart does not measure. */}
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(count / maxPhaseCount) * 100}%`,
                          backgroundColor: phaseColor(phase),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  )
}
