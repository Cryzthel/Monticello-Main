import { LogIn, Loader2, ShieldAlert } from 'lucide-react'
import { useDutyStatus } from '@/hooks/useDutyStatus'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useRef } from 'react'

/**
 * Blocks the guardhouse console until the signed-in guard has clocked in.
 *
 * ── WHY A LOCK AND NOT A NUDGE ─────────────────────────────────────────────
 * Every action on this console writes the acting guard into a record an admin
 * later audits: acknowledging an SOS, dispatching a ticket, resolving one,
 * logging responder notes. `guard_shifts` is what says who was actually on
 * duty when those happened — and until now the two were unrelated. A guard
 * could work an entire shift without clocking in, and the audit trail would
 * show the actions with no shift to attribute them to.
 *
 * A banner asking them to clock in would not have fixed that, because the
 * actions stay available beside it. The lock is the point: the console has one
 * control while off duty, and it is the one that makes the rest of them
 * accountable.
 *
 * ── WHAT IT DOES NOT BLOCK ─────────────────────────────────────────────────
 * Reading. The shell still renders underneath and the overlay is dismissible
 * only by clocking in, but nothing here logs out, hides the map, or prevents
 * a guard seeing an SOS arrive — a locked console that hid an emergency would
 * be a worse failure than an unattributed acknowledgement.
 */
export default function DutyLockOverlay() {
  const { onDuty, loading, busy, error, toggle } = useDutyStatus()

  // While the lock is up it IS the page: a guard who has not clocked in
  // must not be able to tab to the console behind it.
  const panelRef = useRef(null)
  useDialogFocus({ open: !loading && !onDuty, containerRef: panelRef })

  // Nothing is known yet. Showing the lock here would flash it at a guard who
  // IS clocked in, on every navigation.
  if (loading || onDuty) return null

  // No `backdrop-blur-sm` on the scrim below. It was the last blur left in
  // either portal, and a frosted scrim is glassmorphic vocabulary that neither
  // the flat corporate system nor the pass before it has any use for.
  // --color-scrim is an opaque-enough near-black to carry the modal separation
  // on its own.
  return (
    <div
      ref={panelRef}
      className="dialog-scrim absolute inset-0 z-40 flex items-center justify-center bg-scrim p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duty-lock-title"
    >
      <div className="card dialog-panel w-full max-w-sm bg-base-900 p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-warning/15">
          <ShieldAlert className="h-6 w-6 text-warning" />
        </span>

        <h2 id="duty-lock-title" className="mt-4 text-base font-semibold text-text-primary">
          You are off duty
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Clock in to acknowledge alerts, dispatch tickets and log responder
          notes. Every action you take is recorded against your shift, so the
          shift has to be open first.
        </p>

        {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}

        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="btn btn-success mt-5 h-11 w-full"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {busy ? 'Clocking in…' : 'Clock in to continue'}
        </button>
      </div>
    </div>
  )
}
