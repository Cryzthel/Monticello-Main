import { toast } from '@shared/lib/toast'
import { useState } from 'react'
import { LogOut, Loader2 } from '@shared/icons'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import ShiftHandoverDialog from '@/components/ShiftHandoverDialog'
import ShiftSummary from '@/components/ShiftSummary'
import { useDutyStatus } from '@/hooks/useDutyStatus'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'

/**
 * Clocking out — the control and both of its exits, in one place.
 *
 * ── WHY THIS IS A COMPONENT AND NOT COPIED TWICE ───────────────────────────
 * Two surfaces end a shift: the status widget in the top bar, and the duty
 * panel on Response Metrics. Leaving each to own its own confirm state and its
 * own pair of dialogs is how the two drift — one of them gains a handover
 * requirement or loses the summary, and which exit an officer gets starts
 * depending on where they happened to click. The shift row this closes is what
 * the admin timesheet bills from, so there is exactly one way out of a shift.
 *
 * Only the BUTTON varies, through `className` — `btn-sm` in the top bar, full
 * width in the panel. The dialogs do not take a size.
 *
 * ── THE TWO EXITS ──────────────────────────────────────────────────────────
 * Admin › Settings decides which one an officer gets. With the handover
 * requirement off this is a single confirmation, because a log nobody asked
 * for is a toll on the way out of a shift rather than a record. Both exits
 * show the shift summary: the handover path asks officers to write about the
 * shift, and this is the figure they write from; the plain path asks nothing,
 * which is exactly why it is the path where the numbers would go unseen.
 */
export default function ClockOutButton({ className = 'btn btn-sm btn-outline', label = 'Clock out' }) {
  const { openShift, busy, error, toggle } = useDutyStatus()
  const [confirming, setConfirming] = useState(false)

  const requireHandover = useSystemSettings((state) => state.values.guardhouse.requireHandover)

  if (!openShift) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-haspopup="dialog"
        disabled={busy}
        className={className}
        title={error || undefined}
      >
        {busy ? (
          <Loader2 size="sm" className="animate-spin" aria-hidden="true" />
        ) : (
          <LogOut size="sm" aria-hidden="true" />
        )}
        {label}
      </button>

      <ShiftHandoverDialog
        open={confirming && requireHandover}
        shift={openShift}
        busy={busy}
        error={error || null}
        onCancel={() => setConfirming(false)}
        onSubmit={async (handover) => {
          // Closed only on success: a failed clock-out used to close the
          // dialog anyway and throw away the handover the guard had typed.
          if (await toggle({ handover })) setConfirming(false)
        }}
      />

      <ConfirmDialog
        open={confirming && !requireHandover}
        title="Clock out of this shift?"
        // No elapsed figure in this sentence. It is in the summary panel
        // below, live to the second — a rounded copy up here would put two
        // different numbers for one fact in one dialog.
        message="This closes your shift and removes you from the live unit list."
        confirmLabel="Clock out"
        busy={busy}
        onConfirm={async () => {
          const ok = await toggle({})
          setConfirming(false)
          // This dialog has no error slot; without the toast a failure was
          // only a tooltip on the button.
          if (!ok) toast.error('Could not clock out', { description: 'You are still on duty. Try again.' })
        }}
        onCancel={() => setConfirming(false)}
      >
        <ShiftSummary shift={openShift} open={confirming && !requireHandover} />
      </ConfirmDialog>
    </>
  )
}
