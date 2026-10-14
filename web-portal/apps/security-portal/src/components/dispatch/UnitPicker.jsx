import { UserX } from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import { UNIT_STATE_LABELS, rankUnits } from '@/hooks/useGuardUnits'
import { formatDistance } from '@/lib/directions'
import { initials, unitLabel } from '@shared/lib/unitIdentity'

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
        <UserX size="sm" className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
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
        const { label, badge } = unitLabel(unit)
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
                <span className="truncate text-label font-semibold text-text-primary">{label}</span>
                {badge ? (
                  <span className="shrink-0 font-mono text-2xs text-text-muted">{badge}</span>
                ) : null}
              </span>
              {/* ── ONE PILL, AND IT ALWAYS SAYS THE SAME KIND OF THING ──
                  An available unit used to get a TelemetryBadge here —
                  "GPS live ±8 m · just now", or "Approx" — while a busy one
                  got its state. Two different questions answered in the same
                  slot, so the column read as a state for half the rows and a
                  sensor reading for the other half, and the dispatcher had to
                  work out which they were looking at.

                  The state is the one that decides anything: a dispatcher
                  scanning this list is asking who is free. Fix quality only
                  mattered as a proxy for "can I route to them", and the
                  distance on the right already answers that — it is null, and
                  shows an em dash, precisely when there is no usable fix. */}
              <span className="mt-1 flex">
                <StatusBadge tone={STATE_TONES[unit.state]} size="sm" dot>
                  {UNIT_STATE_LABELS[unit.state]}
                </StatusBadge>
              </span>
            </span>
            {/* The "straight line" caption is gone. It qualified the figure
                honestly — this is crow-flies, not road distance — and it cost
                a second line on every row to say something that is the same
                on every row, next to a number nobody mistakes for a route:
                the road ETA appears on the panel once a unit is picked. */}
            <span className="shrink-0 text-label font-semibold tabular-nums text-text-primary">
              {unit.distanceM != null ? formatDistance(unit.distanceM) : '—'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
