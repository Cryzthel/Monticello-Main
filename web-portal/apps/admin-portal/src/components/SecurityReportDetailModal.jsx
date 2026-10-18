import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import {
  Archive,
  ArchiveRestore,
  Camera,
  CheckCircle2,
  Clock,
  FileDown,
  FileType,
  Fingerprint,
  Images,
  Loader2,
  Trash2,
  UserCircle,
  X,
} from '@shared/icons'
import EvidenceImage from '@shared/components/EvidenceImage'
import Lightbox from '@shared/components/Lightbox'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { Skeleton } from '@shared/components/Skeleton'
import { SEVERITY_TONES, categoryTone } from '@shared/theme/badgeStyles'
import {
  REVIEW_TONES,
  archiveIncidents,
  buildMediaItems,
  formatMinutes,
  incidentDurations,
  isArchived,
  isDeleted,
  mapIncidentDoc,
  reviewState,
  softDeleteIncidents,
  unarchiveIncidents,
} from '@shared/lib/incidents'
import { computePriorityScore, formatCategory } from '@shared/lib/wpda'
import { db } from '@shared/lib/firebase'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { formatDateTime } from '@shared/lib/dates'
import { toast } from '@shared/lib/toast'
import { exportReportPdf } from '@/lib/reportPdf'
import Pill from '@shared/components/Pill'

const stamp = (value) => formatDateTime(value, '')

/** Human-quotable code, derived from the document id — the one the table prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

/**
 * The admin's view of one officer-filed report — opened from Audit History and
 * from Security Reports.
 *
 *   ┌ [SECURITY] [HIGH] [● PENDING]                                [×] ┐  sticky
 *   │ Security Report                                                   │
 *   │ MV-QUITBNLA · Aug 27, 2026, 10:15 PM · Filed by …                 │
 *   ├───────────────────────────────────────────────────────────────────┤
 *   │ CLASSIFICATION & PRIORITY   category · severity · WPDA · files    │
 *   │ RESIDENT DATA               name · reported · coordinates         │
 *   │                             [ PHASE | BLOCK | LOT ]               │
 *   │ TIMELINE                    ● Submitted ○ Dispatched ● Resolved   │
 *   │                             ● Reviewed                            │
 *   │ RESPONDER NOTES             (only when recorded)                  │
 *   │ EVIDENCE                    preview · thumbnails · documents      │
 *   ├───────────────────────────────────────────────────────────────────┤
 *   │ [✓ Approve] [Export PDF] [Archive]                      [Delete]  │  sticky
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * ── LIVE ON ITS OWN ────────────────────────────────────────────────────────
 * The sheet subscribes to `incidents/{id}` itself while open. The page's
 * `report` (resolved from its own live list) is used until the document
 * listener reports, so the sheet paints immediately; after that the document
 * listener wins. That keeps it live even when the report is not in the page's
 * current list, and it can tell "still loading" (skeleton) from "deleted by
 * someone else" (a notice), which a `.find()` over a list cannot.
 *
 * Approve writes `reviewedAt`, which lands back through the same listener: the
 * header pill turns Reviewed and the timeline gains its fourth step without the
 * sheet doing anything itself.
 *
 * ── THE REFERENCE, ON TOKENS ───────────────────────────────────────────────
 * `#09090b` and the zinc borders are dark `base-950` and `hairline`; tag
 * colours come from the same tone table as every badge in the console, on the
 * reference's square-cornered tag shape.
 *
 * EXPORT PDF builds the document itself (lib/reportPdf.js) rather than calling
 * window.print(), which printed the dark modal as grey.
 */

// Header tags are the shared oblong Pill (rounded-full), as on every
// Admin page since the 2026-10-18 badge standardisation.
const Tag = Pill

function SectionTitle({ icon: Icon, children, action = null, className = 'mb-6' }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon size="sm" className="text-text-muted" />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted">{children}</h3>
      </div>
      {action}
    </div>
  )
}

function Field({ label, value, tone = 'text-text-primary', mono = false, className = '' }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">{label}</span>
      <span className={`break-words text-[14px] font-medium ${mono ? 'font-mono' : ''} ${value ? tone : 'text-text-muted'}`}>
        {value || '—'}
      </span>
    </div>
  )
}

/** One step of the vertical stepper: a filled check when done, a hollow ring when not. */
function Step({ label, at, pendingLabel, detail }) {
  const done = Boolean(at)
  return (
    <li className="relative">
      {done ? (
        <span className="absolute -left-[41px] top-0 rounded-full border-4 border-base-900 bg-base-900 text-success dark:border-base-950 dark:bg-base-950">
          <CheckCircle2 size={20} />
        </span>
      ) : (
        <span className="absolute -left-[37px] top-1.5 h-3 w-3 rounded-full border-2 border-text-muted bg-base-900 ring-4 ring-base-900 dark:bg-base-950 dark:ring-base-950" />
      )}
      <div className="flex flex-col gap-1.5 pt-0.5">
        <span className={`text-[14px] font-medium ${done ? 'text-text-primary' : 'text-text-secondary'}`}>{label}</span>
        <span className={`text-[13px] ${done ? 'text-text-muted' : 'text-text-muted/70'}`}>
          {done ? stamp(at) : pendingLabel}
          {done && detail ? <span className="text-success"> · {detail}</span> : null}
        </span>
      </div>
    </li>
  )
}

function SkeletonBody() {
  return (
    <div className="space-y-12" aria-hidden="true">
      {[4, 3, 3].map((cols, i) => (
        <section key={i} className="space-y-6">
          <Skeleton className="h-3 w-40" />
          <div className={`grid gap-8 ${cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}>
            {Array.from({ length: cols }, (_, j) => (
              <div key={j} className="space-y-2">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        </section>
      ))}
      <Skeleton variant="surface" className="aspect-video w-full rounded-xl" />
    </div>
  )
}

/** `incidents/{id}`, live while the sheet is open. `undefined` = not reported yet, `null` = gone. */
function useLiveReport(id) {
  const [state, setState] = useState({ id: null, report: undefined })
  useEffect(() => {
    if (!id) return undefined
    setState({ id, report: undefined })
    return onSnapshot(
      doc(db, 'incidents', id),
      (snap) => setState({ id, report: snap.exists() ? mapIncidentDoc({ id: snap.id, ...snap.data() }) : null }),
      // A denied read falls back to whatever the page resolved.
      () => setState({ id, report: undefined }),
    )
  }, [id])
  return state.id === id ? state.report : undefined
}

export default function SecurityReportDetailModal({ reportId, report: pageReport, onClose, onDeleted }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [previewIndex, setPreviewIndex] = useState(0)

  /*
   * OPENNESS AND CONTENT ARE TWO DIFFERENT QUESTIONS. `reportId` is set
   * synchronously by the click and decides whether the sheet is up; the
   * report itself may still be landing.
   */
  const openedId = reportId ?? pageReport?.id ?? null
  const visible = Boolean(openedId)
  const live = useLiveReport(openedId)
  const report = live === undefined ? (pageReport?.id === openedId ? pageReport : null) : live
  const gone = live === null
  const pending = !report && !gone

  useEffect(() => {
    setError('')
    setConfirming(false)
    setLightboxIndex(null)
    setPreviewIndex(0)
  }, [openedId])

  useEffect(() => {
    if (!visible || lightboxIndex !== null || confirming) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, lightboxIndex, confirming, onClose])

  const panelRef = useRef(null)
  useDialogFocus({ open: visible, containerRef: panelRef })

  if (!visible) return null

  const media = report ? buildMediaItems(report) : []
  const documents = report?.attachmentUrls ?? []
  const attachmentCount = media.length + documents.length
  const review = report ? reviewState(report) : null
  const archived = report ? isArchived(report) : false
  // Opened from Audit History → Deleted reports. The record is read-only
  // there: it is restored or purged from that table, not acted on here.
  const deleted = report ? isDeleted(report) : false
  const preview = media[previewIndex] ?? media[0]
  const durations = report ? incidentDurations(report) : {}
  const wpda = report
    ? Math.round(typeof report.wpdaScore === 'number' && report.wpdaScore > 0 ? report.wpdaScore : computePriorityScore(report))
    : null
  const coordinates =
    typeof report?.lat === 'number' && typeof report?.lng === 'number'
      ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`
      : ''
  const severity = String(report?.severity ?? '').toLowerCase()

  async function run(kind, action, messages, { close = false } = {}) {
    if (!report) return
    setBusy(kind)
    setError('')
    const id = report.id
    const ok = await toast.run(() => action([id]), messages)
    setBusy('')
    setConfirming(false)
    if (!ok) {
      setError(`${messages.error}. Check the connection and try again.`)
      return
    }
    if (close) {
      onDeleted?.(id)
      onClose?.()
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md sm:p-6"
        onClick={onClose}
        role="presentation"
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-sheet-title"
          aria-busy={pending}
          onClick={(event) => event.stopPropagation()}
          className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-hairline bg-base-900 shadow-2xl dark:bg-base-950"
        >
          {/* ── Sticky header ── */}
          <header className="relative z-10 shrink-0 border-b border-hairline bg-base-900/95 px-6 pb-6 pt-8 backdrop-blur sm:px-8 dark:bg-base-950/95">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close report"
              className="absolute right-6 top-7 rounded-md p-1.5 text-text-muted transition-colors hover:bg-tint/[0.06] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:right-8"
            >
              <X size="md" />
            </button>

            {pending ? (
              <div aria-hidden="true">
                <div className="mb-5 flex gap-2.5">
                  <Skeleton className="h-6 w-20 rounded-md" />
                  <Skeleton className="h-6 w-14 rounded-md" />
                </div>
                <Skeleton className="h-7 w-56" />
                <Skeleton className="mt-3 h-3.5 w-80 max-w-full" />
              </div>
            ) : gone ? (
              <h2 id="report-sheet-title" className="pr-10 text-2xl font-semibold tracking-tight text-text-primary">
                Report removed
              </h2>
            ) : (
              <>
                <div className="mb-5 flex flex-wrap items-center gap-2.5 pr-10">
                  <Tag tone={categoryTone(report.category)}>{formatCategory(report.category)}</Tag>
                  {severity ? <Tag tone={SEVERITY_TONES[severity] ?? 'neutral'}>{severity}</Tag> : null}
                  <Tag tone={REVIEW_TONES[review] ?? 'neutral'} pulse={!report.reviewedAt}>
                    {review}
                  </Tag>
                  {archived ? <Tag>Archived</Tag> : null}
                  {deleted ? <Tag tone="danger">Deleted</Tag> : null}
                </div>
                <h2 id="report-sheet-title" className="pr-10 text-2xl font-semibold tracking-tight text-text-primary">
                  {report.title || `${formatCategory(report.category)} report`}
                </h2>
                <p className="mt-2 text-[13px] font-medium text-text-secondary">
                  <span className="font-mono">{ticketCode(report.id)}</span>
                  {' • '}
                  {stamp(report.reportedAt) || 'No filing time'}
                  {' • '}
                  Filed by {report.reportedByName || 'an officer'}
                </p>
              </>
            )}
          </header>

          {/* ── Body ── */}
          <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-10 sm:px-8">
            {pending ? (
              <SkeletonBody />
            ) : gone ? (
              <p className="text-sm text-text-secondary">
                This report was deleted while it was open. It may be in Audit History → Deleted
                reports, where it can be restored.
              </p>
            ) : (
              <div className="space-y-12">
                <section>
                  <SectionTitle icon={Fingerprint}>Classification &amp; priority</SectionTitle>
                  <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
                    <Field label="Category" value={formatCategory(report.category)} />
                    <Field label="Severity" value={severity ? severity[0].toUpperCase() + severity.slice(1) : ''} />
                    <Field label="WPDA urgency" value={wpda != null ? String(wpda) : ''} tone="text-success" />
                    <Field label="Evidence files" value={`${attachmentCount} file${attachmentCount === 1 ? '' : 's'}`} />
                  </div>
                  {report.description ? (
                    <div className="mt-8 flex flex-col gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
                        Reported description
                      </span>
                      <p className="whitespace-pre-wrap break-words text-[14px] font-medium leading-relaxed text-text-primary">
                        {report.description}
                      </p>
                    </div>
                  ) : null}
                </section>

                <section>
                  <SectionTitle icon={UserCircle}>Resident data</SectionTitle>
                  <div className="mb-8 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-3">
                    <Field label="Full name" value={report.reportedByName} />
                    <Field label="Reported" value={stamp(report.reportedAt)} />
                    <Field label="Coordinates" value={coordinates} mono />
                  </div>
                  <dl className="grid grid-cols-3 divide-x divide-hairline rounded-lg border border-hairline bg-base-800/60 dark:bg-base-900/60">
                    {[
                      ['Phase', report.phase],
                      ['Block', report.block],
                      ['Lot', report.lot],
                    ].map(([label, value]) => (
                      <div key={label} className="flex flex-col items-center justify-center gap-1.5 py-4">
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</dt>
                        <dd className="text-[15px] font-semibold tabular-nums text-text-primary">{value || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section>
                  <SectionTitle icon={Clock} className="mb-8">Timeline</SectionTitle>
                  <ol className="relative ml-2 space-y-10 border-l border-hairline pl-8">
                    <Step label="Submitted" at={report.reportedAt} pendingLabel="No submission time" />
                    <Step
                      label="Dispatched"
                      at={report.dispatchedAt}
                      pendingLabel="Not yet dispatched"
                      detail={durations.toDispatch != null ? `+${formatMinutes(durations.toDispatch)}` : ''}
                    />
                    <Step
                      label="Resolved"
                      at={report.resolvedAt}
                      pendingLabel="Not yet resolved"
                      detail={durations.onScene != null ? `+${formatMinutes(durations.onScene)}` : ''}
                    />
                    <Step
                      label={report.reviewedAt ? `Reviewed by ${report.reviewedByName || 'an admin'}` : 'Reviewed'}
                      at={report.reviewedAt}
                      pendingLabel="Awaiting admin review"
                    />
                  </ol>
                  <div className="ml-2 mt-10 grid grid-cols-2 gap-8">
                    <Field label="Responding officer" value={report.assignedGuardName} />
                  </div>
                </section>

                {report.responderNotes || report.resolutionSummary ? (
                  <section>
                    <SectionTitle icon={FileType}>Responder notes</SectionTitle>
                    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                      <Field label="Responder notes" value={report.responderNotes} />
                      <Field label="Final resolution summary" value={report.resolutionSummary} />
                    </div>
                  </section>
                ) : null}

                <section>
                  <SectionTitle
                    icon={Images}
                    action={
                      attachmentCount > 0 ? (
                        <span className="text-[12px] font-medium text-text-muted">{attachmentCount} attached</span>
                      ) : null
                    }
                  >
                    Evidence
                  </SectionTitle>

                  {attachmentCount === 0 ? (
                    <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl border border-hairline bg-base-800/60 text-text-muted dark:bg-base-900/50">
                      <Camera size={32} className="mb-3 opacity-40" />
                      <span className="text-sm font-medium opacity-60">No evidence attached</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {preview ? (
                        <button
                          type="button"
                          onClick={() => setLightboxIndex(media.indexOf(preview))}
                          aria-label="Open evidence full screen"
                          className="relative block aspect-video w-full overflow-hidden rounded-xl border border-hairline bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                        >
                          {preview.type === 'video' ? (
                            <video src={preview.url} className="h-full w-full object-contain" muted />
                          ) : (
                            <EvidenceImage src={preview.url} fit="contain" />
                          )}
                        </button>
                      ) : null}

                      {media.length > 1 ? (
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                          {media.map((item, index) => (
                            <button
                              key={item.url}
                              type="button"
                              onClick={() => setPreviewIndex(index)}
                              aria-label={`Show evidence ${index + 1} of ${media.length}`}
                              aria-pressed={item === preview}
                              className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-[border-color,opacity] duration-150 ${
                                item === preview ? 'border-brand-500' : 'border-hairline opacity-70 hover:opacity-100'
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

                      {documents.length > 0 ? (
                        <ul className="space-y-2">
                          {documents.map((url) => (
                            <li key={url}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-h-11 items-center gap-2.5 rounded-lg border border-hairline px-3 py-2 transition-colors hover:bg-tint/[0.04]"
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
                </section>
              </div>
            )}
          </div>

          {/* ── Sticky footer ── */}
          <footer className="relative z-10 shrink-0 border-t border-hairline bg-base-900/95 px-6 py-5 backdrop-blur sm:px-8 dark:bg-base-950/95">
            {error ? (
              <p role="alert" className="mb-4 rounded-lg border border-danger/25 bg-danger/10 p-2.5 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                {/* The Approve / Approved button was removed at the user's request
                    (2026-10-18). Review still shows on the timeline ("Reviewed by
                    …") from `reviewedAt`, and a resolved call is still signed off
                    from the Hazard Map drawer's "Verify resolution". */}
                <button
                  type="button"
                  disabled={!report}
                  onClick={() => exportReportPdf(report, { attachmentCount })}
                  className="sheet-btn sheet-btn-ghost flex-1 sm:flex-none"
                >
                  <FileDown size="sm" className="opacity-70" />
                  Export PDF
                </button>
                <button
                  type="button"
                  disabled={!report || deleted || Boolean(busy)}
                  onClick={() =>
                    run('archive', archived ? unarchiveIncidents : archiveIncidents, {
                      success: archived ? 'Report restored to the active list' : 'Report archived',
                      error: archived ? 'Could not unarchive the report' : 'Could not archive the report',
                    })
                  }
                  className="sheet-btn sheet-btn-ghost flex-1 sm:flex-none"
                >
                  {busy === 'archive' ? (
                    <Loader2 size="sm" className="animate-spin" />
                  ) : archived ? (
                    <ArchiveRestore size="sm" className="opacity-70" />
                  ) : (
                    <Archive size="sm" className="opacity-70" />
                  )}
                  {archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
              <button
                type="button"
                disabled={!report || deleted || Boolean(busy)}
                onClick={() => setConfirming(true)}
                className="sheet-btn sheet-btn-danger w-full sm:w-auto"
              >
                <Trash2 size="sm" className="opacity-80" />
                Delete
              </button>
            </div>
          </footer>
        </div>
      </div>

      {lightboxIndex !== null ? (
        <Lightbox media={media} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      ) : null}

      <ConfirmDialog
        open={confirming}
        busy={busy === 'delete'}
        tone="danger"
        title="Delete this report?"
        message="It moves to Audit History → Deleted Reports, where it can be restored. Archive instead if you only want it off the working list."
        confirmLabel="Delete"
        onConfirm={() =>
          run(
            'delete',
            softDeleteIncidents,
            { success: 'Report moved to Deleted reports', error: 'Could not delete the report' },
            { close: true },
          )
        }
        onCancel={() => setConfirming(false)}
      />
    </>,
    document.body,
  )
}
