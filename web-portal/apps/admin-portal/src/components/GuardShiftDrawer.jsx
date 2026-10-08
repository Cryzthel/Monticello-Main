import { X } from '@shared/icons'

/**
 * One guard's whole duty history.
 *
 * ── WHY THIS EXISTS BESIDE ShiftRecordDrawer ────────────────────────────────
 * `ShiftRecordDrawer` inspects ONE shift: what that officer dispatched and
 * resolved between clocking in and clocking out. This answers a different
 * question — how much has this officer worked, and when. The two are not
 * variations of one drawer, they are different nouns, and merging them would
 * mean a component that renders either a shift or a person depending on which
 * prop was passed.
 *
 * ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
 * "On-time arrival rate" is in the brief and is deliberately absent. It needs
 * a SCHEDULED start to compare each clock-in against, and nothing in this
 * product rosters a guard to a shift — `shift` on the document is what the
 * officer was working, recorded at clock-in, not what they were due to work.
 * Comparing clock-in against the shift WINDOW would measure something else and
 * call it punctuality: a guard who legitimately starts a night shift at 23:00
 * inside a 22:00-06:00 window would read as an hour late, every night.
 *
 * Implementing that honestly means a roster. Until there is one, the figure
 * would be a number that looks like data and is not.
 */

const STAMP = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
const stamp = (d) => (d ? d.toLocaleString('en-GB', STAMP).replace(',', '') : '—')
const clock = (d) => (d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—')

/** Minutes as `7h 20m`. Hours alone hide a short shift; minutes alone stop scanning. */
function hoursAndMinutes(total) {
  if (!total) return '—'
  const h = Math.floor(total / 60)
  const m = Math.round(total % 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg bg-base-800 px-3 py-2.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-text-primary">{value}</p>
    </div>
  )
}

export default function GuardShiftDrawer({ guard, onClose, onOpenShift }) {
  if (!guard) return null

  const completed = guard.shifts.filter((s) => !s.open)

  return (
    <div className="dialog-scrim fixed inset-0 z-50 flex justify-end bg-scrim" onClick={onClose}>
      <div
        className="card flex h-full w-full max-w-lg animate-[drawerInRight_260ms_var(--ease-out-strong)] flex-col overflow-hidden rounded-none border-y-0 border-r-0 bg-base-900 shadow-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-text-primary">{guard.name}</h2>
              {guard.onDuty ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-2xs font-semibold text-success ring-1 ring-inset ring-success/30">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                  On duty
                </span>
              ) : (
                <span className="rounded-full bg-tint/10 px-2 py-0.5 text-2xs font-semibold text-text-secondary">
                  Off duty
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-text-secondary">{guard.email}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn h-11 w-11 shrink-0 sm:h-8 sm:w-8">
            <X size="sm" />
          </button>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
          {/* Completed shifts, not all shifts: an open one has no duration yet,
              so counting it would make the average of a guard mid-shift drop
              every time the page re-read. */}
          <dl className="grid grid-cols-2 gap-2">
            <Metric label="Total hours" value={hoursAndMinutes(guard.totalMinutes)} />
            <Metric label="Shifts completed" value={completed.length} />
          </dl>

          <p className="meta-label mt-5 mb-2">Duty log</p>

          {guard.shifts.length === 0 ? (
            <p className="text-sm text-text-secondary">No shifts recorded for this officer.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-hairline">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr className="table-head">
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Shift</th>
                    <th className="px-3 py-2.5 font-medium">In</th>
                    <th className="px-3 py-2.5 font-medium">Out</th>
                    <th className="px-3 py-2.5 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {guard.shifts.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => onOpenShift?.(s.id)}
                      className="data-row cursor-pointer border-t border-divider"
                      title="Open this shift's activity"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-text-primary">{stamp(s.timeIn)}</td>
                      <td className="px-3 py-2.5 capitalize text-text-secondary">{s.shift || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-text-secondary">{clock(s.timeIn)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-text-secondary">
                        {s.open ? 'On duty' : clock(s.timeOut)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-text-secondary">
                        {s.open ? '—' : hoursAndMinutes(s.durationMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-2 text-2xs text-text-muted">
            Select a shift to see what was dispatched and resolved during it.
          </p>
        </div>
      </div>
    </div>
  )
}
