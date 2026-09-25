import { UserX } from 'lucide-react'
import StatusBadge from '@shared/components/StatusBadge'
import { UNIT_STATE_LABELS, rankUnits } from '@/hooks/useGuardUnits'
import { formatDistance } from '@/lib/directions'
import { BatteryIndicator, TelemetryBadge, initials } from '@/components/dispatch/parts'

const STATE_TONES = {
  available: 'success',
  assigned: 'warning',
  responding: 'high',
  on_scene: 'info',
}

/**
 * The on-duty officers, as a single-choice list, nearest available first.
 *
 * Choosing one previews that unit's road route on the map before anything is
 * written. The dispatcher sees how far the officer really is by road, not
 * just in a straight line, and Dispatch unit is what commits the choice.
 *
 * Busy units are listed but cannot be picked. Double-booking an officer who
 * is already on scene would leave one of the two calls with nobody. Showing
 * them anyway tells the dispatcher why a nearer name is not available.
 *
 * `excludeUid` is the officer the call is booked to now, on a reassignment.
 */
export default function UnitPicker({ units, value, onChange, excludeUid = null, disabled = false }) {
  const ranked = rankUnits(units.filter((unit) => unit.uid !== excludeUid))

  if (!ranked.length) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-slate-200 p-3">
        <UserX className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <p className="text-caption leading-snug text-text-secondary">
          {excludeUid
            ? 'No other officer is clocked in to reassign this call to.'
            : 'No officer is clocked in. An officer appears here once they clock in from the header.'}
        </p>
      </div>
    )
  }

  return (
    <div role="radiogroup" aria-label="Choose a unit" className="flex flex-col gap-1.5">
      {ranked.map((unit) => {
        const selectable = unit.state === 'available'
        const selected = value === unit.uid
        return (
          <button
            key={unit.uid}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || !selectable}
            onClick={() => onChange(selected ? null : unit.uid)}
            className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-[border-color,background-color] duration-150 disabled:cursor-not-allowed ${
              selected
                ? 'border-brand-500 bg-brand-100'
                : 'border-slate-200 bg-base-900 hover:border-slate-300 disabled:opacity-60 disabled:hover:border-slate-200'
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${
                selected ? 'bg-brand-500 text-base-900' : 'bg-tint/10 text-text-secondary'
              }`}
            >
              {initials(unit.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-label font-semibold text-text-primary">{unit.name}</span>
                {unit.badgeNumber ? (
                  <span className="shrink-0 font-mono text-2xs text-text-muted">{unit.badgeNumber}</span>
                ) : null}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                {selectable ? <TelemetryBadge unit={unit} /> : (
                  <StatusBadge tone={STATE_TONES[unit.state]} size="sm" dot>
                    {UNIT_STATE_LABELS[unit.state]}
                  </StatusBadge>
                )}
                <BatteryIndicator battery={unit.battery} compact />
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-label font-semibold tabular-nums text-text-primary">
                {unit.distanceM != null ? formatDistance(unit.distanceM) : '—'}
              </span>
              <span className="block text-2xs text-text-muted">straight line</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
