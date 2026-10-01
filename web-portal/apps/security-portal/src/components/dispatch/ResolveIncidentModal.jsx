import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, CheckCircle2, Loader2, TriangleAlert, X } from '@shared/icons'
import {
  RESOLUTION_NOTES_MAX,
  RESOLUTION_NOTES_MIN,
  RESOLUTION_OUTCOMES,
  RESOLUTION_PHOTOS_MAX,
} from '@shared/lib/dispatchStage'
import { incidentReference } from '@/lib/dispatch'
import { usePhotoUploads } from '@/components/dispatch/usePhotoUploads'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'

/**
 * Resolve Incident: the three things the rules will not close a call without.
 *
 *   Outcome category       one of RESOLUTION_OUTCOMES
 *   Brief resolution notes 10–1000 characters
 *   Photo evidence         1–6 photos of the scene as it was left
 *
 * The submit button stays disabled until all three are present and every
 * photo has finished uploading. The rules check the same three on the server,
 * so a closed call in Firestore always has them.
 *
 * `onSubmit({ outcome, notes, photoUrls })` must resolve true once the write
 * has landed. The modal closes only then. On false it stays open, with
 * everything the officer entered intact, and the drawer's receipt says why.
 */
export default function ResolveIncidentModal({ open, report, busy, onSubmit, onCancel }) {
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const photos = usePhotoUploads({ max: RESOLUTION_PHOTOS_MAX })
  const fileRef = useRef(null)
  const notesId = useId()
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  const busyRef = useRef(busy)
  busyRef.current = busy
  const { reset } = photos

  useEffect(() => {
    if (!open) return undefined
    setOutcome('')
    setNotes('')
    setTouched(false)
    reset()
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) cancelRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, reset])

  const panelRef = useRef(null)
  useDialogFocus({ open: open && Boolean(report), containerRef: panelRef })

  if (!open || !report) return null

  const trimmed = notes.trim()
  const notesOk = trimmed.length >= RESOLUTION_NOTES_MIN && trimmed.length <= RESOLUTION_NOTES_MAX
  const photosOk = photos.urls.length >= 1 && !photos.uploading && !photos.failed
  const ready = Boolean(outcome) && notesOk && photosOk

  const missing = [
    !outcome && 'an outcome',
    !notesOk && `notes of at least ${RESOLUTION_NOTES_MIN} characters`,
    photos.urls.length < 1 && 'at least one photo',
  ].filter(Boolean)

  const submit = (event) => {
    event.preventDefault()
    setTouched(true)
    if (!ready || busy) return
    onSubmit({ outcome, notes: trimmed, photoUrls: photos.urls })
  }

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[calc(var(--z-modal)_+_1)] flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resolve-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        className="card dialog-panel flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-b-none bg-base-900 shadow-modal sm:rounded-b-xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-5 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success ring-1 ring-inset ring-success/30">
            <CheckCircle2 size="md" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="resolve-title" className="text-base font-semibold text-text-primary">
              Resolve incident
            </h2>
            <p className="font-mono text-caption text-text-muted">{incidentReference(report.id)}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="icon-btn icon-btn-sm -mr-1.5"
          >
            <X size="sm" />
          </button>
        </header>

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <fieldset>
            <legend className="text-xs font-semibold text-text-secondary">Outcome category</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RESOLUTION_OUTCOMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={outcome === option.value}
                  onClick={() => setOutcome(option.value)}
                  className={`chip ${outcome === option.value ? 'chip-active' : 'chip-idle'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={notesId} className="text-xs font-semibold text-text-secondary">
                Brief resolution notes
              </label>
              <span
                className={`font-mono text-2xs tabular-nums ${
                  trimmed.length > RESOLUTION_NOTES_MAX ? 'text-danger' : 'text-text-muted'
                }`}
              >
                {trimmed.length}/{RESOLUTION_NOTES_MAX}
              </span>
            </div>
            <textarea
              id={notesId}
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-invalid={touched && !notesOk}
              placeholder="What was found, what was done, and the state it was left in."
              className="field-textarea mt-1.5 resize-none leading-relaxed"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-semibold text-text-secondary">Photo evidence</p>
              <span className="font-mono text-2xs tabular-nums text-text-muted">
                {photos.items.length}/{RESOLUTION_PHOTOS_MAX}
              </span>
            </div>
            <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.items.map((item) => (
                <li key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200">
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                  {!item.url && !item.error ? (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                      <span className="block h-full bg-brand-500" style={{ width: `${item.progress}%` }} />
                    </span>
                  ) : null}
                  {item.error ? (
                    <span
                      className="absolute inset-0 flex items-center justify-center bg-black/60 p-1 text-center text-2xs font-semibold text-white"
                      title={item.error}
                    >
                      Upload failed
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => photos.remove(item.id)}
                    aria-label={`Remove ${item.name}`}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <X size="sm" />
                  </button>
                </li>
              ))}
              {!photos.full ? (
                <li>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 text-text-secondary transition-colors hover:border-brand-500 hover:text-text-primary"
                  >
                    <Camera size="md" aria-hidden="true" />
                    <span className="text-2xs font-semibold">Add photo</span>
                  </button>
                </li>
              ) : null}
            </ul>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                photos.add(event.target.files)
                event.target.value = ''
              }}
            />
            <p className="mt-1.5 text-caption text-text-muted">
              Compressed on this device before upload. Uploading needs a connection.
            </p>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-hairline px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-center gap-1.5 text-caption text-text-muted" aria-live="polite">
            {touched && missing.length ? (
              <>
                <TriangleAlert size="sm" className="shrink-0 text-warning" aria-hidden="true" />
                <span>Still needs {missing.join(', ')}.</span>
              </>
            ) : photos.uploading ? (
              'Uploading photos…'
            ) : (
              'The resident is asked to rate the response.'
            )}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onCancel} disabled={busy} className="btn btn-sm btn-outline flex-1 sm:flex-none">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || (touched && !ready) || photos.uploading}
              className="btn btn-sm btn-brand flex-1 sm:flex-none"
            >
              {busy ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size="sm" aria-hidden="true" />}
              Resolve incident
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
