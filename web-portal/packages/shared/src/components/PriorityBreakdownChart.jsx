import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts'
import Card from '@shared/components/Card'
import { SEVERITY_HEX } from '@shared/theme/severityColors'
import { CHART_MARGIN, yAxisWidth } from '@shared/theme/chartAxis'
import { Skeleton, SkeletonChart } from '@shared/components/Skeleton'

const ORDER = ['critical', 'high', 'medium', 'low']
const LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0].payload
  return (
    <div className="rounded-xl border border-hairline bg-base-850 px-3 py-2 text-xs shadow-overlay">
      <p className="font-medium text-text-primary">{name}</p>
      <p className="text-text-secondary">{value} active</p>
    </div>
  )
}

export default function PriorityBreakdownChart({ incidents = [], loading = false }) {
  const data = ORDER.map((key) => ({
    key,
    name: LABELS[key],
    value: incidents.filter((i) => (i.severity ?? 'medium') === key).length,
  }))
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const peak = data.reduce((max, d) => Math.max(max, d.value), 0)

  return (
    <Card className="flex h-72 flex-col p-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">Active incidents by priority</p>
        {/* Withheld rather than rendered as "0 active" while the query opens —
            on a priority chart that is a claim about the queue being clear,
            not a placeholder. */}
        {loading ? (
          <Skeleton variant="muted" className="h-3 w-16" />
        ) : (
          <span className="text-xs text-text-secondary">{total} active</span>
        )}
      </div>
      {loading ? (
        <SkeletonChart height="h-full" className="min-h-0 flex-1" showLegend={false} />
      ) : (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: 'var(--color-chart-axis)', fontSize: 12 }} axisLine={{ stroke: 'var(--color-chart-grid)' }} tickLine={false} />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--color-chart-axis)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={yAxisWidth(peak)}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-chart-cursor)' }} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
            {data.map((entry) => (
              <Cell key={entry.key} fill={SEVERITY_HEX[entry.key]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      )}
    </Card>
  )
}
