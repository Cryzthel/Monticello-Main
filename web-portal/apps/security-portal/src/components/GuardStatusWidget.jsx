import { useState } from 'react'
import { LogIn, LogOut, Loader2 } from 'lucide-react'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import ShiftHandoverDialog from '@/components/ShiftHandoverDialog'
import { useDutyStatus } from '@/hooks/useDutyStatus'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import { formatMinutes } from '@shared/lib/incidents'

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
 * ── CLOCKING OUT ASKS FIRST ─────────────────────────────────────────────────
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
  const [confirmingOut, setConfirmingOut] = useState(false)

  const onDuty = Boolean(openShift)

  // Admin › Settings decides which of the two exits an officer gets. With the
  // requirement off this stays a single confirmation, because a log nobody
  // asked for is a toll on the way out of a shift rather than a record.
  const requireHandover = useSystemSettings((state) => state.values.guardhouse.requireHandover)

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
            <span className="tabular-nums" aria-label="Time on shift">
              {formatMinutes(openShift.durationMinutes)}
            </span>
          </>
        ) : null}
      </span>

      <button
        type="button"
        onClick={() => (onDuty ? setConfirmingOut(true) : toggle())}
        aria-haspopup={onDuty ? 'dialog' : undefined}
        disabled={busy}
        className={`btn btn-sm ${onDuty ? 'btn-outline' : 'btn-success'}`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : onDuty ? (
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {onDuty ? 'Clock out' : 'Clock in'}
      </button>

      <ShiftHandoverDialog
        open={confirmingOut && requireHandover}
        shift={openShift}
        busy={busy}
        error={error || null}
        onCancel={() => setConfirmingOut(false)}
        onSubmit={async (handover) => {
          await toggle(handover)
          setConfirmingOut(false)
        }}
      />

      <ConfirmDialog
        open={confirmingOut && !requireHandover}
        title="Clock out of this shift?"
        // The elapsed time is repeated here on purpose: it is the figure the
        // timesheet keeps, and the moment to check it is before the row closes.
        message={
          openShift?.durationMinutes != null
            ? `This closes your shift after ${formatMinutes(openShift.durationMinutes)} and removes you from the live unit list.`
            : 'This closes your shift and removes you from the live unit list.'
        }
        confirmLabel="Clock out"
        busy={busy}
        onConfirm={() => {
          toggle()
          setConfirmingOut(false)
        }}
        onCancel={() => setConfirmingOut(false)}
      />
    </div>
  )
}
