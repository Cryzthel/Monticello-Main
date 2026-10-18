import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Trash2, RotateCcw, Loader2 } from '@shared/icons'

const TONES = {
  danger: {
    icon: Trash2,
    ring: 'bg-danger/15 text-danger ring-danger/30',
    confirm: 'bg-danger text-base-900 hover:bg-danger/90',
  },
  warning: {
    icon: AlertTriangle,
    ring: 'bg-warning/15 text-warning ring-warning/30',
    confirm: 'bg-warning text-base-900 hover:bg-warning/90',
  },
  success: {
    icon: RotateCcw,
    ring: 'bg-success/15 text-success ring-success/30',
    confirm: 'bg-success text-base-900 hover:bg-success/90',
  },
}

/**
 * Confirmation modal for destructive or state-changing actions.
 *
 * Portalled into document.body for the same reason the dropdowns are: the
 * drawers and modals are themselves `position: fixed`, which makes them the
 * containing block for any fixed descendant, whatever its z-index. (This cited
 * backdrop-blur until the glassmorphism pass removed it; the fixed ancestors
 * remain, so the portal is still load-bearing.)
 *
 * Focus moves to Cancel on open, not Confirm. The safe option should be the one
 * an <kbd>Enter</kbd> press lands on — defaulting focus to a destructive button
 * turns a stray keystroke into data loss.
 *
 * Below `sm:` it docks to the bottom edge as a sheet. Two reasons, both about
 * the thumb: a centred card puts its buttons in the middle of a tall phone,
 * which is the hardest part of the screen to reach one-handed, and a full-width
 * pair of 44px buttons at the bottom is the shape every native confirm on the
 * platform already has. `flex-col-reverse` keeps Cancel nearest the thumb while
 * leaving it first in the DOM, so it is still what focus and Tab land on.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
  /**
   * Optional content under the message — a summary panel, a short list, the
   * figures the decision is actually being made on.
   *
   * Additive and unused by every existing caller, which is the point: a
   * confirmation whose whole job is "are you sure" should not have to become a
   * bespoke dialog the moment it needs to show one number.
   */
  children,
  /**
   * The centred layout, for decisions about the SESSION rather than about a
   * record — signing out, clocking out first. Icon on top, title and message
   * centred, two equal capsule buttons. The default left-aligned layout stays
   * for record actions (delete, archive), where the message is often long and
   * a summary sits under it, and centred paragraphs would read badly.
   */
  centered = false,
  /** Replaces the tone's icon, e.g. a door for sign-out instead of a warning. */
  icon = null,
  /** One-button dialogs ("you can't do that yet — here is why"). */
  hideCancel = false,
}) {
  const cancelRef = useRef(null)
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    ;(cancelRef.current ?? confirmRef.current)?.focus()

    function handleKeydown(event) {
      if (event.key === 'Escape' && !busy) onCancel?.()
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [open, busy, onCancel])

  if (!open) return null

  const { icon: ToneIcon, ring, confirm } = TONES[tone] ?? TONES.danger
  const Icon = icon ?? ToneIcon

  const cancelButton = hideCancel ? null : (
    <button
      ref={cancelRef}
      type="button"
      disabled={busy}
      onClick={onCancel}
      className={
        centered
          ? 'btn btn-outline h-11 flex-1 rounded-full px-4 text-sm'
          : 'btn btn-outline h-11 w-full px-4 text-xs sm:h-9 sm:w-auto'
      }
    >
      {cancelLabel}
    </button>
  )
  const confirmButton = (
    <button
      ref={confirmRef}
      type="button"
      disabled={busy}
      onClick={onConfirm}
      className={
        centered
          ? `btn h-11 flex-1 rounded-full px-4 text-sm font-semibold ${confirm}`
          : `btn h-11 w-full px-4 text-xs sm:h-9 sm:w-auto ${confirm}`
      }
    >
      {busy ? <Loader2 size="sm" className="animate-spin" /> : null}
      {confirmLabel}
    </button>
  )

  if (centered) {
    return createPortal(
      <div
        className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim sm:items-center sm:p-4"
        onClick={() => !busy && onCancel?.()}
        role="presentation"
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
          onClick={(event) => event.stopPropagation()}
          className="dialog-panel w-full max-w-sm rounded-2xl rounded-b-none border border-hairline bg-base-850 px-6 pb-6 pt-7 text-center shadow-modal sm:rounded-b-2xl"
        >
          <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ring-1 ring-inset ${ring}`}>
            <Icon size="md" />
          </span>
          <h2 className="mt-4 text-lg font-semibold leading-snug tracking-[-0.01em] text-text-primary">{title}</h2>
          {message ? (
            <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-text-secondary">{message}</p>
          ) : null}
          {children ? <div className="mt-4 text-left">{children}</div> : null}
          {/* Cancel first in the DOM, so focus and Tab land on the safe choice;
              equal widths so neither reads as the afterthought. */}
          <div className="mt-6 flex gap-2.5">
            {cancelButton}
            {confirmButton}
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={() => !busy && onCancel?.()}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="dialog-panel w-full max-w-md rounded-xl rounded-b-none border border-hairline bg-base-850 p-5 pb-6 shadow-modal sm:rounded-b-xl sm:p-6"
      >
        <div className="flex items-start gap-4">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${ring}`}
          >
            <Icon size="md" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug text-text-primary">{title}</h2>
            {message ? (
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{message}</p>
            ) : null}
            {children ? <div className="mt-4">{children}</div> : null}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          {cancelButton}
          {confirmButton}
        </div>
      </div>
    </div>,
    document.body,
  )
}
