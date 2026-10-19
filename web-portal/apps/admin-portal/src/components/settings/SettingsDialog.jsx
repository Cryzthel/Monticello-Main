import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@shared/icons'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'

/**
 * The modal both account actions on Settings open — Change email and Change
 * password (2026-10-19, by request: modals, not inline dropdowns).
 *
 *   <SettingsDialog open icon={Mail} title="Change email address"
 *     description="…" busy={busy} onClose={close} initialRef={firstField}
 *     footer={<>buttons</>}>fields</SettingsDialog>
 *
 *   ┌ [icon] Title                                   ✕ ┐
 *   │        One line on what happens next             │
 *   ├──────────────────────────────────────────────────┤
 *   │  fields                                          │
 *   ├──────────────────────────────────────────────────┤
 *   │                          (Cancel) (Primary)      │
 *   └──────────────────────────────────────────────────┘
 *
 * Glass on the console's own tokens rather than raw zinc: base-950 at 95%
 * over a 24px backdrop blur, a hairline border, rounded-2xl — the brief's
 * `bg-zinc-950 border-zinc-800/80 backdrop-blur-xl`, but following the theme
 * switch instead of being dark in light mode too.
 *
 * ── BEHAVIOUR ──────────────────────────────────────────────────────────────
 * Focus moves in (to `initialRef`), is trapped, and returns to the opener on
 * close (useDialogFocus). Escape, the backdrop and ✕ all close — except while
 * `busy`, so a credential write cannot outlive the dialog that started it.
 * Enter submits: the body is a <form> and the primary button is its submit.
 * Entrance is the shared `dialog-scrim` / `dialog-panel` motion (fade + 8px
 * rise, reduced-motion off); there is no exit animation, on purpose — a
 * dismissed dialog should get out of the way at once.
 */
/**
 * The sign-in page's two buttons, sized for a dialog footer: the CTA capsule
 * and the outlined secondary (shared/auth/authStyles), side by side at equal
 * width. Exported so both account dialogs use the same pair.
 */
export const DIALOG_PRIMARY =
  'btn h-11 flex-1 rounded-full bg-brand-cta px-5 text-sm font-semibold text-brand-cta-fg shadow-sm transition-all hover:bg-brand-cta-hover disabled:opacity-60'
export const DIALOG_SECONDARY =
  'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-hairline bg-transparent px-5 text-sm font-semibold text-text-secondary transition-[background-color,border-color,color] duration-150 ease-out hover:border-brand-500/30 hover:bg-tint/5 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50'

export default function SettingsDialog({
  open,
  icon: Icon,
  title,
  description,
  busy = false,
  onClose,
  onSubmit,
  initialRef,
  footer,
  children,
}) {
  const panelRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef, initialRef })

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const titleId = `${title.replace(/\W+/g, '-').toLowerCase()}-title`

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => !busy && onClose?.()}
      role="presentation"
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy) onSubmit?.()
        }}
        onClick={(event) => event.stopPropagation()}
        className="dialog-panel relative flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-950 shadow-2xl shadow-black/60 sm:rounded-2xl"
      >
        <header className="relative shrink-0 border-b border-hairline px-6 py-5 pr-14">
          <div className="flex min-w-0 items-start gap-4">
            {Icon ? (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-500">
                <Icon size={20} aria-hidden="true" />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-xl font-extrabold leading-tight tracking-[-0.025em] text-text-primary">
                {title}
              </h2>
              {description ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{description}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          <div className="flex flex-col gap-5">{children}</div>
        </div>

        {footer ? (
          <footer className="flex shrink-0 items-center gap-3 border-t border-hairline px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </form>
    </div>,
    document.body,
  )
}
