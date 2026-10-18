import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { Archive, ArchiveRestore, Camera, FileDown, FileType, Loader2, Lock, Trash2, X } from '@shared/icons'
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

/** The severity value's colour in Classification, matching its header pill. */
const SEVERITY_TEXT = {
  critical: 'text-danger',
  high: 'text-orange-500',
  medium: 'text-warning',
  low: 'text-success',
}

/** Human-quotable code, derived from the document id — the one the table prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

/**
 * The admin's view of one officer-filed report — opened from Audit History and
 * from Security Reports.
 *
 *   ┌ (Security) (Medium) (● Pending)                                 (×) ┐ sticky
 *   │ Power Interruption                                                   │
 *   │ MV-8VTMQ212 • Oct 18, 2026, 1:34 AM • Filed by …                     │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ CLASSIFICATION & PRIORITY  [ category · severity · WPDA · files ]    │
 *   │ REPORTED DESCRIPTION       [ the officer's text ]                    │
 *   │ RESIDENT DATA              [ name · reported · coords | P · B · L ]  │
 *   │ TIMELINE                   [ ● Submitted ○ Dispatched ○ Resolved … ] │
 *   │ RESPONDER NOTES            (only when recorded)                      │
 *   │ EVIDENCE                   [ preview · thumbnails · documents ]      │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ (Export PDF) (Archive)                                    (Delete)   │ sticky
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Rebuilt 2026-10-19 from the provided "Pro Max" reference: a max-w-2xl
 * near-black glass sheet, each chunk in its own card, chunks divided by a
 * hairline (Miller's law). Colours are the console's tokens, so it follows
 * the light and dark themes.
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
 * EXPORT PDF builds the document itself (lib/reportPdf.js) rather than calling
 * window.print(), which printed the dark modal as grey.
 */

// Header tags are the shared oblong Pill (rounded-full px-3 py-1 text-xs).
const Tag = Pill

/** The surface every chunk of the sheet sits in (the reference's zinc-900/30 card). */
const CARD = 'rounded-xl border border-hairline bg-base-900/30 p-4'

/** One chunk: a tracked caps label, then its card. Chunks are separated by a hairline. */
function Section({ title, action = null, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

const Divider = () => <div aria-hidden="true" className="border-t border-hairline" />

function Field({ label, value, tone = 'text-text-primary', mono = false, breakAll = false }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <span
        className={`block text-sm font-medium ${breakAll ? 'break-all' : 'break-words'} ${mono ? 'font-mono' : ''} ${
          value ? tone : 'text-text-muted'
        }`}
      >
        {value || '—'}
      </span>
    </div>
  )
}

/**
 * One step of the timeline: a filled emerald node when it happened, a hollow
 * one when not, joined to the next by a 1px rail.
 */
function Step({ label, at, pendingLabel, detail, last = false }) {
  const done = Boolean(at)
  return (
    <li className="relative flex items-start gap-3">
      {!last ? <span aria-hidden="true" className="absolute bottom-[-16px] left-[7px] top-6 w-px bg-hairline" /> : null}
      {done ? (
        <span
          aria-hidden="true"
          className="z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-success bg-success/20"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
        </span>
      ) : (
        <span aria-hidden="true" className="z-10 mt-0.5 h-4 w-4 shrink-0 rounded-full border border-hairline bg-base-900" />
      )}
      <div className="min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-text-primary' : 'text-text-muted'}`}>{label}</p>
        <p className={`text-xs ${done ? 'font-mono text-text-muted' : 'text-text-muted/70'}`}>
          {done ? stamp(at) : pendingLabel}
          {done && detail ? <span className="text-success"> · {detail}</span> : null}
        </p>
      </div>
    </li>
  )
}

function SkeletonBody() {
  return (
    <div className="space-y-6" aria-hidden="true">
      {[4, 1, 3].map((cols, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-2.5 w-36" />
          <div className={`${CARD} grid gap-4 ${cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : cols === 3 ? 'grid-cols-1 sm:grid-cols-3' : ''}`}>
            {Array.from({ length: cols }, (_, j) => (
              <div key={j} className="space-y-2">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        </div>
      ))}
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

  function exportPdf() {
    try {
      exportReportPdf(report, { attachmentCount })
    } catch (err) {
      console.error('Report PDF export failed', err)
      toast.error('Could not build the PDF', { description: 'Try again, or export from the reports table.' })
    }
  }

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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
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
          className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-hairline bg-base-950 shadow-2xl"
        >
          {/* ── Sticky header: tags, title, code · filed · by ── */}
          <header className="z-20 flex shrink-0 items-start justify-between gap-3 border-b border-hairline bg-base-950/80 px-4 py-4 backdrop-blur-xl sm:gap-4 sm:px-6 sm:py-5">
            {pending ? (
              <div aria-hidden="true" className="space-y-2">
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-3 w-80 max-w-full" />
              </div>
            ) : gone ? (
              <h2 id="report-sheet-title" className="text-xl font-semibold tracking-tight text-text-primary">
                Report removed
              </h2>
            ) : (
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={categoryTone(report.category)}>{formatCategory(report.category)}</Tag>
                  {severity ? (
                    <Tag tone={SEVERITY_TONES[severity] ?? 'neutral'}>{severity[0].toUpperCase() + severity.slice(1)}</Tag>
                  ) : null}
                  <Tag tone={REVIEW_TONES[review] ?? 'neutral'} pulse={!report.reviewedAt}>
                    {review}
                  </Tag>
                  {archived ? <Tag>Archived</Tag> : null}
                  {deleted ? <Tag tone="danger">Deleted</Tag> : null}
                </div>
                <div>
                  {/* Two lines at most, so a long title cannot push the
                      sticky header over a third of a phone screen; the full
                      text is the tooltip. */}
                  <h2
                    id="report-sheet-title"
                    title={report.title || undefined}
                    className="line-clamp-2 break-words text-lg font-semibold tracking-tight text-text-primary sm:text-xl"
                  >
                    {report.title || `${formatCategory(report.category)} report`}
                  </h2>
                  {/* Code and time never break; the filer, often a long email
                      address, truncates on its own line. */}
                  <p className="mt-0.5 font-mono text-xs text-text-muted">
                    <span className="whitespace-nowrap">{ticketCode(report.id)}</span>
                    <span className="opacity-50"> • </span>
                    <span className="whitespace-nowrap">{stamp(report.reportedAt) || 'No filing time'}</span>
                  </p>
                  <p className="truncate font-mono text-xs text-text-muted" title={report.reportedByName || undefined}>
                    Filed by {report.reportedByName || 'an officer'}
                  </p>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close report"
              className="shrink-0 rounded-full bg-base-900/50 p-2 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              <X size={16} />
            </button>
          </header>

          {/* ── Body: Miller's chunks, one card each ── */}
          <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6">
            {pending ? (
              <SkeletonBody />
            ) : gone ? (
              <p className="text-sm text-text-secondary">
                This report was deleted while it was open. It may be in Audit History → Deleted reports, where it
                can be restored.
              </p>
            ) : (
              <>
                <Section title="Classification & priority">
                  <div className={`${CARD} grid grid-cols-2 gap-4 sm:grid-cols-4`}>
                    <Field label="Category" value={formatCategory(report.category)} />
                    <Field
                      label="Severity"
                      value={severity ? severity[0].toUpperCase() + severity.slice(1) : ''}
                      tone={SEVERITY_TEXT[severity] ?? 'text-text-primary'}
                    />
                    <Field label="WPDA urgency" value={wpda != null ? String(wpda) : ''} tone="text-success" mono />
                    <Field label="Evidence files" value={`${attachmentCount} file${attachmentCount === 1 ? '' : 's'}`} />
                  </div>
                </Section>

                <Divider />

                <Section title="Reported description">
                  <div className={CARD}>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">
                      {report.description || 'No written description.'}
                    </p>
                  </div>
                </Section>

                <Divider />

                <Section title="Resident data">
                  <div className={`${CARD} space-y-4`}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <Field label="Full name" value={report.reportedByName} breakAll />
                      <Field label="Reported at" value={stamp(report.reportedAt)} mono />
                      <Field label="Coordinates" value={coordinates} mono tone="text-text-secondary" />
                    </div>
                    <dl className="grid grid-cols-3 divide-x divide-hairline rounded-lg border border-hairline bg-base-950/80 py-3 text-center">
                      {[
                        ['Phase', report.phase],
                        ['Block', report.block],
                        ['Lot', report.lot],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="mb-0.5 text-[10px] uppercase tracking-wider text-text-muted">{label}</dt>
                          <dd className="text-sm font-semibold tabular-nums text-text-primary">{value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </Section>

                <Divider />

                <Section title="Timeline">
                  <div className={`${CARD} space-y-4`}>
                    <ol className="space-y-4">
                      <Step label="Submitted" at={report.reportedAt} pendingLabel="No submission time" />
                      <Step
                        label={report.assignedGuardName ? `Dispatched to ${report.assignedGuardName}` : 'Dispatched'}
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
                        last
                      />
                    </ol>
                  </div>
                </Section>

                {report.responderNotes || report.resolutionSummary ? (
                  <>
                    <Divider />
                    <Section title="Responder notes">
                      <div className={`${CARD} grid grid-cols-1 gap-4 sm:grid-cols-2`}>
                        <Field label="Responder notes" value={report.responderNotes} />
                        <Field label="Final resolution summary" value={report.resolutionSummary} />
                      </div>
                    </Section>
                  </>
                ) : null}

                <Divider />

                <Section
                  title="Evidence"
                  action={
                    attachmentCount > 0 ? (
                      <Pill tone="neutral" icon={Lock}>
                        {attachmentCount} attached
                      </Pill>
                    ) : null
                  }
                >
                  {attachmentCount === 0 ? (
                    <div className={`${CARD} flex flex-col items-center justify-center py-10 text-text-muted`}>
                      <Camera size={28} className="mb-2 opacity-40" aria-hidden="true" />
                      <span className="text-sm font-medium opacity-70">No evidence attached</span>
                    </div>
                  ) : (
                    <div className={`${CARD} space-y-3`}>
                      {preview ? (
                        <button
                          type="button"
                          onClick={() => setLightboxIndex(media.indexOf(preview))}
                          aria-label="Open evidence full screen"
                          className="relative block aspect-video w-full overflow-hidden rounded-lg border border-hairline bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                        >
                          {preview.type === 'video' ? (
                            <video src={preview.url} className="h-full w-full object-contain" muted />
                          ) : (
                            <EvidenceImage src={preview.url} fit="contain" />
                          )}
                        </button>
                      ) : null}

                      {media.length > 1 ? (
                        <div className="flex flex-wrap gap-2">
                          {media.map((item, index) => (
                            <button
                              key={`${index}:${item.url}`}
                              type="button"
                              onClick={() => setPreviewIndex(index)}
                              aria-label={`Show evidence ${index + 1} of ${media.length}`}
                              aria-pressed={item === preview}
                              className={`relative h-12 w-12 overflow-hidden rounded-md border transition-[border-color,opacity] duration-150 ${
                                item === preview ? 'border-brand-500' : 'border-hairline opacity-60 hover:opacity-100'
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
                          {documents.map((url, index) => (
                            <li key={`${index}:${url}`}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-h-10 items-center gap-2.5 rounded-lg border border-hairline px-3 py-2 transition-colors hover:bg-tint/[0.04]"
                              >
                                <FileType size="sm" className="shrink-0 text-text-muted" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">
                                  {decodeURIComponent(url.split('/').pop().split('?')[0])}
                                </span>
                                <span className="shrink-0 text-xs font-medium text-brand-500">Open</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}
                </Section>
              </>
            )}
          </div>

          {/* ── Sticky footer: Export PDF · Archive … Delete ── */}
          <footer className="z-20 shrink-0 border-t border-hairline bg-base-950/80 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4">
            {error ? (
              <p role="alert" className="mb-3 rounded-lg border border-danger/25 bg-danger/10 p-2.5 text-xs text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!report}
                  onClick={exportPdf}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-hairline bg-base-900 px-3 py-2 text-xs sm:px-4 font-medium text-text-primary transition-colors hover:bg-tint/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50"
                >
                  <FileDown size={14} className="opacity-70" aria-hidden="true" />
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
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-hairline bg-base-900 px-3 py-2 text-xs sm:px-4 font-medium text-text-primary transition-colors hover:bg-tint/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50"
                >
                  {busy === 'archive' ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : archived ? (
                    <ArchiveRestore size={14} className="opacity-70" aria-hidden="true" />
                  ) : (
                    <Archive size={14} className="opacity-70" aria-hidden="true" />
                  )}
                  {archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
              <button
                type="button"
                disabled={!report || deleted || Boolean(busy)}
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-danger/20 bg-danger/10 px-3 py-2 text-xs sm:px-4 font-medium text-danger transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50"
              >
                <Trash2 size={14} className="opacity-80" aria-hidden="true" />
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
