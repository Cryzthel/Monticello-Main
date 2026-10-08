import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ClipboardCheck,
  FileType,
  Images,
  Loader2,
  Printer,
  Trash2,
  X,
} from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import PriorityBadge from '@shared/components/PriorityBadge'
import EvidenceImage from '@shared/components/EvidenceImage'
import Lightbox from '@shared/components/Lightbox'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import IncidentBreakdown from '@shared/components/IncidentBreakdown'
import { MetaItem, MetaList, MetaSection } from '@shared/components/MetaList'
import { categoryTone } from '@shared/theme/badgeStyles'
import {
  buildMediaItems, reviewState, REVIEW_TONES, isArchived,
  markReportsReviewed, archiveIncidents, unarchiveIncidents, softDeleteIncidents,
} from '@shared/lib/incidents'
import { describeFirestoreError } from '@shared/lib/audit'
import { formatCategory } from '@shared/lib/wpda'
import { Skeleton } from '@shared/components/Skeleton'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { exportReportPdf } from '@/lib/reportPdf'

const STAMP = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
const stamp = (value) => (value ? new Date(value).toLocaleString('en-GB', STAMP).replace(',', '') : '')

/** Human-quotable code, derived from the document id — the one the table prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

/**
 * The sheet's contents while the report is being resolved: the same two
 * columns, the same sections, at roughly the same heights. A centred spinner
 * would make the sheet appear to rebuild itself when the data lands; matching
 * the layout means the skeleton is replaced in place.
 */
function SkeletonSection({ title, rows = 2 }) {
  return (
    <section aria-label={title} className="rounded-xl border border-hairline bg-base-800">
      <header className="flex min-h-11 items-center gap-2 border-b border-hairline px-4 py-2">
        <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
        <Skeleton className="h-3.5 w-36" />
      </header>
      <div className="space-y-2.5 p-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={`h-3.5 ${i % 2 ? 'w-3/5' : 'w-full'}`} />
        ))}
      </div>
    </section>
  )
}

function SkeletonBody() {
  return (
    // Mirrors the loaded body's single column exactly. A skeleton in a shape
    // the real content does not take is worse than no skeleton: it promises a
    // two-column panel, then reflows the moment the data lands, which reads as
    // the page breaking rather than as it loading.
    <div className="flex flex-col gap-6">
      <div className="space-y-3">
        <SkeletonSection title="Classification & priority" rows={3} />
        <SkeletonSection title="Resident data" rows={3} />
        <SkeletonSection title="Timeline" rows={4} />
        <SkeletonSection title="Responder notes & resolution" />
      </div>
      <div className="space-y-3">
        <section className="rounded-xl border border-hairline bg-base-800 p-4">
          <Skeleton variant="surface" className="aspect-video w-full max-w-2xl" />
        </section>
        <SkeletonSection title="Review" rows={4} />
      </div>
    </div>
  )
}

/**
 * The admin's view of one officer-filed report.
 *
 * ── A WIDE, TWO-COLUMN RECORD ─────────────────────────────────────────────
 * This was a 42rem slide-over, one long column: the breakdown, then the
 * attachments, then a one-line "reviewed by" note at the very bottom. The
 * drawer's argument was that it kept the table visible beside it — but the
 * evidence, the part an auditor most needs to SEE, was the last thing in the
 * scroll, and the review record was a sentence below that.
 *
 * It is now a centred 64rem dialog from `sm:` up, and from `lg:` a two-column
 * grid on one baseline:
 *
 *   ┌───────────────────────────────┬───────────────────────┐
 *   │ Classification & priority     │ Evidence (sticky)      │
 *   │ Resident data                 │   large preview        │
 *   │ Timeline                      │   thumbnails · files   │
 *   │ Responder notes & resolution  │ Review record          │
 *   └───────────────────────────────┴───────────────────────┘
 *
 * The left column is the shared IncidentBreakdown — the same four sections the
 * Guardhouse sees, so the two consoles never describe one incident with
 * different amounts of it. The right column is sticky, so the photo stays in
 * view while the timeline is read. Below `lg` the two collapse to one column.
 *
 * ON A PHONE IT IS A BOTTOM SHEET, at 92dvh, dismissed by the backdrop, Escape,
 * or dragging the grab handle down. The handle is `sm:hidden`, so the drag
 * gesture simply does not exist on a pointer device.
 *
 * EXPORT PDF is `window.print()` against a print stylesheet, not a bundled PDF
 * library: every browser's print dialog offers "Save as PDF", and the output is
 * selectable text rather than a canvas raster, which matters for a document
 * that may end up in an incident file.
 */
export default function SecurityReportDetailModal({ reportId, report, onClose, onDeleted }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(null)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const sheetRef = useRef(null)
  const dragRef = useRef(null)

  /*
   * OPENNESS AND CONTENT ARE TWO DIFFERENT QUESTIONS.
   *
   * `report` is resolved by a `.find()` over a LIVE Firestore snapshot, so it
   * is legitimately absent while the snapshot that contains it is still
   * landing, or after another admin archived or deleted it in the same second.
   * `reportId` is what the operator asked for and is set synchronously by the
   * click, so it — not the resolved object — decides whether the sheet is up.
   * Missing content then renders as a skeleton rather than as an empty box.
   */
  const openedId = reportId ?? report?.id ?? null
  const visible = Boolean(openedId)
  const pending = !report

  // Per-report UI state, keyed on the REQUESTED id: keying on the resolved
  // report would fire again the moment a pending sheet's data arrives, wiping
  // an error the operator has not read yet.
  useEffect(() => {
    setError('')
    setConfirming(null)
    setLightboxIndex(null)
    setPreviewIndex(0)
  }, [openedId])

  useEffect(() => {
    if (!visible || lightboxIndex !== null) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, lightboxIndex, onClose])

  /*
   * Drag-to-dismiss, confined to the grab handle. Not the whole sheet: the body
   * is a scroll region, and a sheet that also listened for downward drags
   * anywhere would steal the first flick of a scroll. Pointer capture rather
   * than window listeners, so a finger that leaves the handle mid-drag still
   * reports to this element and the drag cannot be left half-finished.
   */
  function startDrag(event) {
    if (!sheetRef.current) return
    dragRef.current = event.clientY
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* capture is an optimisation; the drag still works without it */
    }
    sheetRef.current.style.transition = 'none'
  }

  function moveDrag(event) {
    if (dragRef.current == null || !sheetRef.current) return
    const dy = Math.max(0, event.clientY - dragRef.current)
    sheetRef.current.style.transform = `translateY(${dy}px)`
  }

  function endDrag(event) {
    if (dragRef.current == null || !sheetRef.current) return
    const dy = Math.max(0, event.clientY - dragRef.current)
    dragRef.current = null
    sheetRef.current.style.transition = 'transform 180ms cubic-bezier(0.32, 0.72, 0, 1)'
    sheetRef.current.style.transform = ''
    if (dy > 120) onClose?.()
  }

  const panelRef = useRef(null)
  useDialogFocus({ open: visible, containerRef: panelRef })

  if (!visible) return null

  const media = report ? buildMediaItems(report) : []
  const documents = report?.attachmentUrls ?? []
  const review = report ? reviewState(report) : null
  const archived = report ? isArchived(report) : false
  const preview = media[previewIndex] ?? media[0]

  async function run(label, action, { close = false } = {}) {
    if (!report) return
    setBusy(label)
    setError('')
    try {
      await action([report.id])
      setConfirming(null)
      if (close) {
        onDeleted?.(report.id)
        onClose?.()
      }
    } catch (err) {
      console.error('Report action failed', err)
      setConfirming(null)
      setError(describeFirestoreError(err, 'update this report'))
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <div
        className="dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-center sm:p-4"
        onClick={onClose}
      >
        <div
          ref={sheetRef}
          ref={panelRef}
        role="dialog"
          aria-modal="true"
          aria-label={`Report ${report ? ticketCode(report.id) : ''}`}
          aria-busy={pending}
          onClick={(event) => event.stopPropagation()}
          className="card flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-b-none rounded-t-xl border-x-0 border-b-0 bg-base-900 shadow-modal sm:h-[88vh] sm:max-w-5xl sm:rounded-lg sm:border"
        >
          {/* Grab handle — the sheet's drag target on a phone. */}
          <div
            className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing sm:hidden"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-tint/25" />
          </div>

          {/* ── Header: what the report is, then the three facts that identify it ── */}
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline px-4 py-4 sm:px-6">
            <div className="min-w-0">
              {pending ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Skeleton className="h-7 w-24 rounded-full" />
                    <Skeleton className="h-7 w-20 rounded-full" />
                  </div>
                  <Skeleton className="mt-3 h-5 w-56" />
                  <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={categoryTone(report.category)}>
                      {formatCategory(report.category)}
                    </StatusBadge>
                    <PriorityBadge severity={report.severity} />
                    <StatusBadge tone={REVIEW_TONES[review] ?? 'neutral'}>{review}</StatusBadge>
                    {archived ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
                  </div>
                  <h2 className="mt-2.5 truncate text-base font-semibold leading-tight text-text-primary">
                    {report.title || `${formatCategory(report.category)} report`}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-text-secondary">
                    <span className="font-mono text-xs">{ticketCode(report.id)}</span>
                    <span aria-hidden="true" className="text-text-muted">·</span>
                    <span>{stamp(report.reportedAt) || 'No filing time'}</span>
                    <span aria-hidden="true" className="text-text-muted">·</span>
                    <span>Filed by {report.reportedByName || 'an officer'}</span>
                  </p>
                </>
              )}
            </div>
            {/* 44px on touch, back to the dense 32px header button from `sm:`. */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="icon-btn h-11 w-11 shrink-0 sm:h-8 sm:w-8"
            >
              <X size="sm" />
            </button>
          </div>

          {/* ── Body (the printed region) ── */}
          <div
            id="report-print-area"
            className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6"
          >
            {pending ? (
              <SkeletonBody />
            ) : (
              /* ── ONE COLUMN, TOP TO BOTTOM ───────────────────────────────
                 This was a two-column split: the narrative on the left and a
                 20rem evidence rail on the right, stuck to the top so it
                 stayed beside whatever was being read.

                 The rail is gone because the two halves were not peers. A
                 report is read in one order — what happened, where, then what
                 was photographed — and a fixed sidebar cut the narrative to
                 about 60% of the panel, so the one piece of prose anyone
                 actually reads got the narrowest measure on screen. Sticky
                 made it worse rather than better: evidence pinned beside a
                 paragraph it does not illustrate is just a thing that will not
                 scroll away.

                 Stacked, the narrative gets the full width and evidence lands
                 where it belongs — after the account it supports.

                 This is a plain block comment rather than a braced JSX one,
                 because a ternary branch holds exactly one expression. A braced
                 comment here is a second expression and the build fails with
                 "Expected `,` or `)`". */
              <div className="flex flex-col gap-6">
                <div className="min-w-0">
                  <IncidentBreakdown report={report} mediaCount={media.length} canEditNotes={false} />
                </div>

                <div className="space-y-3">
                  <MetaSection
                    icon={Images}
                    title="Evidence"
                    action={
                      media.length + documents.length > 0 ? (
                        <span className="text-xs font-medium text-text-secondary">
                          {media.length + documents.length} attached
                        </span>
                      ) : null
                    }
                  >
                    {media.length === 0 && documents.length === 0 ? (
                      <p className="text-sm text-text-secondary">Nothing attached to this report.</p>
                    ) : (
                      <div className="space-y-3">
                        {preview ? (
                          <button
                            type="button"
                            onClick={() => setLightboxIndex(media.indexOf(preview))}
                            aria-label="Open evidence full screen"
                            className="relative block aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-black"
                          >
                            {preview.type === 'video' ? (
                              <video src={preview.url} className="h-full w-full object-contain" muted />
                            ) : (
                              <EvidenceImage src={preview.url} fit="contain" />
                            )}
                          </button>
                        ) : null}

                        {media.length > 1 ? (
                          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                            {media.map((item, index) => (
                              <button
                                key={item.url}
                                type="button"
                                onClick={() => setPreviewIndex(index)}
                                aria-label={`Show evidence ${index + 1} of ${media.length}`}
                                aria-pressed={item === preview}
                                /* `border-hairline`, not `border-transparent`:
                                   unselected thumbnails had no edge at all, so
                                   a dark photo — a night shot, which is most of
                                   them — bled into the panel and the grid lost
                                   its gutters. The selected ring still reads
                                   because it is a brand colour against a
                                   neutral, not because it is the only border. */
                                className={`relative aspect-square overflow-hidden rounded-xl border-2 transition-[border-color,opacity] duration-150 ${
                                  item === preview
                                    ? 'border-brand-500'
                                    : 'border-hairline opacity-70 hover:opacity-100'
                                }`}
                              >
                                {item.type === 'video' ? (
                                  <video src={item.url} className="h-full w-full object-cover" muted />
                                ) : (
                                  <EvidenceImage src={item.url} />
                                )}
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {/* Documents can't be thumbnailed, so they get a row
                            each with an explicit open-in-new-tab. */}
                        {documents.length > 0 ? (
                          <ul className="space-y-2">
                            {documents.map((url) => (
                              <li key={url}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex min-h-11 items-center gap-2.5 rounded-xl border border-hairline bg-base-900 px-3 py-2 transition-colors duration-150 hover:border-slate-300"
                                >
                                  <FileType size="sm" className="shrink-0 text-text-muted" />
                                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">
                                    {decodeURIComponent(url.split('/').pop().split('?')[0])}
                                  </span>
                                  <span className="shrink-0 text-xs font-medium text-brand-400">Open</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    )}
                  </MetaSection>

                  <MetaSection icon={ClipboardCheck} title="Review">
                    <MetaList>
                      <MetaItem label="Status">
                        <StatusBadge tone={REVIEW_TONES[review] ?? 'neutral'} size="sm">{review}</StatusBadge>
                      </MetaItem>
                      <MetaItem label="Reviewed by">{report.reviewedAt ? report.reviewedByName || 'An admin' : ''}</MetaItem>
                      <MetaItem label="Reviewed">{stamp(report.reviewedAt)}</MetaItem>
                    </MetaList>
                  </MetaSection>
                </div>
              </div>
            )}
          </div>

          {/* ── Admin actions ── */}
          <div className="shrink-0 border-t border-hairline px-4 py-3.5 sm:px-6">
            {error ? (
              <p className="mb-3 rounded-xl border border-danger/25 bg-danger/10 p-2.5 text-sm text-danger">
                {error}
              </p>
            ) : null}

            {/* A 2×2 grid on a phone rather than a wrapping row: four buttons of
                different label widths wrap into a ragged three-then-one block
                that puts Delete directly under a thumb resting on Archive. */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <button
                type="button"
                disabled={pending || Boolean(busy) || Boolean(report?.reviewedAt)}
                onClick={() => run('review', markReportsReviewed)}
                className="btn btn-sm btn-success min-h-11 sm:min-h-0"
              >
                {busy === 'review' ? (
                  <Loader2 size="sm" className="animate-spin" />
                ) : (
                  <CheckCircle2 size="sm" />
                )}
                {report?.reviewedAt ? 'Reviewed' : 'Mark as reviewed'}
              </button>

              {/* Was `window.print()`, which is not an export: it opened the
                  browser's print dialog on the whole page, printed the dark
                  modal as grey, and left whether a FILE appeared entirely up to
                  whichever printer the admin picked. This builds the document
                  itself and downloads it — see lib/reportPdf.js for why it is
                  drawn as text rather than screenshotted. */}
              <button
                type="button"
                disabled={pending || !report}
                onClick={() => exportReportPdf(report, { attachmentCount: media.length + documents.length })}
                className="btn btn-sm btn-outline min-h-11 sm:min-h-0"
              >
                <Printer size="sm" />
                Export PDF
              </button>

              <button
                type="button"
                disabled={pending || Boolean(busy)}
                onClick={() => run('archive', archived ? unarchiveIncidents : archiveIncidents)}
                className="btn btn-sm btn-outline min-h-11 sm:min-h-0"
              >
                {busy === 'archive' ? (
                  <Loader2 size="sm" className="animate-spin" />
                ) : archived ? (
                  <ArchiveRestore size="sm" />
                ) : (
                  <Archive size="sm" />
                )}
                {archived ? 'Unarchive' : 'Archive'}
              </button>

              <button
                type="button"
                disabled={pending || Boolean(busy)}
                onClick={() => setConfirming(true)}
                className="btn btn-sm btn-danger min-h-11 sm:ml-auto sm:min-h-0"
              >
                <Trash2 size="sm" />
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {lightboxIndex !== null ? (
        <Lightbox media={media} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirming)}
        busy={busy === 'delete'}
        tone="danger"
        title="Delete this report?"
        message="It moves to Audit History → Deleted Reports, where it can be restored. Archive instead if you only want it off the working list."
        confirmLabel="Delete"
        onConfirm={() => run('delete', softDeleteIncidents, { close: true })}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}
