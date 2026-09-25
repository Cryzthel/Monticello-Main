import { TrendingUp, TrendingDown } from 'lucide-react'

/**
 * One headline figure, as a layered card (2026-09-22 redesign):
 *
 *   ┌ shell ─────────────────────────┐
 *   │ ┌ face ──────────────────────┐ │
 *   │ │ Total incidents            │ │   white, hairline, soft shadow
 *   │ │ 12,847                     │ │
 *   │ └────────────────────────────┘ │
 *   │  (+12%)  Reports filed in …    │   the shell's own strip
 *   └────────────────────────────────┘
 *
 * The face carries the two things a strip of four exists to show, the label
 * and the number; the strip under it carries the trend and what the number
 * means. Reading down the row, every figure sits at the same height whatever
 * its footnote says.
 *
 * The value is Inter with tabular figures, not mono: equal-width digits are
 * what keep "12,847" and "11,846" aligned, and the UI face does that without
 * reading as code.
 *
 * `compact` drops the strip and sets the trend beside the number, for places
 * where the row sits directly above a map and every pixel is taken from it.
 */
export default function KpiCard({
  label,
  value,
  delta,
  deltaDirection = 'up',
  deltaTone,
  helpText,
  density = 'default',
  tone = 'neutral',
  className = '',
}) {
  const isUp = deltaDirection === 'up'
  const good = (deltaTone ?? (isUp ? 'positive' : 'negative')) === 'positive'
  const compact = density === 'compact'
  // `Number(value) > 0`, not `value`. Both danger callers pass a count, and one
  // of them passes the string '—' while it is still loading — which is truthy,
  // so the card used to paint a RED DASH: it signalled an emergency at the one
  // moment it knew nothing, then went quiet when the count resolved to a real
  // 0 (falsy, so correct only by accident). A danger tone has to mean "there is
  // something", and NaN > 0 and 0 > 0 are both false, which is the whole rule.
  const valueTone =
    tone === 'danger' && Number(value) > 0
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : 'text-text-primary'

  const trend = delta ? (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-caption font-medium tabular-nums ring-1 ring-inset ${
        good
          ? 'bg-pill-success text-pill-success-fg ring-pill-success-fg/15'
          : 'bg-pill-danger text-pill-danger-fg ring-pill-danger-fg/15'
      }`}
    >
      {isUp ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
      {delta}
    </span>
  ) : null

  return (
    <div className={`kpi-shell ${className}`}>
      <div className={`kpi-face ${compact ? 'px-3 py-2.5' : 'px-4 py-3.5'}`}>
        <p className={`truncate font-medium text-text-secondary ${compact ? 'text-xs' : 'text-sm'}`}>{label}</p>
        <div className={`flex items-center justify-between gap-2 ${compact ? 'mt-1' : 'mt-1.5'}`}>
          <p
            className={`font-semibold tabular-nums tracking-tight ${
              compact ? 'text-xl leading-7' : 'text-3xl leading-9'
            } ${valueTone}`}
          >
            {value}
          </p>
          {compact ? trend : null}
        </div>
      </div>
      {!compact && (trend || helpText) ? (
        <div className="flex min-h-9 min-w-0 items-center gap-2 px-3 py-2">
          {trend}
          {helpText ? <p className="min-w-0 truncate text-xs text-text-muted">{helpText}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
