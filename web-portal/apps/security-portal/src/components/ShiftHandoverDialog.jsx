import { useEffect, useRef, useState } from 'react'
import ShiftSummary from '@/components/ShiftSummary'
import { ClipboardList, Loader2, LogOut, X } from '@shared/icons'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'

const MAX = 1000

/**
 * The duty log an officer files as they clock out.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * The admin shift record already shows what an officer DID — `shiftActivity`
 * derives the dispatches and resolutions straight from the incident documents,
 * so nobody has to write those down. What derivation cannot produce is
 * everything that did not become a ticket: the gate motor that is sticking,
 * the contractor expected at six, the car that has been parked on the corner
 * for three days. That is what a handover is, and it is the half of a shift
 * that otherwise leaves with the officer.
 *
 * ── REQUIRED, AND ONLY WHEN IT IS ───────────────────────────────────────────
 * This form appears only when Admin › Settings has "Shift handover required"
 * switched on. With it off, clocking out stays a single confirmation, because
 * a log nobody reads is a toll on the way out of a shift rather than a record.
 *
 * ── ONE WRITE ───────────────────────────────────────────────────────────────
 * Filing and clocking out are the same write (see `clockOut`). The rules only
 * accept a change while `timeOut` is still null, so this is also the last
 * moment the officer can write to their own shift — there is no second chance
 * to attach a log to a shift that is already closed, by design.
 */
export default function ShiftHandoverDialog({ open, shift, busy, error, onSubmit, onCancel }) {
  const [summary, setSummary] = useState('')
  const [outstanding, setOutstanding] = useState('')
  const [touched, setTouched] = useState(false)

  const panelRef = useRef(null)
  const firstFieldRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef, initialRef: firstFieldRef })

  // A fresh log each time the dialog opens: a draft left over from a cancelled
  // clock-out belongs to a shift that is still running, not to this one.
  useEffect(() => {
    if (!open) return
    setSummary('')
    setOutstanding('')
    setTouched(false)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onCancel])

  if (!open) return null

  const ready = summary.trim().length > 0

  function submit(event) {
    event.preventDefault()
    setTouched(true)
    if (!ready || busy) return
    onSubmit({ summary: summary.trim(), outstanding: outstanding.trim() })
  }

  return (
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim p-4 sm:items-center"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handover-title"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="card dialog-panel flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-b-none bg-base-900 sm:rounded-b-xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-6 py-3.5">
          <ClipboardList size="sm" aria-hidden="true" className="shrink-0 text-brand-500" />
          <h2 id="handover-title" className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">
            Duty log
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close without clocking out"
            className="icon-btn icon-btn-sm shrink-0 border border-slate-200"
          >
            <X size="sm" aria-hidden="true" />
          </button>
        </header>

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pb-8">
          {/* The figures first, the prose second. An officer asked what
              happened on shift answers better from a number they can check
              than from memory — and the sentence under it now says what the
              box is FOR, rather than reassuring them about a record they
              cannot see. */}
          <ShiftSummary shift={shift} open={open} />

          <p className="text-xs leading-relaxed text-text-secondary">
            Those are recorded automatically. This is for what they do not cover — a
            handover is read by the officer relieving you.
          </p>

          <div>
            <label htmlFor="handover-summary" className="text-xs font-medium text-text-secondary">
              What happened on shift <span className="text-danger">*</span>
            </label>
            <textarea
              id="handover-summary"
              ref={firstFieldRef}
              rows={4}
              maxLength={MAX}
              value={summary}
              disabled={busy}
              onChange={(event) => setSummary(event.target.value)}
              aria-describedby="handover-summary-hint"
              aria-invalid={touched && !ready ? 'true' : undefined}
              placeholder="Quiet shift. Two gate checks, nothing to report."
              className="field-textarea mt-1.5 resize-none leading-relaxed"
            />
            <p id="handover-summary-hint" className="mt-1 flex items-center justify-between gap-3 text-2xs">
              <span className={touched && !ready ? 'text-danger' : 'text-text-muted'}>
                {touched && !ready ? 'Required before you can clock out.' : 'Required.'}
              </span>
              <span className="tabular-nums text-text-muted">
                {summary.length}/{MAX}
              </span>
            </p>
          </div>

          <div>
            <label htmlFor="handover-outstanding" className="text-xs font-medium text-text-secondary">
              For the next officer
            </label>
            <textarea
              id="handover-outstanding"
              rows={3}
              maxLength={MAX}
              value={outstanding}
              disabled={busy}
              onChange={(event) => setOutstanding(event.target.value)}
              placeholder="Gate motor sticking. Contractor expected at Block 7 around 06:00."
              className="field-textarea mt-1.5 resize-none leading-relaxed"
            />
            <p className="mt-1 text-right text-2xs tabular-nums text-text-muted">
              {outstanding.length}/{MAX}
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-xs leading-snug text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-6 py-3">
          <p className="hidden min-w-0 flex-1 truncate text-2xs text-text-muted sm:block">
            Filing this closes your shift.
          </p>
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-sm btn-outline">
            Cancel
          </button>
          <button type="submit" disabled={busy || (touched && !ready)} className="btn btn-sm btn-brand">
            {busy ? (
              <Loader2 size="sm" aria-hidden="true" className="animate-spin" />
            ) : (
              <LogOut size="sm" aria-hidden="true" />
            )}
            File and clock out
          </button>
        </div>
      </form>
    </div>
  )
}
