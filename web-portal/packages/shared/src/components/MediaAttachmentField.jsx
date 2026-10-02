// The mobile widget and the portals now draw these from the SAME family —
// Phosphor — so this pairing is finally between two spellings of one icon
// rather than between two icon sets: cloudArrowUp→CloudUpload,
// imagesSquare→Images, cameraPlus→ImagePlus, warningCircle→CircleAlert.
// The names still differ because shared/icons keeps the codebase's own
// vocabulary; the drawings underneath are the same.
import {
  CircleAlert,
  CloudUpload,
  FileText,
  FileType,
  Film,
  Images,
  ImagePlus,
  X,
} from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'

/**
 * The media picker, shared by the Admin announcement composer and the
 * Guardhouse report composer.
 *
 * SOURCE OF TRUTH: `_MediaStep` in
 * lib/features/incidents/screens/report_incident_screen.dart, and the
 * `PhotoEvidenceDropzone` it falls back to in
 * lib/features/media/widgets/photo_evidence_dropzone.dart. Every measurement
 * here is that widget's, not a fresh design:
 *
 *   empty dropzone   dashed stroke, cloud-arrow-up glyph, "Click to upload" over
 *                    a muted sub-line; stroke turns danger on error. The web
 *                    runs it at 144px with a 36px glyph — desktop density, not
 *                    the phone's 168px / 52px thumb-scale target.
 *   section header   glyph + heading + a right-aligned success pill counting
 *                    what is attached
 *   thumbnail        1:1 in a 3-up grid, rounded, with a 22px CIRCULAR danger
 *                    badge inset 4px from the top-right carrying a white ✕,
 *                    and a translucent black caption bar across the bottom
 *   add control      full-width 40px bar, dashed neutral stroke that takes the
 *                    accent on hover, image-plus glyph beside its label
 *
 * ── WHY THIS IS NOW SHARED RATHER THAN TWO COMPONENTS ─────────────────────
 * The admin side had this (as AnnouncementMediaField); the guardhouse had a
 * different one — a vertical list of rows with a 32px icon, a filename and a
 * hairline progress bar. Two pickers, two visual languages, for the same act of
 * attaching a file, in one product.
 *
 * The grid was always the more faithful port: the phone renders 3-up
 * BECAUSE an incident report takes several photos, which is the guardhouse
 * case, not the announcement case. Sharing it moves the announcement composer
 * onto the mobile design and the report composer onto the same one at the same
 * time.
 *
 * ── CAPACITY IS A NUMBER, NOT A BOOLEAN ───────────────────────────────────
 * An announcement document holds a single `imageUrl`; an incident holds arrays.
 * So `capacity` drives one component instead of forking it: at 1 the add
 * control reads "Replace image" and never offers a second slot the data model
 * cannot hold; above 1 it reads "Add more" until the cap, then disables with
 * the count. The tile is identical in both cases, which is the entire point.
 *
 * ── RADIUS IS 12px, NOT MOBILE'S 14px ─────────────────────────────────────
 * Mobile's `AppRadius.md` is 14; the web design system's container tier is
 * `rounded-lg`, re-pointed to `AppRadius.sm` (12px). A one-off 14px here would
 * put a corner in these portals that matches nothing else on the page, to save
 * a 2px difference nobody can see side by side.
 *
 * This component is PRESENTATION ONLY. It owns no upload, no file input and no
 * validation — callers keep those, because the admin uploads one image to
 * `announcements/` and the guardhouse uploads many mixed files to
 * `incidents/`, with different limits and different accept lists. What is
 * shared is the thing that was diverging: how it looks and how progress reads.
 */

function iconFor(type = '') {
  if (type.startsWith('image/')) return Images
  if (type.startsWith('video/')) return Film
  if (type === 'application/pdf') return FileType
  return FileText
}

/**
 * @param {object} props
 * @param {Array}  props.items     `{ id, name, type, src, status, progress, error }`.
 *   `status` is 'uploading' | 'done' | 'error'. `src` is a blob URL or a remote
 *   URL — the tile does not care which, so a local preview can show instantly
 *   and be swapped for the download URL without the tile changing.
 * @param {number} [props.capacity] Max attachments. 1 renders the "Replace"
 *   affordance; omit for unlimited.
 * @param {string} [props.heading]
 * @param {string} [props.hint]    Sub-line in the empty dropzone.
 * @param {string} [props.error]   Field-level error (rejected file, denied rule).
 */
export default function MediaAttachmentField({
  items = [],
  capacity,
  heading = 'Media',
  hint,
  error,
  onPick,
  onRemove,
  disabled = false,
  // Drag-and-drop is the guardhouse's, not the phone's — a guard on a laptop
  // drags a dashcam clip in. Optional so the announcement composer, which has
  // no drop target today, is unchanged by adopting this component.
  dragging = false,
  onDragOver,
  onDragLeave,
  onDrop,
}) {
  const attached = items.length > 0
  const single = capacity === 1
  const full = capacity != null && items.length >= capacity
  // 'compressing' counts as busy everywhere 'uploading' does. Both mean the
  // tile has no committed URL yet, which is the only distinction the capacity
  // control and the caller's publish guard actually care about.
  const uploading = items.some(
    (item) => item.status === 'uploading' || item.status === 'compressing',
  )

  return (
    <div className={`rounded-xl border p-4 ${error ? 'border-danger/50' : 'border-hairline'}`}>
      {/* ── Section header ── */}
      <div className="flex items-center gap-2">
        <Images size="sm" className="shrink-0 text-brand-500" />
        <span className="text-sm font-semibold text-text-primary">{heading}</span>
        {attached ? (
          <StatusBadge tone="success" size="sm" className="ml-auto">
            {items.length} attached
          </StatusBadge>
        ) : null}
      </div>

      <div
        className="mt-3.5"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {attached ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {items.map((item) => {
                const Icon = iconFor(item.type)
                const failed = item.status === 'error'
                const compressing = item.status === 'compressing'
                const busy = compressing || item.status === 'uploading'
                return (
                  <figure key={item.id} className="m-0">
                    <div
                      className={`relative aspect-square overflow-hidden rounded-lg bg-tint/[0.06] ${
                        failed ? 'ring-1 ring-inset ring-danger/60' : ''
                      }`}
                    >
                      {item.src ? (
                        <img src={item.src} alt="" className="h-full w-full object-cover" />
                      ) : (
                        // Non-image attachments (video, PDF, text) have no
                        // thumbnail to show. A type glyph centred in the cell
                        // keeps the grid rhythm rather than leaving a hole.
                        <span className="flex h-full w-full items-center justify-center">
                          <Icon size={28} className="text-text-muted" />
                        </span>
                      )}

                      {/* The circular danger badge, mobile's exact affordance:
                          22px, inset 4px, white glyph. Present DURING upload
                          here, unlike the announcement version — a guard who
                          dropped a 20 MB clip by mistake must be able to cancel
                          it, and the caller's remove handler aborts the task
                          rather than merely hiding the tile. */}
                      {disabled ? null : (
                        <button
                          type="button"
                          onClick={() => onRemove?.(item)}
                          aria-label={busy ? `Cancel upload of ${item.name}` : `Remove ${item.name}`}
                          className="absolute right-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-danger text-base-900 transition-transform duration-150 hover:scale-105 active:scale-95"
                        >
                          <X size="sm" strokeWidth={3} />
                        </button>
                      )}

                      {/* Bottom caption strip. */}
                      <div className="absolute inset-x-0 bottom-0 bg-black/55 py-[3px] text-center">
                        <span className="text-2xs font-semibold text-white/85">
                          {failed
                            ? 'Failed'
                            : compressing
                              ? 'Optimising…'
                              : busy
                                ? `Uploading ${item.progress ?? 0}%`
                                : 'Attached'}
                        </span>
                      </div>

                      {/* Progress fill across the tile's foot, under the
                          caption. The phone has no equivalent because it
                          uploads after submit; both portals upload eagerly, and
                          the tile is where the file is. */}
                      {busy ? (
                        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
                          {/* Compression reports no percentage — canvas encoding
                              is one synchronous-looking step, not a stream — so
                              a determinate bar here would have to lie. An
                              indeterminate sweep says "working" without
                              claiming to know how far along it is. It is brief:
                              even a 24 MP photo resizes in well under a second. */}
                          <div
                            className={
                              compressing
                                ? 'h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] bg-info'
                                : 'h-full bg-brand-500 transition-[width] duration-200'
                            }
                            style={compressing ? undefined : { width: `${item.progress ?? 0}%` }}
                          />
                        </div>
                      ) : null}
                    </div>

                    <figcaption
                      className={`mt-1 truncate text-caption ${failed ? 'text-danger' : 'text-text-muted'}`}
                      title={failed ? item.error : item.name}
                    >
                      {failed ? item.error : item.name}
                    </figcaption>
                  </figure>
                )
              })}
            </div>

            <button
              type="button"
              disabled={disabled || (single && uploading) || (full && !single)}
              onClick={onPick}
              className={`mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                dragging
                  ? 'border-brand-500 bg-brand-100 text-brand-400'
                  : 'border-dashed border-slate-300 text-text-secondary hover:border-brand-500/60 hover:bg-brand-50 hover:text-brand-400'
              }`}
            >
              <ImagePlus size="sm" />
              {single
                ? uploading
                  ? `Uploading ${items[0]?.progress ?? 0}%`
                  : 'Replace image'
                : full
                  ? `Limit reached — ${items.length} attached`
                  : dragging
                    ? 'Drop to attach'
                    : 'Add another file'}
            </button>
          </>
        ) : (
          /* ── Empty dropzone ── */
          <button
            type="button"
            disabled={disabled}
            onClick={onPick}
            className={`group flex h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed transition-[border-color,background-color] duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
              error
                ? 'border-danger/55 bg-danger/[0.03]'
                : dragging
                  ? 'border-solid border-brand-500 bg-brand-50'
                  : 'border-slate-300 bg-tint/[0.015] hover:border-brand-500/60 hover:bg-brand-50'
            }`}
          >
            <CloudUpload
              size={36}
              className={`transition-[transform,color] duration-200 ease-[var(--ease-out-strong)] ${
                dragging ? '-translate-y-1 text-brand-400' : 'text-text-muted group-hover:-translate-y-0.5 group-hover:text-brand-500'
              }`}
            />
            <span className="mt-2.5 text-sm font-medium text-text-primary">
              {dragging ? 'Drop to attach' : 'Click to upload'}
            </span>
            {hint ? <span className="mt-1 text-caption text-text-muted">{hint}</span> : null}
          </button>
        )}
      </div>

      {error ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs font-semibold leading-snug text-danger">
          <CircleAlert size="sm" className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  )
}
