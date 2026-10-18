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
import Select from '@shared/components/Select'

/**
 * Resolve Incident: the three things the rules will not close a call without.
 *
 *   Outcome category       one of RESOLUTION_OUTCOMES
 *   What was done          none or more of INVESTIGATION_TAGS
 *   Notes                  10–1000 characters
 *   Photos                 1–6 photos of the scene as it was left
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
        <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-6 py-3.5">
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

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
          {/* ── CLOSING A CALL NOBODY ARRIVED AT ──────────────────────────
              Arrival is stamped automatically when the officer's own
              position reaches the pin, so an absent `onSceneAt` means the
              console never saw them get there — they resolved from the road,
              or their GPS never came good.

              It does NOT block the resolve. An officer standing at a scene
              with a bad fix must still be able to close the call, and a
              console that refuses would be choosing a tidy record over a
              finished job. But the record should not imply an arrival that
              was never observed, so it says so here, where the person
              writing the record can see it. */}
          {report && !report.onSceneAt ? (
            <p className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3 text-caption leading-snug text-warning">
              <TriangleAlert size="sm" aria-hidden="true" className="mt-px shrink-0" />
              <span>
                No arrival was recorded for this call — your position never reached the pin. You can
                still resolve it; the record will show that nobody was logged on scene.
              </span>
            </p>
          ) : null}
          {/* ── SIX OPTIONS, NOT SIX BUTTONS ──────────────────────────────
              Both of these were wrapped chip rows. Six chips wrap to three
              lines in a 480px modal, and two stacked wrapped rows read as a
              wall of similar pills where the only thing distinguishing the
              two questions is a small legend above each — so an officer
              closing a call under pressure picks from the wrong row.

              A closed dropdown is one line that states the current answer.
              The options are a list when you want them and absent when you
              do not, which is the right shape for a question asked once at
              the end of a call. */}
          <div>
            <p className="text-xs font-semibold text-text-secondary">What happened?</p>
            <Select
              className="mt-2 w-full"
              size="touch"
              variant="field"
              ariaLabel="What happened?"
              placeholder="Pick what happened"
              options={RESOLUTION_OUTCOMES}
              value={outcome}
              onChange={setOutcome}
            />
          </div>

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
          <div>
            <p className="text-xs font-semibold text-text-secondary">
              What was done? <span className="font-normal text-text-muted">· optional</span>
            </p>
            {/* MULTI-select, where the outcome is single. A call can end with
                the area secured AND police requested; collapsing that to one
                choice would have made the field cheaper to render and a worse
                record. The menu stays open between picks for the same reason. */}
            <Select
              className="mt-2 w-full"
              size="touch"
              variant="field"
              multiple
              ariaLabel="What was done?"
              placeholder="Nothing recorded"
              options={INVESTIGATION_TAGS}
              value={tags}
              onChange={setTags}
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={notesId} className="text-xs font-semibold text-text-secondary">
                Notes
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
              heading="Photos"
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

        <footer className="flex shrink-0 flex-col gap-2 border-t border-hairline px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
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
              Submit & complete
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
