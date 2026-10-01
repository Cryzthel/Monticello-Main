import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from '@shared/icons'

/**
 * A confirm dialog that will not confirm without a written reason. Used for
 * the two presses that go on the record as exceptions: arriving without a
 * GPS match, and escalating a call.
 *
 * `presets` are one-tap reasons that fill the field, since the officer using
 * this is standing in a street, often with one hand free. The field stays
 * editable, and what is in it is what gets logged.
 */
export default function ReasonDialog({
  open,
  icon: Icon,
  tone = 'warning',
  title,
  message,
  presets = [],
  placeholder,
  confirmLabel,
  busy = false,
  minLength = 3,
  onConfirm,
  onCancel,
}) {
  const [reason, setReason] = useState('')
  const fieldRef = useRef(null)
  const fieldId = useId()
  // Through a ref: the drawer behind this re-renders every second, and an
  // effect keyed on a fresh `onCancel` would clear the field as it was typed.
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    if (!open) return undefined
    setReason('')
    fieldRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) cancelRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  const ready = reason.trim().length >= minLength
  const ring = tone === 'danger' ? 'bg-danger/15 text-danger ring-danger/30' : 'bg-warning/15 text-warning ring-warning/30'
  const confirmClass = tone === 'danger' ? 'bg-danger text-base-900 hover:bg-danger/90' : 'btn-brand'

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[calc(var(--z-modal)_+_1)] flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (ready && !busy) onConfirm(reason.trim())
        }}
        className="dialog-panel w-full max-w-md rounded-xl rounded-b-none border border-hairline bg-base-850 p-5 shadow-modal sm:rounded-b-xl"
      >
        <div className="flex items-start gap-3.5">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${ring}`}>
            <Icon size="md" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug text-text-primary">{title}</h2>
            {message ? <p className="mt-1 text-sm leading-relaxed text-text-secondary">{message}</p> : null}
          </div>
        </div>

        {presets.length ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
                aria-pressed={reason === preset}
                className={`chip ${reason === preset ? 'chip-active' : 'chip-idle'}`}
              >
                {preset}
              </button>
            ))}
          </div>
        ) : null}

        <label htmlFor={fieldId} className="mt-4 block text-xs font-semibold text-text-secondary">
          Reason (goes on the record)
        </label>
        <textarea
          id={fieldId}
          ref={fieldRef}
          rows={3}
          maxLength={280}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={placeholder}
          className="field-textarea mt-1.5 resize-none leading-relaxed"
        />

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={onCancel} className="btn btn-sm btn-outline">
            Cancel
          </button>
          <button type="submit" disabled={!ready || busy} className={`btn btn-sm ${confirmClass}`}>
            {busy ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
