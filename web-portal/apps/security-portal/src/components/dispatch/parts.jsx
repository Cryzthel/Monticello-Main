import { useEffect, useState } from 'react'
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Check,
  CircleAlert,
  LocateFixed,
  LocateOff,
} from 'lucide-react'
import StatusBadge from '@shared/components/StatusBadge'
import { categoryColor, categoryLabel, normalizeCategory } from '@shared/lib/incidentCategories'
import { DISPATCH_STAGES, STAGE_LABELS, stageIndex } from '@shared/lib/dispatchStage'
import { formatAgo, formatStopwatch } from '@/lib/dispatch'
import { categoryIcon } from '@shared/theme/categoryIcons'

/**
 * Small pieces of the dispatch drawer, kept apart from it so the drawer file
 * reads as layout and the unit picker can reuse the telemetry badges.
 */

/** Stage → badge tone. Responding and on-site match the unit colours on the map. */
export const STAGE_TONES = {
  none: 'neutral',
  dispatched: 'warning',
  responding: 'high',
  on_site: 'info',
  investigating: 'violet',
  resolved: 'success',
}

export function StageBadge({ stage, size = 'sm' }) {
  return (
    <StatusBadge tone={STAGE_TONES[stage] ?? 'neutral'} size={size} dot>
      {STAGE_LABELS[stage] ?? STAGE_LABELS.none}
    </StatusBadge>
  )
}

/**
 * The category as an icon tile, in the category's own colour — the same
 * colour the category charts use, so a medical call reads rose in both
 * places.
 */
export function CategoryIconBadge({ category, className = '' }) {
  const key = normalizeCategory(category)
  const Icon = categoryIcon(key)
  const color = categoryColor(key)
  return (
    <span
      title={categoryLabel(key)}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${className}`}
      style={{ backgroundColor: `${color}1f`, color, '--tw-ring-color': `${color}55` }}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
  )
}

/** One bordered block of the drawer. */
export function Section({ icon: Icon, title, meta, children, tone = '' }) {
  return (
    <section className={`rounded-xl border border-hairline bg-slate-50 ${tone}`}>
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-3.5 py-2">
        <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-secondary">
          <Icon className="h-3.5 w-3.5 shrink-0 text-brand-400" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h3>
        {meta ? <span className="shrink-0 text-2xs text-text-muted">{meta}</span> : null}
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  )
}

/**
 * A clock that moves every second. Frozen at `until` once the call closes, so
 * a resolved report shows how long it took rather than how long ago it was.
 */
export function ElapsedClock({ since, until = null, className = '' }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since || until) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [since, until])
  if (!since) return <span className={className}>—</span>
  const end = until ? new Date(until).getTime() : now
  return (
    <span className={`font-mono tabular-nums ${className}`}>{formatStopwatch(end - new Date(since).getTime())}</span>
  )
}

const STAGE_STAMPS = {
  dispatched: 'dispatchedAt',
  responding: 'respondingAt',
  on_site: 'onSceneAt',
  investigating: 'investigatingAt',
  resolved: 'resolvedAt',
}

const CLOCK = { hour: '2-digit', minute: '2-digit', hour12: false }

/**
 * DISPATCHED → RESPONDING → ON-SITE → INVESTIGATING → RESOLVED, with the time
 * each step was reached. Done steps are filled, the current one is ringed,
 * the rest are muted. An ordered list, so a screen reader reads it as steps.
 */
export function StageStepper({ report }) {
  const current = stageIndex(report.dispatchStage)
  return (
    <ol className="grid grid-cols-5" aria-label="Dispatch stage">
      {DISPATCH_STAGES.map((stage, i) => {
        const step = i + 1
        const done = step < current || (step === current && stage === 'resolved')
        const active = step === current && !done
        const at = report[STAGE_STAMPS[stage]]
        return (
          <li
            key={stage}
            aria-current={active ? 'step' : undefined}
            className="relative flex min-w-0 flex-col items-center text-center"
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={`absolute right-1/2 top-2.5 h-0.5 w-full -translate-y-1/2 ${
                  step <= current ? 'bg-brand-500' : 'bg-tint/10'
                }`}
              />
            ) : null}
            <span
              className={`relative z-[1] flex h-5 w-5 items-center justify-center rounded-full text-2xs font-bold ${
                done
                  ? 'bg-brand-500 text-base-900'
                  : active
                    ? 'bg-base-800 text-brand-400 ring-2 ring-brand-500'
                    : 'bg-base-800 text-text-muted ring-1 ring-tint/15'
              }`}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : step}
            </span>
            <span
              className={`mt-1 w-full truncate px-0.5 text-2xs font-semibold ${
                active ? 'text-text-primary' : done ? 'text-text-secondary' : 'text-text-muted'
              }`}
            >
              {STAGE_LABELS[stage]}
            </span>
            <span className="font-mono text-2xs tabular-nums text-text-muted">
              {at ? new Date(at).toLocaleTimeString('en-GB', CLOCK) : '—'}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** Battery as an icon, a percentage and a tone. Unknown is said, not guessed. */
export function BatteryIndicator({ battery, compact = false }) {
  if (!battery || !Number.isFinite(battery.level)) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-text-muted" title="This browser does not report battery">
        <Battery className="h-3.5 w-3.5" aria-hidden="true" />
        {compact ? '—' : 'Battery n/a'}
      </span>
    )
  }
  const pct = Math.round(battery.level * 100)
  let Icon = BatteryFull
  let tone = 'text-success'
  if (battery.charging) Icon = BatteryCharging
  else if (pct <= 15) {
    Icon = BatteryWarning
    tone = 'text-danger'
  } else if (pct <= 30) {
    Icon = BatteryLow
    tone = 'text-warning'
  } else if (pct <= 60) Icon = BatteryMedium
  return (
    <span
      className={`inline-flex items-center gap-1 text-2xs font-semibold tabular-nums ${tone}`}
      title={`Battery ${pct}%${battery.charging ? ', charging' : ''}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {pct}%
    </span>
  )
}

const LOCATION_ERRORS = {
  'location-denied': 'Location blocked',
  'no-geolocation': 'No GPS on device',
  'no-fix': 'No GPS fix',
}

/**
 * The state of a unit's position feed, as one capsule:
 *   live         a recent fix  — "GPS live ±8 m · 3 s ago"
 *   approximate  a fix too coarse to route on precisely
 *   stale        the device has gone quiet
 *   none         no position, with the reason when the device gave one
 */
export function TelemetryBadge({ unit }) {
  if (!unit?.position) {
    const reason = !unit?.reporting
      ? 'Not reporting'
      : LOCATION_ERRORS[unit.locationError] ?? (unit.mode === 'idle' ? 'Location sharing off' : 'No location')
    return (
      <StatusBadge tone="neutral" size="sm" icon={LocateOff}>
        {reason}
      </StatusBadge>
    )
  }
  const accuracy = Number.isFinite(unit.position.accuracy) ? ` ±${Math.round(unit.position.accuracy)} m` : ''
  const age = formatAgo(unit.positionAgeMs)
  if (unit.stale) {
    return (
      <StatusBadge tone="warning" size="sm" icon={LocateFixed}>
        Last fix {age}
      </StatusBadge>
    )
  }
  return (
    <StatusBadge tone={unit.approximate ? 'warning' : 'success'} size="sm" icon={LocateFixed}>
      {unit.approximate ? 'Approx' : 'GPS live'}
      {accuracy} · {age}
    </StatusBadge>
  )
}

/** Two-letter initials for a unit's avatar. */
export function initials(name = '') {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}
