import { useMemo, useRef } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import Card from '@shared/components/Card'
import { Skeleton, SkeletonChart, SkeletonDonut } from '@shared/components/Skeleton'
import { computeDailyCounts } from '@shared/lib/incidents'
import { categoryColor, categoryLabel } from '@shared/lib/incidentCategories'
import { CHART_MARGIN, yAxisWidth } from '@shared/theme/chartAxis'
import { formatChartTick } from '@shared/lib/dates'

/*
  ── THREE DATE FORMATS, ONE PER JOB ─────────────────────────────────────────
  The axis used to print `10/16`: numeric month-first, which a reader outside
  the US parses as the tenth of a sixteenth month, and which says nothing about
  the year on the 1yr view. Each place a date appears now gets the shape its
  space allows:

    tick     "Oct 16"              — the axis has ~6 slots and needs width-stable
                                     labels; the year lives in the header range.
    tooltip  "Mon, Oct 16, 2026"   — one day under the cursor, room for all of it.
    range    "Sep 17 – Oct 16, 2026" — the whole window, year stated once, or
                                     twice when the window crosses New Year.

  The data key is the bucket's epoch ms, not a pre-formatted string, so the
  tick and the tooltip can format the same day differently.

  NOT pinned to the portal time zone, deliberately (checked 2026-10-19). Each
  bucket is a LOCAL midnight (computeDailyCounts), and these name the bucket,
  not a moment: pinning the label alone could print the day before the bucket
  it sits under. Timestamps go through shared/lib/dates; day-bucket labels stay
  in the zone the buckets were cut in.
*/
const TICK_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const TOOLTIP_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
const RANGE_FULL = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function formatRange(first, last) {
  if (!first || !last) return ''
  return first.getFullYear() === last.getFullYear()
    ? `${TICK_FORMAT.format(first)} – ${RANGE_FULL.format(last)}`
    : `${RANGE_FULL.format(first)} – ${RANGE_FULL.format(last)}`
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const count = payload[0].value
  return (
    <div className="rounded-xl border border-hairline bg-base-850 px-3 py-2 text-xs shadow-overlay">
      <p className="text-text-secondary">{TOOLTIP_FORMAT.format(label)}</p>
      <p className="font-medium tabular-nums text-text-primary">
        {count} {count === 1 ? 'incident' : 'incidents'}
      </p>
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
        day: d.date.getTime(),
        count: d.count,
      })),
    [dailyCounts],
  )
  /*
   * ── WHY THE DONUT LAGGED ────────────────────────────────────────────────
   * The breakdown is recomputed on EVERY live incidents snapshot, including
   * the ones that change no category count (a telemetry backfill, a status
   * write). Each produced a new array, and Recharts restarts its 1.5 s sweep
   * whenever `data` changes identity — so the donut kept re-drawing itself
   * from zero while the dashboard was live. The array is now held until its
   * CONTENT changes, so an unrelated write costs nothing on screen.
   */
  const breakdownKey = categoryBreakdown.map((c) => `${c.category}:${c.count}`).join('|')
  const stableBreakdownRef = useRef({ key: null, data: [] })
  if (stableBreakdownRef.current.key !== breakdownKey) {
    stableBreakdownRef.current = { key: breakdownKey, data: categoryBreakdown }
  }
  const stableBreakdown = stableBreakdownRef.current.data
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const totalCategorized = stableBreakdown.reduce((sum, c) => sum + c.count, 0)
  const totalInRange = dailyCounts.reduce((sum, d) => sum + d.count, 0)
  // Busiest single day, which is what the axis has to scale to — not the
  // range total, which is an order of magnitude larger and would reserve a
  // gutter for digits the axis never draws.
  const peakDay = dailyCounts.reduce((max, d) => Math.max(max, d.count), 0)
  const tickEvery = Math.max(1, Math.floor(trendData.length / 6))
  const rangeLabel = formatRange(dailyCounts[0]?.date, dailyCounts[dailyCounts.length - 1]?.date)

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
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">Incident volume</p>
            {/* The window in words, so the ticks can stay short. */}
            <p className="mt-0.5 truncate text-caption tabular-nums text-text-muted">{rangeLabel}</p>
          </div>
          {/* The count is withheld rather than shown as 0 while the feed opens,
              for the same reason the donut's empty state is — a confident
              "0 in range" that becomes "312 in range" is a misstatement, not a
              loading state. */}
          {loading ? (
            <Skeleton variant="muted" className="h-3 w-20" />
          ) : (
            <span className="shrink-0 text-xs tabular-nums text-text-secondary">{totalInRange} in range</span>
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
              dataKey="day"
              tickFormatter={(ms) => formatChartTick(ms)}
              interval={tickEvery - 1}
              minTickGap={12}
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
        ) : stableBreakdown.length === 0 ? (
          <p className="text-sm text-text-secondary">No data yet.</p>
        ) : (
          <div className="flex flex-1 items-center gap-4">
            <ResponsiveContainer width="45%" height="100%" debounce={120}>
              <PieChart>
                <Pie
                  data={stableBreakdown}
                  isAnimationActive={!reduceMotion}
                  animationDuration={500}
                  animationEasing="ease-out"
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
                  {stableBreakdown.map((entry) => (
                    <Cell key={entry.category} fill={categoryColor(entry.category)} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-2 text-xs">
              {stableBreakdown.map((segment) => (
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
