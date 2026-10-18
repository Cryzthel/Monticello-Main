import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import {
  AlertTriangle,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crosshair,
  FileText,
  History,
  Home,
  ImageOff,
  Info,
  MapPin,
  Maximize2,
  Printer,
  ShieldAlert,
  ShieldCheck,
  User,
  X,
} from '@shared/icons'
import Lightbox from '@shared/components/Lightbox'
import EvidenceImage from '@shared/components/EvidenceImage'
import Pill from '@shared/components/Pill'
import { DetailCard, DetailField as Field, DetailTimeline } from '@shared/components/detail/DetailCard'
import { captureTimestamp } from '@shared/components/dispatch/EvidenceGrid'
import { buildMediaItems, mapIncidentDoc } from '@shared/lib/incidents'
import { db } from '@shared/lib/firebase'
import { formatCategory } from '@shared/lib/wpda'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { SEVERITY_TONES, categoryTone } from '@shared/theme/badgeStyles'
import { statusStyle } from '@shared/theme/statusStyles'
import { exportReportPdf } from '@shared/lib/reportPdf'
import { toast } from '@shared/lib/toast'
import { formatDate, formatTime } from '@shared/lib/dates'

// The pill sits under a "Priority level" label, so it says only the level —
// "Medium priority" repeated the label and overflowed the narrow 3-column grid.
const URGENCY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/** The priority field's left rule, coloured like its pill. */
const PRIORITY_RULE = {
  danger: 'border-danger/50',
  high: 'border-orange-500/50',
  warning: 'border-warning/50',
  info: 'border-info/50',
  success: 'border-success/50',
  neutral: 'border-hairline',
}

/** Human-quotable code, derived from the document id — the same one IncidentsTable prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

const validDate = (value) => {
  if (!value) return null
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// The shared formatters, so timeline stamps follow the organisation's time
// zone (Settings › System) like every other date — these were browser-local.
const stampOf = (date) => `${formatDate(date)} • ${formatTime(date)}`

/** "+4 min", "+2 h 05 min", "+3 d" — the gap a stage took after the one before it. */
function elapsed(fromMs, toMs) {
  const minutes = Math.max(0, Math.round((toMs - fromMs) / 60000))
  if (minutes < 1) return '+<1 min'
  if (minutes < 60) return `+${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `+${hours} h ${String(minutes % 60).padStart(2, '0')} min`
  return `+${Math.floor(hours / 24)} d`
}

/**
 * Every stage the report has a timestamp for, oldest first.
 *
 * Built from the recorded fields, never from the status: a report closed
 * straight from Pending has no `dispatchedAt`, and drawing "Dispatched" for it
 * would state something that did not happen. Legacy stages appear only on the
 * reports that have them.
 */
function statusHistory(report) {
  const steps = [
    { key: 'reported', label: 'Reported', at: report.reportedAt, detail: report.reportedByName },
    {
      key: 'dispatched',
      label: 'Dispatched',
      at: report.dispatchedAt,
      detail: report.assignedGuardName ? `To ${report.assignedGuardName}` : report.dispatchedByName,
    },
    { key: 'acknowledged', label: 'Acknowledged', at: report.acknowledgedAt },
    { key: 'responding', label: 'Responding', at: report.respondingAt },
    { key: 'onScene', label: 'On scene', at: report.onSceneAt },
    { key: 'investigating', label: 'Investigating', at: report.investigatingAt },
    { key: 'escalated', label: 'Escalated', at: report.escalatedAt, tone: 'warning' },
    { key: 'swept', label: 'Flagged by scheduled sweep', at: report.slaBreach?.at, detail: 'SLA breach recorded', tone: 'warning' },
    { key: 'resolved', label: 'Resolved', at: report.resolvedAt, detail: report.resolvedByName },
  ]
  return steps
    .map((step) => ({ ...step, date: validDate(step.at) }))
    .filter((step) => step.date)
    .sort((a, b) => a.date - b.date)
}

/** `incidents/{id}`, live while open. `undefined` until it reports (or if the read is refused). */
function useLiveIncident(id) {
  const [state, setState] = useState({ id: null, report: undefined })
  useEffect(() => {
    if (!id) return undefined
    setState({ id, report: undefined })
    return onSnapshot(
      doc(db, 'incidents', id),
      (snap) =>
        setState({ id, report: snap.exists() ? mapIncidentDoc({ id: snap.id, ...snap.data() }) : undefined }),
      () => setState({ id, report: undefined }),
    )
  }, [id])
  return state.id === id ? state.report : undefined
}

/** The header label for where the call stands — the reference's "Pending acknowledgement". */
function stageLabel(report) {
  if (report.resolvedAt) return { text: 'Resolved', tone: 'success', pulse: false }
  if (report.onSceneAt || report.respondingAt || report.acknowledgedAt)
    return { text: 'Officer responding', tone: 'info', pulse: true }
  if (report.dispatchedAt) return { text: 'Awaiting officer acknowledgement', tone: 'info', pulse: true }
  const status = statusStyle(report.status ?? 'Pending')
  if (String(report.status ?? 'Pending').toLowerCase() === 'pending')
    return { text: 'Pending acknowledgement', tone: 'warning', pulse: true }
  return { text: status.label ?? report.status, tone: status.tone, pulse: false }
}

/**
 * STATUS HISTORY — every recorded stage as a filled node (amber for an
 * escalation or a sweep flag) with who and when beneath it, the gap since the
 * stage before, and — until resolved — a hollow "Awaiting resolution" node.
 * Drawn by the shared DetailTimeline, which the Report details uses too.
 */
function StatusTimeline({ report }) {
  const steps = statusHistory(report)
  const resolved = steps.some((step) => step.key === 'resolved')
  const items = steps.map((step, index) => {
    const previous = steps[index - 1]
    return {
      key: step.key,
      label: step.label,
      detail: step.detail,
      tone: step.tone === 'warning' ? 'warning' : 'done',
      stamp: `${stampOf(step.date)}${previous ? ` · ${elapsed(previous.date.getTime(), step.date.getTime())}` : ''}`,
      dateTime: step.date.toISOString(),
    }
  })
  if (!resolved) {
    items.push({
      key: 'awaiting',
      label: 'Awaiting resolution',
      detail: report.dispatchedAt ? 'Officer on the call' : 'Pending officer dispatch',
      tone: 'pending',
    })
  }
  return <DetailTimeline items={items} />
}

/**
 * The ticket's detail view, shared by both portals (Admin tickets, Overview
 * and shift records; Guardhouse tickets and reports). Restacked 2026-10-19
 * from the provided reference into ONE column of five cards (max-w-3xl), with
 * a fixed header and footer and only the body scrolling.
 *
 *   ┌ [shield] Maintenance Report (MV-3A1U1BIQ)  (• Maintenance) (• Pending…) ✕ ┐
 *   ├───────────────────────────────────────────────────────────────────────────┤
 *   │ MEDIA EVIDENCE (✓ n verified)   h-64/h-80 photo + caption, thumbnails      │
 *   │ INCIDENT NOTES / DESCRIPTION                                               │
 *   │ REPORTER INFORMATION            name · address                             │
 *   │ INCIDENT TELEMETRY              ticket · category · priority · responder   │
 *   │                                 GPS [Copy]                                 │
 *   │ STATUS HISTORY                  ● Reported … ○ Awaiting · (Export summary) │
 *   ├───────────────────────────────────────────────────────────────────────────┤
 *   │ (shield) Guardhouse dispatch system • Monticello Villas  [primary action]  │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 * ── LIVE ───────────────────────────────────────────────────────────────────
 * The modal subscribes to `incidents/{id}` (onSnapshot) while open and prefers
 * that copy over the caller's, so status, priority, the assigned responder and
 * every timeline node land the moment they are written — in every open
 * console.
 *
 * ── PROCESS ────────────────────────────────────────────────────────────────
 * The modal writes nothing. Dispatch belongs to the Guardhouse's dispatch
 * drawer (firestore.rules refuse workflow fields from the admin console), so a
 * primary action is supplied only by the Guardhouse and sits in the footer.
 * Export summary builds the branded PDF. Dismissed by ✕, a backdrop click or
 * Escape (the Lightbox owns Escape while it is open).
 *
 * Tags are the shared oblong Pill (rounded-full px-3 py-1 text-xs semibold).
 * Colours are the console's tokens, so the reference's slate panel follows the
 * light and dark themes.
 *
 * @param {{ label: string, icon: any, onClick: (report) => void, tone?: 'amber'|'neutral', hint?: string } | null} [primaryAction]
 * @param {string} [footerNote]  The line under the title.
 */
export default function IncidentDetailModal({
  report: passedReport,
  onClose,
  primaryAction = null,
  footerNote = 'Monticello Villas · incident record',
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [copied, setCopied] = useState(false)

  const live = useLiveIncident(passedReport?.id)
  const report = passedReport ? live ?? passedReport : null

  useEffect(() => {
    setActiveIndex(0)
    setLightboxIndex(null)
    setCopied(false)
  }, [report?.id])

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  // Escape closes, unless the Lightbox is up — it owns Escape while open.
  useEffect(() => {
    if (!report || lightboxIndex !== null) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [report, lightboxIndex, onClose])

  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(report), containerRef: panelRef })

  if (!report) return null

  const media = buildMediaItems(report)
  const active = media[Math.min(activeIndex, Math.max(media.length - 1, 0))]
  const severity = String(report.severity ?? 'medium').toLowerCase()
  const urgencyLabel = URGENCY_LABELS[severity] ?? URGENCY_LABELS.medium
  const severityTone = SEVERITY_TONES[severity] ?? 'warning'
  const address = `Phase ${report.phase ?? '—'} • Block ${report.block ?? '—'} • Lot ${report.lot ?? '—'}`
  const coordinates =
    typeof report.lat === 'number' && typeof report.lng === 'number'
      ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`
      : ''

  // "Captured", not "Reported": with evidence attached, the mobile app files
  // `reportedAt` as the OLDEST attachment's camera time.
  const capturedAt = captureTimestamp(report.reportedAt)
  const watermark = {
    name: report.reportedByName ?? 'Unknown resident',
    address,
    timestamp: report.reportedAt ? `Captured ${capturedAt}` : 'Timestamp unavailable',
  }

  const category = formatCategory(report.category)
  const title = report.title || `${category} report`
  const stage = stageLabel(report)
  const attachmentCount = media.length + (report.attachmentUrls?.length ?? 0)

  async function copyCoordinates() {
    try {
      await navigator.clipboard.writeText(coordinates)
      setCopied(true)
    } catch {
      toast.error('Could not copy the coordinates', { description: 'Select them and copy by hand.' })
    }
  }

  function exportSummary() {
    try {
      exportReportPdf(report, { attachmentCount })
      toast.success('Summary exported', { description: `${ticketCode(report.id)}.pdf` })
    } catch (err) {
      console.error('Export failed', err)
      toast.error('Could not export the summary')
    }
  }

  const PrimaryIcon = primaryAction?.icon

  return (
    <div
      className="dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4 md:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-sheet-title"
        className="dialog-panel relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Grab handle — phone sheet only. */}
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-6 shrink-0 items-center justify-center pt-2 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-tint/25" />
        </button>

        {/* ═══ HEADER ═══
            Two rows, by design, for the single-column panel: title and ticket
            code, then the record line and the category / stage pills. The ✕ is
            pinned top-right so it never wraps under the pills. */}
        <header className="relative shrink-0 border-b border-hairline px-6 py-5 pr-14 sm:px-8 sm:pr-16">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-danger/20 bg-danger/10 text-danger shadow-inner">
              <ShieldAlert size={22} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 id="ticket-sheet-title" className="truncate text-xl font-bold tracking-tight text-text-primary">
                  {title}
                </h2>
                <Pill className="font-mono tracking-wider">{ticketCode(report.id)}</Pill>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">{footerNote}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill tone={categoryTone(report.category)}>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                  {category}
                </Pill>
                <Pill tone={stage.tone} pulse={stage.pulse}>
                  {stage.text}
                </Pill>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report details"
            className="absolute right-4 top-4 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:right-6 sm:top-5"
          >
            <X size={20} />
          </button>
        </header>

        {/* ═══ BODY: ONE COLUMN OF STACKED CARDS ═══
            The three groups keep their wrappers as `contents`, so each card is
            a direct item of the one flex column and the gap is uniform. */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-base-950/40 p-6 sm:p-8">
          <div className="flex flex-col gap-6">
            {/* ═══ MEDIA EVIDENCE · NOTES ═══ */}
            <div className="contents">
              <DetailCard
                aria-label="Media evidence"
                icon={Camera}
                title="Media evidence"
                bodyClassName="space-y-4"
                action={
                    media.length ? (
                      <Pill tone="success" icon={CheckCircle2}>
                        {media.length} file{media.length === 1 ? '' : 's'} verified
                      </Pill>
                    ) : (
                      <Pill tone="warning" icon={Clock}>
                        {report.hasMedia ? 'Uploading' : 'No files'}
                      </Pill>
                    )
                  }
              >

                <div className="group relative flex h-64 w-full items-center justify-center overflow-hidden rounded-lg border border-hairline bg-zinc-900 sm:h-80">
                  {active?.type === 'video' ? (
                    <video key={active.url} src={active.url} controls className="absolute inset-0 h-full w-full object-contain" />
                  ) : active ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setLightboxIndex(media.indexOf(active))}
                        aria-label="Open evidence full screen"
                        className="absolute inset-0 opacity-80 transition-opacity duration-300 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                      >
                        <EvidenceImage src={active.url} alt="Incident evidence" eager />
                      </button>
                      <button
                        type="button"
                        onClick={() => setLightboxIndex(media.indexOf(active))}
                        aria-label="View full resolution"
                        title="View full resolution"
                        className="absolute right-3 top-3 rounded-lg border border-white/15 bg-black/60 p-2 text-white opacity-0 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Maximize2 size="sm" />
                      </button>
                      {/* Caption — white on the photo's own scrim in both themes. */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 text-xs">
                        <p className="flex items-center gap-2 text-zinc-300">
                          <Calendar size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
                          <span className="font-mono">Captured: {capturedAt}</span>
                        </p>
                        <p className="mt-1 flex items-center gap-2 text-zinc-400">
                          <MapPin size={14} className="shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {watermark.name} • {address}
                          </span>
                        </p>
                      </div>
                    </>
                  ) : (
                    <span className="flex flex-col items-center gap-2 text-sm text-zinc-400">
                      <ImageOff size="lg" aria-hidden="true" />
                      {report.hasMedia ? 'Media still uploading…' : 'No media attached'}
                    </span>
                  )}
                </div>

                {media.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {media.map((item, index) => (
                      <button
                        key={`${index}:${item.url}`}
                        type="button"
                        onClick={() => setActiveIndex(index)}
                        aria-label={`Show evidence ${index + 1} of ${media.length}`}
                        aria-current={item === active ? 'true' : undefined}
                        className={`relative h-12 w-12 shrink-0 overflow-hidden rounded transition-[border-color,opacity] duration-150 ${
                          item === active ? 'border-2 border-brand-500' : 'border border-hairline opacity-60 hover:opacity-100'
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
              </DetailCard>

              <DetailCard icon={FileText} title="Incident notes / description">
                <p className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-base-950 p-4 text-sm font-medium leading-relaxed text-text-secondary shadow-inner">
                  {report.description || 'No written description.'}
                </p>
              </DetailCard>
            </div>

            {/* ═══ REPORTER · TELEMETRY ═══ */}
            <div className="contents">
              <DetailCard icon={User} title="Reporter information">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Field label="Full name" empty={!report.reportedByName}>
                    {report.reportedByName || 'Unknown'}
                  </Field>
                  <Field label="Property address">
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <Home size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
                      {address}
                    </span>
                  </Field>
                  {report.location && report.location !== address ? (
                    <div className="sm:col-span-2">
                      <Field label="Reported location">{report.location}</Field>
                    </div>
                  ) : null}
                </div>
              </DetailCard>

              <DetailCard icon={Crosshair} title="Incident telemetry" bodyClassName="space-y-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Field label="Ticket ID" mono>
                    {ticketCode(report.id)}
                  </Field>
                  <Field label="Category">{category}</Field>
                  <Field label="Priority level" accent={PRIORITY_RULE[severityTone] ?? 'border-hairline'}>
                    <Pill tone={severityTone} icon={AlertTriangle} className="mt-0.5">
                      {urgencyLabel}
                    </Pill>
                  </Field>
                  <Field label="Assigned responder" empty={!report.assignedGuardName}>
                    {report.assignedGuardName || 'Unassigned'}
                  </Field>
                </div>
                <div className="border-l-2 border-hairline pl-3 pt-2">
                  <span className="mb-1.5 block text-[11px] text-text-muted">GPS coordinates</span>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-base-950 px-3 py-2">
                    <span className="select-all font-mono text-xs text-brand-500">{coordinates || 'No GPS fix'}</span>
                    {coordinates ? (
                      <button
                        type="button"
                        onClick={copyCoordinates}
                        aria-label={copied ? 'Coordinates copied' : 'Copy coordinates'}
                        className="inline-flex items-center gap-1 rounded text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      >
                        {copied ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                        <span className="text-[10px] font-medium uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </DetailCard>
            </div>

            {/* ═══ STATUS HISTORY ═══ */}
            <DetailCard aria-label="Status history" icon={History} title="Status history" bodyClassName="">
              <StatusTimeline report={report} />
              <div className="mt-6 space-y-4 border-t border-hairline pt-6">
                <p className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
                  <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Each stage is stamped with the officer who changed it, and appears in Audit History as it lands.</span>
                </p>
                <button
                  type="button"
                  onClick={exportSummary}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-hairline bg-tint/[0.06] py-2.5 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-tint/[0.1] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <Printer size={16} aria-hidden="true" />
                  Export summary
                </button>
              </div>
            </DetailCard>
          </div>
        </div>

        {/* ═══ FOOTER ═══ */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-base-950 px-6 py-3 sm:px-8">
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <ShieldCheck size={14} className="text-success/70" aria-hidden="true" />
            <span>{primaryAction?.hint ?? 'Guardhouse dispatch system • Monticello Villas'}</span>
          </p>
          {primaryAction ? (
            <button
              type="button"
              onClick={() => primaryAction.onClick(report)}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-semibold shadow-md transition-colors active:scale-[0.97] ${
                primaryAction.tone === 'amber'
                  ? 'bg-amber-400 text-amber-950 shadow-amber-500/10 hover:bg-amber-300'
                  : 'bg-[var(--color-cta)] text-[var(--color-cta-fg)] hover:bg-[var(--color-cta-hover)]'
              }`}
            >
              {PrimaryIcon ? <PrimaryIcon size="sm" aria-hidden="true" /> : null}
              {primaryAction.label}
            </button>
          ) : null}
        </footer>
      </div>

      {lightboxIndex !== null ? (
        <Lightbox media={media} startIndex={lightboxIndex} watermark={watermark} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </div>
  )
}
