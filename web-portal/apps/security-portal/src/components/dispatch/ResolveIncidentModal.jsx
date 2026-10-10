import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Loader2, TriangleAlert, X } from '@shared/icons'
import {
  RESOLUTION_NOTES_MAX,
  RESOLUTION_NOTES_MIN,
  INVESTIGATION_TAGS,
  RESOLUTION_OUTCOMES,
  RESOLUTION_PHOTOS_MAX,
} from '@shared/lib/dispatchStage'
import { incidentReference } from '@/lib/dispatch'
import { usePhotoUploads } from '@/components/dispatch/usePhotoUploads'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import MediaAttachmentField from '@shared/components/MediaAttachmentField'

/**
 * Resolve Incident: the three things the rules will not close a call without.
 *
 *   Outcome category       one of RESOLUTION_OUTCOMES
 *   What was done          none or more of INVESTIGATION_TAGS
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
  /**
   * ── THE QUICK TAGS MOVED HERE FROM THE INVESTIGATION PANEL ─────────────
   * They were toggled live on the open call, each press its own logged
   * write, while an officer was still at the scene. That made them a
   * running commentary — and a half-finished one, because the set an
   * officer happened to have tapped before they got busy was the set that
   * stayed on the record.
   *
   * As part of the resolution they are a statement made once, deliberately,
   * alongside the outcome and the notes they belong with: what was actually
   * done about it. They ride in the `resolution` map for the same reason —
   * one object, written in one batch, that reads back as the account of how
   * this call ended rather than as scattered fields.
   *
   * OPTIONAL, unlike the outcome and the notes. A call can genuinely end
   * with none of these applying, and a required field that sometimes has no
   * true answer is how you train people to tick the nearest box.
   */
  const [tags, setTags] = useState([])
  const [dragging, setDragging] = useState(false)
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
    setTags([])
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
  /**
   * Two vocabularies, bridged here rather than in either of them.
   *
   * `usePhotoUploads` tracks an upload as "has a url yet, has an error yet".
   * `MediaAttachmentField` renders a status string. Translating at the call
   * site keeps the hook free of presentation and the field free of this
   * screen's upload mechanics.
   */
  const tiles = photos.items.map((item) => ({
    id: item.id,
    name: item.name,
    type: 'image',
    src: item.previewUrl,
    status: item.error ? 'error' : item.url ? 'done' : 'uploading',
    progress: item.progress,
    error: item.error,
  }))

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
    onSubmit({ outcome, notes: trimmed, photoUrls: photos.urls, tags })
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

          {/* ── WHAT WAS DONE ──────────────────────────────────────────────
              The outcome above says how the call ENDED — resolved on site,
              referred, false alarm. These say what was done about it, and
              the two are genuinely different axes: a call can be "resolved
              on site" with the area secured and police requested, or with
              neither.

              Multi-select and optional, where the outcome is single and
              required. A call can end with none of these applying, and a
              required field that sometimes has no true answer is how you
              train people to tick the nearest box. */}
          <fieldset>
            <legend className="text-xs font-semibold text-text-secondary">
              What was done <span className="font-normal text-text-muted">· optional</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {INVESTIGATION_TAGS.map((option) => {
                const on = tags.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setTags((current) =>
                        on ? current.filter((t) => t !== option.value) : [...current, option.value],
                      )
                    }
                    className={`chip ${on ? 'chip-active' : 'chip-idle'}`}
                  >
                    {option.label}
                  </button>
                )
              })}
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
            {/* THE SAME FIELD THE ANNOUNCEMENT COMPOSER USES.
                This was a bespoke grid of square tiles with a small "Add
                photo" cell wedged in among them — a different upload affordance
                from the one the rest of the product teaches, and the only one
                with no drop target, on the surface most likely to be used from
                a laptop at the gate.

                `MediaAttachmentField` is the shared component behind the
                announcement composer and the report attacher. Adopting it is
                what the brief is really asking for: not a dropzone styled to
                LOOK like that one, which is how two things drift apart, but
                that one. Drag-and-drop, the progress bar, the failed-upload
                state and the per-item remove all come with it.

                The capacity counter and the heading move inside it too, which
                is why the header row above is gone rather than kept. */}
            <MediaAttachmentField
              items={tiles}
              capacity={RESOLUTION_PHOTOS_MAX}
              heading="Photo evidence"
              hint="PNG or JPG. Compressed on this device before upload, so uploading needs a connection."
              disabled={busy}
              onPick={() => fileRef.current?.click()}
              onRemove={photos.remove}
              dragging={dragging}
              onDragOver={(event) => {
                event.preventDefault()
                if (!busy) setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                if (!busy) photos.add(event.dataTransfer?.files)
              }}
            />
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
