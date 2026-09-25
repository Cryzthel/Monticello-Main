import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import Card from '@shared/components/Card'
import { Skeleton, SkeletonChart, SkeletonDonut } from '@shared/components/Skeleton'
import { computeDailyCounts } from '@shared/lib/incidents'
import { categoryColor, categoryLabel } from '@shared/lib/incidentCategories'
import { CHART_MARGIN, yAxisWidth } from '@shared/theme/chartAxis'

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-hairline bg-base-850 px-3 py-2 text-xs shadow-overlay">
      <p className="text-text-secondary">{label}</p>
      <p className="font-medium text-text-primary">{payload[0].value} incidents</p>
    </div>
  )
}

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { category, count } = payload[0].payload
  return (
    <div className="rounded-xl border border-hairline bg-base-850 px-3 py-2 text-xs shadow-overlay">
      <p className="font-medium text-text-primary">{categoryLabel(category)}</p>
      <p className="text-text-secondary">{count} incidents</p>
    </div>
  )
}

/**
 * @param {object} props
 * @param {Array} props.incidents Already windowed by the caller.
 * @param {Array<{category: string, count: number}>} props.categoryBreakdown
 *   Computed upstream by `usePortalMetrics`, not here.
 *
 *   ── WHY THIS IS A PROP AND NOT A useMemo ─────────────────────────────────
 *   This panel used to call `computeCategoryBreakdown` itself. That is one
 *   more place deriving a headline figure, and it is exactly where the donut
 *   and the KPI cards drifted apart: the panel bucketed raw category strings
 *   while the cards counted rows, so on any data set containing both
 *   'Security' and 'security' the slices summed to the card's number while
 *   showing two entries for one category. Passing the finished array in leaves
 *   this component with rendering as its only job.
 * @param {boolean} [props.loading] Whether the incident feed is still opening.
 *
 *   ── WHY THE PANEL NEEDS THIS AND THE CHARTS DO NOT ───────────────────────
 *   Without it the donut rendered "No data yet." for the whole of the initial
 *   subscription, which is not a slow state — it is a WRONG one. An admin
 *   opening the overview on a property with three hundred reports was told, in
 *   plain words, that there were none, and then the sentence was replaced by a
 *   chart. The empty state is still correct once the feed has actually
 *   delivered an empty array; it just must not be reachable before then.
 */
export default function AnalyticsPanel({
  incidents = [],
  days = 30,
  categoryBreakdown = [],
  loading = false,
}) {
  const dailyCounts = useMemo(() => computeDailyCounts(incidents, days), [incidents, days])
  const trendData = useMemo(
    () =>
      dailyCounts.map((d) => ({
        date: d.date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
        count: d.count,
      })),
    [dailyCounts],
  )
  const totalCategorized = categoryBreakdown.reduce((sum, c) => sum + c.count, 0)
  const totalInRange = dailyCounts.reduce((sum, d) => sum + d.count, 0)
  // Busiest single day, which is what the axis has to scale to — not the
  // range total, which is an order of magnitude larger and would reserve a
  // gutter for digits the axis never draws.
  const peakDay = dailyCounts.reduce((max, d) => Math.max(max, d.count), 0)
  const tickEvery = Math.max(1, Math.floor(trendData.length / 6))

  return (
    // 6+6 on the shared 12-column track, from `xl`.
    //
    // This was 8+4 from `lg`, and the reason given — that its edges line up
    // with the KPI row — was true while that row was three-up: an 8+4 gutter
    // sits at two-thirds, directly under a three-up row's second gutter. The
    // Overview has four cards again, and a four-up row's gutters sit at
    // quarters, so only a half split keeps that promise. 6+6 lands under the
    // middle gutter of both four-up rows above it.
    //
    // It also gives the donut a usable box. The chart is 45% of this card, and
    // at 8+4 the card measured 221px at 1024px and 306px at 1280px — a 58px
    // and a 119px donut. Below `xl` the two panels now stack at full width.
    // See .page-grid in the shared stylesheet for why splits wait for `xl`.
    <div className="page-grid">
      <Card className="col-span-12 flex h-72 flex-col p-5 xl:col-span-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-text-primary">Incident volume</p>
          {/* The count is withheld rather than shown as 0 while the feed opens,
              for the same reason the donut's empty state is — a confident
              "0 in range" that becomes "312 in range" is a misstatement, not a
              loading state. */}
          {loading ? (
            <Skeleton variant="muted" className="h-3 w-20" />
          ) : (
            <span className="text-xs text-text-secondary">{totalInRange} in range</span>
          )}
        </div>
        {loading ? (
          /* `flex-1` + `showLegend={false}`: the area chart has no legend, and
             the skeleton has to fill exactly the same box ResponsiveContainer
             does or the card's fixed h-72 shows a gap under the placeholder. */
          <SkeletonChart height="h-full" className="min-h-0 flex-1" showLegend={false} />
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendData} margin={CHART_MARGIN}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-fill)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--color-chart-fill)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              interval={tickEvery - 1}
              tick={{ fill: 'var(--color-chart-axis)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-chart-grid)' }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--color-chart-axis)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={yAxisWidth(peakDay)}
            />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--color-brand-500)', strokeOpacity: 0.35 }} />
            <Area type="monotone" dataKey="count" stroke="var(--color-chart-line)" strokeWidth={2} fill="url(#trendFill)" />
          </AreaChart>
        </ResponsiveContainer>
        )}
      </Card>

      <Card className="col-span-12 flex h-72 flex-col p-5 xl:col-span-6">
        <p className="mb-2 text-sm font-semibold text-text-primary">Category breakdown</p>
        {loading ? (
          <SkeletonDonut className="min-h-0 flex-1" size="h-32 w-32" legendRows={4} />
        ) : categoryBreakdown.length === 0 ? (
          <p className="text-sm text-text-secondary">No data yet.</p>
        ) : (
          <div className="flex flex-1 items-center gap-4">
            <ResponsiveContainer width="45%" height="100%">
              <PieChart>
                <Pie
                  data={categoryBreakdown}
                  dataKey="count"
                  nameKey="category"
                  innerRadius="60%"
                  outerRadius="85%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {/* Coloured by CATEGORY, not by position in the array. The
                      palette used to be indexed, so a slice's colour was a
                      function of how busy the week had been — flip the
                      timeframe pill and Maintenance went from blue to amber.
                      Nothing looked broken, because the legend followed; it
                      just quietly stopped being possible to compare two views.
                      The values are the mobile picker's own accents, so a
                      category reads the same on the resident's phone and here. */}
                  {categoryBreakdown.map((entry) => (
                    <Cell key={entry.category} fill={categoryColor(entry.category)} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-2 text-xs">
              {categoryBreakdown.map((segment) => (
                <li key={segment.category} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-text-secondary">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: categoryColor(segment.category) }}
                    />
                    {categoryLabel(segment.category)}
                  </span>
                  <span className="font-medium text-text-primary">{segment.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {loading ? (
          <Skeleton variant="muted" className="mt-2 h-2.5 w-48" />
        ) : (
          <p className="mt-2 text-caption text-text-muted">{totalCategorized} incidents categorized in this timeframe</p>
        )}
      </Card>
    </div>
  )
}
