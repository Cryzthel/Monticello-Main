import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CircleAlert,
  CloudUpload,
  FileText,
  FileType,
  Film,
  Images,
  ImagePlus,
  RotateCcw,
  X,
} from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import UploadProgressRing from '@shared/components/UploadProgressRing'

/**
 * THE evidence uploader — the one file picker in both portals (2026-10-29, by
 * request): File a Report, Resolve incident, Resolve SOS and the announcement
 * composer all render this, driven by `useEvidenceUploads`.
 *
 *   const uploads = useEvidenceUploads({ maxPhotos: 6, maxVideos: 3 })
 *   <EvidenceUploader uploads={uploads} heading="Photos & video" />
 *
 * It owns everything about picking (the hidden input, drag-and-drop, the
 * rejected-file line) and how a file's state reads; the hook owns the uploads
 * and what they produce. The tile design is the mobile `_MediaStep` /
 * `PhotoEvidenceDropzone` port this replaced (MediaAttachmentField): a dashed
 * dropzone, a 3-up grid of square tiles, a circular remove badge, a caption
 * strip.
 *
 * Each tile walks Idle → Preparing → Uploading → Attached (or Failed, with
 * Retry). Work in progress is a ring over a dimmed, blurred tile with the live
 * percentage in it — not a hairline bar at the foot, which was easy to miss
 * on exactly the large clips that take long enough to need it. On landing the
 * ring gives way to a check that pops and fades, once.
 *
 * Nothing changes size between states: the overlay sits over the tile, the
 * caption strip is always there, so the grid never shifts while files work.
 */

function iconFor(type = '') {
  if (type.startsWith('image/')) return Images
  if (type.startsWith('video/')) return Film
  if (type === 'application/pdf') return FileType
  return FileText
}

function captionFor(item) {
  if (item.status === 'error') return 'Failed'
  if (item.status === 'compressing') return 'Preparing'
  if (item.status === 'uploading') return (item.progress ?? 0) >= 100 ? 'Finishing' : 'Uploading'
  return 'Attached'
}

/**
 * @param {object}  props
 * @param {object}  props.uploads   The `useEvidenceUploads` result.
 * @param {string}  [props.heading]
 * @param {string}  [props.hint]    One plain line under the dropzone prompt.
 * @param {string}  [props.error]   A field-level message from the form (e.g. "add a photo").
 * @param {boolean} [props.disabled]
 * @param {string}  [props.capture] Passed to the input ("environment" opens the rear camera on phones).
 * @param {boolean} [props.autoOpen] Open the picker on mount (the composer's "Photo" quick action).
 */
export default function EvidenceUploader({
  uploads,
  heading = 'Evidence',
  hint,
  error,
  disabled = false,
  capture,
  autoOpen = false,
  inputLabel = 'Choose files to upload',
}) {
  const { items, capacity, accept, rejected, add, remove, retry } = uploads
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  // Tiles that were worked on in THIS session get the landing check; a photo
  // already attached when an announcement is opened for editing does not.
  const worked = useRef(new Set())
  items.forEach((item) => {
    if (item.status !== 'done') worked.current.add(item.id)
  })

  useEffect(() => {
    if (autoOpen) inputRef.current?.click()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, [])

  const open = () => inputRef.current?.click()
  const attached = items.length > 0
  const full = capacity != null && items.length >= capacity
  const message = error || rejected

  const dropProps = {
    onDragOver: (event) => {
      event.preventDefault()
      if (!disabled) setDragging(true)
    },
    // Moving over a child fires dragleave on the parent; only leaving the
    // zone itself ends the drag state, or the highlight flickers.
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
    },
    onDrop: (event) => {
      event.preventDefault()
      setDragging(false)
      if (!disabled) add(event.dataTransfer?.files)
    },
  }

  return (
    <div className={`rounded-xl border p-4 ${message ? 'border-danger/50' : 'border-hairline'}`}>
      <div className="flex items-center gap-2">
        <Images size="sm" className="shrink-0 text-brand-500" />
        <span className="text-small font-semibold text-text-primary">{heading}</span>
        {attached ? (
          <StatusBadge tone="success" size="sm" className="ml-auto">
            {items.length} attached
          </StatusBadge>
        ) : null}
      </div>

      <div className="mt-3.5" {...dropProps}>
        {attached ? (
          <>
            <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
              {items.map((item) => {
                const Icon = iconFor(item.type)
                const failed = item.status === 'error'
                const compressing = item.status === 'compressing'
                const busy = compressing || item.status === 'uploading'
                // Video preparation streams a real percentage; photo resizing
                // reports none, so its ring turns rather than invent one.
                const measured = !compressing || (item.progress ?? 0) > 0
                const landed = item.status === 'done' && worked.current.has(item.id)
                return (
                  <li key={item.id}>
                    <div
                      className={`relative aspect-square overflow-hidden rounded-lg bg-tint/[0.06] ${
                        failed ? 'ring-1 ring-inset ring-danger/60' : ''
                      }`}
                    >
                      {item.preview ? (
                        <>
                          <img src={item.preview} alt="" className="h-full w-full object-cover" />
                          {item.type?.startsWith('video/') ? (
                            <span className="absolute left-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-black/60 text-white">
                              <Icon size={12} aria-hidden="true" />
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <Icon size={28} className="text-text-muted" />
                        </span>
                      )}

                      {busy ? (
                        <div className="upload-overlay absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
                          <UploadProgressRing
                            value={item.progress ?? 0}
                            indeterminate={!measured}
                            tone={compressing ? 'info' : 'brand'}
                            label={`${captionFor(item)} ${item.name}`}
                          />
                        </div>
                      ) : null}

                      {failed && item.file && !disabled ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                          <button
                            type="button"
                            onClick={() => retry(item)}
                            className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-small font-semibold text-zinc-900 shadow-sm transition-transform duration-150 hover:bg-white active:scale-95"
                          >
                            <RotateCcw size={12} aria-hidden="true" />
                            Retry
                          </button>
                        </div>
                      ) : null}

                      {landed ? (
                        <span
                          aria-hidden="true"
                          className="upload-landed pointer-events-none absolute inset-0 flex items-center justify-center"
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-white shadow-md">
                            <Check size={18} strokeWidth={3} />
                          </span>
                        </span>
                      ) : null}

                      {disabled ? null : (
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          aria-label={busy ? `Cancel upload of ${item.name}` : `Remove ${item.name}`}
                          className="absolute right-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-danger text-base-900 transition-transform duration-150 hover:scale-105 active:scale-95"
                        >
                          <X size="sm" strokeWidth={3} />
                        </button>
                      )}

                      <div className="absolute inset-x-0 bottom-0 bg-black/55 py-[3px] text-center">
                        <span className="text-small font-semibold text-white/85" aria-live="polite">
                          {captionFor(item)}
                        </span>
                      </div>
                    </div>

                    <p
                      className={`mt-1 truncate text-small ${failed ? 'text-danger' : 'text-text-muted'}`}
                      title={failed ? item.error : item.name}
                    >
                      {failed ? item.error : item.name}
                    </p>
                  </li>
                )
              })}
            </ul>

            <button
              type="button"
              disabled={disabled || full}
              onClick={open}
              className={`mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-body font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                dragging
                  ? 'border-brand-500 bg-brand-100 text-brand-400'
                  : 'border-dashed border-slate-300 text-text-secondary hover:border-brand-500/60 hover:bg-brand-50 hover:text-brand-400'
              }`}
            >
              <ImagePlus size="sm" />
              {full ? `Limit reached — ${items.length} attached` : dragging ? 'Drop to attach' : 'Add more'}
            </button>
            {/* The format line stays once files are attached: "Add more" asks
                the same question the empty dropzone did. */}
            {hint && !full ? <p className="mt-1.5 text-center text-small text-text-muted">{hint}</p> : null}
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={open}
            className={`group flex h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed transition-[border-color,background-color] duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
              message
                ? 'border-danger/55 bg-danger/[0.03]'
                : dragging
                  ? 'border-solid border-brand-500 bg-brand-50'
                  : 'border-slate-300 bg-tint/[0.015] hover:border-brand-500/60 hover:bg-brand-50'
            }`}
          >
            <CloudUpload
              size={36}
              className={`transition-[transform,color] duration-200 ease-[var(--ease-out-strong)] ${
                dragging
                  ? '-translate-y-1 scale-110 text-brand-400'
                  : 'text-text-muted group-hover:-translate-y-0.5 group-hover:text-brand-500'
              }`}
            />
            <span className="mt-2.5 text-body font-medium text-text-primary">
              {dragging ? 'Drop to attach' : 'Click or drag files here'}
            </span>
            {hint ? <span className="mt-1 px-3 text-center text-small text-text-muted">{hint}</span> : null}
          </button>
        )}
      </div>

      {message ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-small font-semibold leading-snug text-danger">
          <CircleAlert size="sm" className="mt-px shrink-0" />
          {message}
        </p>
      ) : null}

      {/* sr-only, NOT hidden: a display:none input is not reliably clickable
          via .click() across browsers (Safari) and drops out of the a11y tree. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        capture={capture}
        tabIndex={-1}
        className="sr-only"
        aria-label={inputLabel}
        onChange={(event) => {
          add(event.target.files)
          event.target.value = '' // re-picking the same file must re-fire
        }}
      />
    </div>
  )
}
