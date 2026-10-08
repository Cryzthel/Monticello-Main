import { LogIn, Loader2 } from '@shared/icons'
import ClockOutButton from '@/components/ClockOutButton'
import { useDutyStatus } from '@/hooks/useDutyStatus'
import { useNow } from '@shared/hooks/useNow'
import { shiftForTime, formatElapsed } from '@shared/lib/shiftTypes'

/**
 * On-duty pulse plus the clock in/out control.
 *
 * This is what populates the admin "Security On-Duty History" table — that view
 * reads `guard_shifts`, and nothing was writing to it before. The widget used to
 * display a hardcoded "On Duty" badge that was true regardless of whether the
 * guard had actually started a shift, which made the label decorative.
 *
 * The shift query itself moved to [useDutyStatus] once the duty lock started
 * asking the same question — see that hook for why one answer matters.
 *
 * ── CLOCKING OUT ASKS FIRST, AND ASKS FROM ClockOutButton ──────────────────
 * The control and both of its dialogs moved there so the duty panel on
 * Response Metrics ends a shift exactly the way this does. What follows is
 * why it asks at all.
 *
 * Clocking IN is immediate: it starts a shift, and starting one you did not
 * mean to costs a clock-out. Clocking OUT is not symmetrical. It closes the
 * `guard_shifts` row that the admin timesheet bills from, it drops the guard
 * off the live unit list on the dispatch map, and it is the state the duty lock
 * reads to decide whether the console is usable at all. This control sits in
 * the top bar, a thumb's width from the theme toggle, and it used to fire on a
 * single press with no way back.
 */
export default function GuardStatusWidget() {
  const { openShift, busy, error, toggle } = useDutyStatus()

  const onDuty = Boolean(openShift)

  // ── THE COUNTER TICKS ───────────────────────────────────────────────────
  // `durationMinutes` is computed when the shift SNAPSHOT changes, so a quiet
  // console showed a figure frozen at whatever minute the guard clocked in —
  // the one number on screen that is supposed to prove the console is live.
  // One second, and only while a shift is open: `useNow(0)` does not start an
  // interval, so an off-duty console pays nothing for this.
  const now = useNow(onDuty ? 1000 : 0)
  const elapsedMs = onDuty && openShift?.timeIn ? now - openShift.timeIn.getTime() : 0

  return (
    <div className="flex items-center gap-2">
      {/*
        A solid status pill, not a tinted bordered box.

        `bg-pill-success` is the system's own solid pair (#ECFDF5 / #047857 in
        light, redefined in dark) rather than the `bg-success/10` translucent
        fill this carried. A 10% fill is a different colour on every surface it
        lands on, and this one lands on the top bar, which is the canvas, not a
        card — so it read a shade off from every other success tone in the app.
      */}
      <span
        className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-medium ${
          onDuty ? 'bg-pill-success text-pill-success-fg' : 'bg-pill-neutral text-pill-neutral-fg'
        }`}
        title={error || undefined}
      >
        {onDuty ? (
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
        ) : (
          <span className="h-2 w-2 rounded-full bg-text-muted" aria-hidden="true" />
        )}

        <span>{onDuty ? 'On duty' : 'Off duty'}</span>

        {/*
          The running shift, at a size someone can actually read across a
          guardhouse desk — this was `text-2xs` in a mono face. `tabular-nums`
          is what stops the figures jittering as the minutes tick; a monospace
          face was never what did that, and the stylesheet refuses one used as
          costume. The divider is a character rather than a border: at this
          size a 1px rule between two short strings reads as a rendering
          artefact.
        */}
        {openShift?.durationMinutes != null ? (
          <>
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
            <span className="font-mono tabular-nums" aria-label="Time on shift">
              {formatElapsed(elapsedMs)}
            </span>
          </>
        ) : null}
      </span>

      {onDuty ? (
        <ClockOutButton className="btn btn-sm btn-outline" />
      ) : (
        <button
          type="button"
          onClick={() => toggle({ shift: shiftForTime() })}
          disabled={busy}
          className="btn btn-sm btn-success"
        >
          {busy ? (
            <Loader2 size="sm" className="animate-spin" aria-hidden="true" />
          ) : (
            <LogIn size="sm" aria-hidden="true" />
          )}
          Clock in
        </button>
      )}

    </div>
  )
}
