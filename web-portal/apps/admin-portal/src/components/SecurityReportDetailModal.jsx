import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import {
  Archive,
  ArchiveRestore,
  Camera,
  ClipboardList,
  FileText,
  FileType,
  Fingerprint,
  History,
  ImageOff,
  Loader2,
  Lock,
  Maximize2,
  Printer,
  ShieldAlert,
  Trash2,
  User,
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
import { DetailCard, DetailField, DetailTimeline } from '@shared/components/detail/DetailCard'

const stamp = (value) => formatDateTime(value, '')

/** Human-quotable code, derived from the document id — the one the table prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

/**
 * The admin's view of one officer-filed report — opened from Reports and from
 * Audit History.
 *
 *   ┌ [shield] Power Interruption (MV-8VTMQ212)                           (×) ┐ fixed
 *   │          Oct 18, 2026, 1:34 AM • Filed by …                              │
 *   │          (Security) (Medium) (● Pending)                                 │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │ CLASSIFICATION & PRIORITY   category · severity · WPDA · files          │
 *   │ REPORTED DESCRIPTION        the officer's text                          │
 *   │ RESIDENT DATA               name · reported · coordinates · P | B | L   │
 *   │ TIMELINE                    ● Submitted ○ Dispatched ○ Resolved …       │
 *   │ RESPONDER NOTES             (only when recorded)                        │
 *   │ EVIDENCE                    h-64/h-80 preview · thumbnails · documents  │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │ (Export PDF) (Archive)                                      (Delete)    │ fixed
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── ONE DESIGN WITH THE INCIDENT DETAILS (2026-10-19) ──────────────────────
 * Same shell as the shared IncidentDetailModal — max-w-3xl panel, icon-tile
 * header with the mono ticket code, one column of cards on a base-950/40 body,
 * a base-950 footer — and the same cards, fields and timeline, drawn by
 * @shared/components/detail/DetailCard, so the two screens cannot drift.
 *
 * ── LIVE ON ITS OWN ────────────────────────────────────────────────────────
 * The sheet subscribes to `incidents/{id}` itself while open. The page's
 * `report` (resolved from its own live list) is used until the document
 * listener reports, so the sheet paints immediately; after that the document
 * listener wins. That keeps it live even when the report is not in the page's
 * current list, and it can tell "still loading" (skeleton) from "deleted by
 * someone else" (a notice), which a `.find()` over a list cannot.
 *
 * EXPORT PDF builds the document itself (lib/reportPdf.js) rather than calling
 * window.print(), which printed the dark modal as grey.
 */

/** The severity field's rule colour, matching its pill (as Incident telemetry's priority). */
const SEVERITY_RULE = {
  critical: 'border-danger/50',
  high: 'border-orange-500/50',
  medium: 'border-warning/50',
  low: 'border-success/50',
}

function SkeletonBody() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      {[4, 1, 3].map((cols, i) => (
        <div key={i} className="rounded-xl border border-hairline bg-base-900/40 p-6">
          <Skeleton className="mb-5 h-3 w-40" />
          <div className={`grid gap-6 ${cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : cols === 3 ? 'grid-cols-1 sm:grid-cols-3' : ''}`}>
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

  const timeline = report
    ? [
        { key: 'submitted', label: 'Submitted', at: report.reportedAt, pending: 'No submission time' },
        {
          key: 'dispatched',
          label: report.assignedGuardName ? `Dispatched to ${report.assignedGuardName}` : 'Dispatched',
          at: report.dispatchedAt,
          pending: 'Not yet dispatched',
          gap: durations.toDispatch,
        },
        { key: 'resolved', label: 'Resolved', at: report.resolvedAt, pending: 'Not yet resolved', gap: durations.onScene },
        {
          key: 'reviewed',
          label: report.reviewedAt ? `Reviewed by ${report.reviewedByName || 'an admin'}` : 'Reviewed',
          at: report.reviewedAt,
          pending: 'Awaiting admin review',
        },
      ].map((step) =>
        step.at
          ? {
              key: step.key,
              label: step.label,
              tone: 'done',
              stamp: `${stamp(step.at)}${step.gap != null ? ` · +${formatMinutes(step.gap)}` : ''}`,
              dateTime: new Date(step.at).toISOString(),
            }
          : { key: step.key, label: step.label, detail: step.pending, tone: 'pending' },
      )
    : []

  const footerButton =
    'inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-hairline bg-tint/[0.06] px-4 py-2 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-tint/[0.1] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:pointer-events-none disabled:opacity-50'

  return createPortal(
    <>
      <div
        className="dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4 md:p-6"
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
          className="dialog-panel relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
        >
          {/* ═══ HEADER — the Incident details' header, field for field ═══ */}
          <header className="relative shrink-0 border-b border-hairline px-6 py-5 pr-14 sm:px-8 sm:pr-16">
            {pending ? (
              <div aria-hidden="true" className="flex items-start gap-4">
                <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-56 max-w-full" />
                  <Skeleton className="h-3 w-72 max-w-full" />
                  <div className="flex gap-2 pt-1">
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                </div>
              </div>
            ) : gone ? (
              <h2 id="report-sheet-title" className="text-xl font-bold tracking-tight text-text-primary">
                Report removed
              </h2>
            ) : (
              <div className="flex min-w-0 items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-danger/20 bg-danger/10 text-danger shadow-inner">
                  <ShieldAlert size={22} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <h2
                      id="report-sheet-title"
                      title={report.title || undefined}
                      className="line-clamp-2 break-words text-xl font-bold tracking-tight text-text-primary"
                    >
                      {report.title || `${formatCategory(report.category)} report`}
                    </h2>
                    <Pill className="font-mono tracking-wider">{ticketCode(report.id)}</Pill>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-text-muted" title={report.reportedByName || undefined}>
                    <span className="font-mono">{stamp(report.reportedAt) || 'No filing time'}</span>
                    {' • '}Filed by {report.reportedByName || 'an officer'}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Pill tone={categoryTone(report.category)}>
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                      {formatCategory(report.category)}
                    </Pill>
                    {severity ? (
                      <Pill tone={SEVERITY_TONES[severity] ?? 'neutral'}>{severity[0].toUpperCase() + severity.slice(1)}</Pill>
                    ) : null}
                    <Pill tone={REVIEW_TONES[review] ?? 'neutral'} pulse={!report.reviewedAt}>
                      {review}
                    </Pill>
                    {archived ? <Pill tone="neutral" icon={Archive}>Archived</Pill> : null}
                    {deleted ? <Pill tone="danger" icon={Trash2}>Deleted</Pill> : null}
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close report"
              className="absolute right-4 top-4 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:right-6 sm:top-5"
            >
              <X size={20} />
            </button>
          </header>

          {/* ═══ BODY — one column of DetailCards ═══ */}
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-base-950/40 p-4 sm:p-8">
            {pending ? (
              <SkeletonBody />
            ) : gone ? (
              <p className="text-sm text-text-secondary">
                This report was deleted while it was open. It may be in Audit History → Deleted reports, where it can be
                restored.
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                <DetailCard icon={Fingerprint} title="Classification & priority">
                  <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                    <DetailField label="Category">{formatCategory(report.category)}</DetailField>
                    <DetailField label="Severity" accent={SEVERITY_RULE[severity]} empty={!severity}>
                      {severity ? severity[0].toUpperCase() + severity.slice(1) : '—'}
                    </DetailField>
                    <DetailField label="WPDA urgency" mono empty={wpda == null}>
                      {wpda != null ? <span className="text-brand-500">{wpda}</span> : '—'}
                    </DetailField>
                    <DetailField label="Evidence files">{`${attachmentCount} file${attachmentCount === 1 ? '' : 's'}`}</DetailField>
                  </div>
                </DetailCard>

                <DetailCard icon={FileText} title="Reported description">
                  <p className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-base-950 p-4 text-sm font-medium leading-relaxed text-text-secondary shadow-inner">
                    {report.description || 'No written description.'}
                  </p>
                </DetailCard>

                <DetailCard icon={User} title="Resident data">
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                    <DetailField label="Full name" empty={!report.reportedByName}>
                      <span className="break-all">{report.reportedByName || 'Unknown'}</span>
                    </DetailField>
                    <DetailField label="Reported at" mono empty={!report.reportedAt}>
                      {stamp(report.reportedAt) || '—'}
                    </DetailField>
                    <DetailField label="Coordinates" mono empty={!coordinates}>
                      {coordinates ? <span className="select-all text-brand-500">{coordinates}</span> : 'No GPS fix'}
                    </DetailField>
                  </div>
                  <dl className="grid grid-cols-3 divide-x divide-hairline rounded-lg border border-hairline bg-base-950 py-3 text-center shadow-inner">
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
                </DetailCard>

                <DetailCard icon={History} title="Timeline" bodyClassName="">
                  <DetailTimeline items={timeline} />
                </DetailCard>

                {report.responderNotes || report.resolutionSummary ? (
                  <DetailCard icon={ClipboardList} title="Responder notes">
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                      <DetailField label="Responder notes" empty={!report.responderNotes}>
                        {report.responderNotes || '—'}
                      </DetailField>
                      <DetailField label="Final resolution summary" empty={!report.resolutionSummary}>
                        {report.resolutionSummary || '—'}
                      </DetailField>
                    </div>
                  </DetailCard>
                ) : null}

                <DetailCard
                  icon={Camera}
                  title="Evidence"
                  bodyClassName="space-y-4"
                  action={
                    attachmentCount > 0 ? (
                      <Pill tone="success" icon={Lock}>
                        {attachmentCount} attached
                      </Pill>
                    ) : (
                      <Pill tone="neutral">No files</Pill>
                    )
                  }
                >
                  {attachmentCount === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-hairline bg-zinc-900 text-zinc-400">
                      <ImageOff size="lg" className="mb-2" aria-hidden="true" />
                      <span className="text-sm">No evidence attached</span>
                    </div>
                  ) : (
                    <>
                      {preview ? (
                        <button
                          type="button"
                          onClick={() => setLightboxIndex(media.indexOf(preview))}
                          aria-label="Open evidence full screen"
                          className="group relative block h-64 w-full overflow-hidden rounded-lg border border-hairline bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:h-80"
                        >
                          {preview.type === 'video' ? (
                            <video src={preview.url} className="h-full w-full object-contain" muted />
                          ) : (
                            <EvidenceImage src={preview.url} fit="contain" />
                          )}
                          <span className="pointer-events-none absolute right-3 top-3 rounded-lg border border-white/15 bg-black/60 p-2 text-white opacity-0 shadow-lg backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            <Maximize2 size="sm" aria-hidden="true" />
                          </span>
                        </button>
                      ) : null}

                      {media.length > 1 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {media.map((item, index) => (
                            <button
                              key={`${index}:${item.url}`}
                              type="button"
                              onClick={() => setPreviewIndex(index)}
                              aria-label={`Show evidence ${index + 1} of ${media.length}`}
                              aria-current={item === preview ? 'true' : undefined}
                              className={`relative h-12 w-12 shrink-0 overflow-hidden rounded transition-[border-color,opacity] duration-150 ${
                                item === preview ? 'border-2 border-brand-500' : 'border border-hairline opacity-60 hover:opacity-100'
                              }`}
                            >
                              {item.type === 'video' ? (
                                <video src={item.url} className="h-full w-full object-cover" muted preload="metadata" />
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
                                className="flex min-h-10 items-center gap-2.5 rounded-lg border border-hairline bg-base-950 px-3 py-2 transition-colors hover:bg-tint/[0.04]"
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
                    </>
                  )}
                </DetailCard>
              </div>
            )}
          </div>

          {/* ═══ FOOTER — Export PDF · Archive … Delete ═══ */}
          <footer className="shrink-0 border-t border-hairline bg-base-950 px-4 py-3 sm:px-8">
            {error ? (
              <p role="alert" className="mb-3 rounded-lg border border-danger/25 bg-danger/10 p-2.5 text-xs text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
              <div className="flex items-center gap-2">
                <button type="button" disabled={!report} onClick={exportPdf} className={footerButton}>
                  <Printer size={14} aria-hidden="true" />
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
                  className={footerButton}
                >
                  {busy === 'archive' ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : archived ? (
                    <ArchiveRestore size={14} aria-hidden="true" />
                  ) : (
                    <Archive size={14} aria-hidden="true" />
                  )}
                  {archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
              <button
                type="button"
                disabled={!report || deleted || Boolean(busy)}
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-danger/20 bg-danger/10 px-4 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:pointer-events-none disabled:opacity-50"
              >
                <Trash2 size={14} aria-hidden="true" />
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
