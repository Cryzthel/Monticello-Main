import { CheckCircle2, Info, ShieldAlert, X } from '@shared/icons'

/**
 * The receipt for the last action taken in an incident panel's pinned footer.
 *
 * It rises out of the footer's top edge rather than pushing the buttons down,
 * so the control that was pressed does not move under the thumb that pressed
 * it. `bottom-full` on a `relative` footer is what puts it there.
 *
 * Shared, because both consoles now commit writes from a rail footer and a
 * press that has no visible outcome is the same defect in either. The
 * Guardhouse's receipts come from `useStageAction`; the Admin console's from
 * `useAdminAction` in its inspection rail. Both hand over the same
 * `{ tone, text }`.
 */
const TONES = {
  success: { shell: 'border-success/30 bg-success/10 text-success', Icon: CheckCircle2 },
  warning: { shell: 'border-warning/30 bg-warning/10 text-warning', Icon: ShieldAlert },
  danger: { shell: 'border-danger/30 bg-danger/10 text-danger', Icon: ShieldAlert },
  // Neutral news, e.g. a save the server is slow to confirm (useStageAction).
  info: { shell: 'border-info/30 bg-info/10 text-info', Icon: Info },
}

export default function Receipt({ feedback, onDismiss }) {
  const { shell, Icon } = TONES[feedback.tone] ?? TONES.warning
  return (
    <div
      role="status"
      className={`absolute inset-x-3 bottom-full z-10 mb-2 flex items-start gap-2.5 rounded-xl border p-3 shadow-overlay animate-[riseIn_180ms_var(--ease-spring)] ${shell}`}
    >
      <Icon size="sm" className="mt-px shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs font-medium leading-snug">{feedback.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 opacity-70 transition-[opacity,background-color] duration-150 hover:bg-tint/10 hover:opacity-100"
      >
        <X size="sm" />
      </button>
    </div>
  )
}
