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
import { captureTimestamp } from '@shared/components/dispatch/EvidenceGrid'
import { buildMediaItems, mapIncidentDoc } from '@shared/lib/incidents'
import { db } from '@shared/lib/firebase'
import { formatCategory } from '@shared/lib/wpda'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { SEVERITY_TONES, categoryTone } from '@shared/theme/badgeStyles'
import { statusStyle } from '@shared/theme/statusStyles'
import { exportReportPdf } from '@shared/lib/reportPdf'
import { toast } from '@shared/lib/toast'

const URGENCY_LABELS = {
  critical: 'Critical priority',
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
}

/** Human-quotable code, derived from the document id — the same one IncidentsTable prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

const validDate = (value) => {
  if (!value) return null
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const stampOf = (date) => `${DAY_FORMAT.format(date)} • ${TIME_FORMAT.format(date)}`

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

function CardTitle({ icon: Icon, iconClass, children, action = null }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline pb-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <Icon size="sm" className={iconClass} aria-hidden="true" />
        {children}
      </h3>
      {action}
    </div>
  )
}

function Field({ label, children, wide = false, empty = false }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <span className="block text-[11px] text-text-muted">{label}</span>
      <span className={`mt-0.5 block break-words text-xs ${empty ? 'italic text-text-muted' : 'font-medium text-text-primary'}`}>
        {children}
      </span>
    </div>
  )
}

const CARD = 'space-y-3 rounded-xl border border-hairline bg-base-800/60 p-4 dark:bg-base-900/60'

/**
 * STATUS HISTORY — a vertical stepper. Recorded stages are filled emerald
 * nodes (amber for an escalation or a sweep flag). Ahead of the latest one, in
 * order, sit the hollow nodes still owed: the SLA sweep when this console has
 * derived a breach the sweep has not recorded, then "Awaiting resolution".
 */
function StatusTimeline({ report }) {
  const steps = statusHistory(report)
  const resolved = steps.some((step) => step.key === 'resolved')

  return (
    <ol className="relative space-y-6 pl-6 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-0.5 before:bg-hairline">
      {steps.map((step, index) => {
        const previous = steps[index - 1]
        const warn = step.tone === 'warning'
        return (
          <li key={step.key} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -left-6 top-0.5 h-4 w-4 rounded-full border-4 border-base-850 dark:border-base-900 ${
                warn ? 'bg-warning shadow-md shadow-warning/20' : 'bg-success shadow-md shadow-success/20'
              }`}
            />
            <p className={`text-xs font-semibold ${warn ? 'text-warning' : 'text-success'}`}>{step.label}</p>
            {step.detail ? <p className="mt-0.5 truncate text-[11px] font-medium text-text-secondary">{step.detail}</p> : null}
            <time dateTime={step.date.toISOString()} className="mt-0.5 block font-mono text-[10px] text-text-muted">
              {stampOf(step.date)}
              {previous ? ` · ${elapsed(previous.date.getTime(), step.date.getTime())}` : ''}
            </time>
          </li>
        )
      })}
      {!resolved ? (
        <li className="relative opacity-50">
          <span aria-hidden="true" className="absolute -left-6 top-0.5 h-4 w-4 rounded-full border-4 border-base-850 bg-hairline dark:border-base-900" />
          <p className="text-xs font-medium text-text-secondary">Awaiting resolution</p>
          <p className="mt-0.5 text-[10px] text-text-muted">
            {report.dispatchedAt ? 'Officer on the call' : 'Pending officer dispatch'}
          </p>
        </li>
      ) : null}
    </ol>
  )
}

/**
 * The ticket's detail view, shared by both portals (Admin tickets, Overview
 * and shift records; Guardhouse tickets and reports). Each app wraps it with
 * its own primary action — see IncidentTicketDetailsModal in each app.
 *
 *   ┌ [shield] Security Report (MV-CCBL0DNP)      (• Security) (• Pending ack…) │ [×] ┐
 *   │          Monticello Villas · incident record                               │
 *   ├────────────────────────────────────────────────────────────────────────────┤
 *   │ MEDIA (4/12)        │ REPORTER card · TELEMETRY card │ STATUS HISTORY (3/12) │
 *   │ (✓ 1 file verified) │ (priority pill) · GPS + Copy   │ stepper · log note    │
 *   │ 4:5 photo, caption  │ DESCRIPTION card               │                       │
 *   ├────────────────────────────────────────────────────────────────────────────┤
 *   │ (shield) footer note               (Export summary) (primary action)       │
 *   └────────────────────────────────────────────────────────────────────────────┘
 *
 * ── LIVE ───────────────────────────────────────────────────────────────────
 * The modal subscribes to `incidents/{id}` while open and prefers that copy
 * over the caller's, so dispatch, acknowledgement, resolution and a sweep's
 * SLA stamp land the moment they are written.
 *
 * No SLA banner and no phone row (removed 2026-10-18 at the user's request).
 * A breach the scheduled sweep RECORDS still appears as a timeline step,
 * because that is an event on the record rather than a console's estimate.
 *
 * ── PROCESS ────────────────────────────────────────────────────────────────
 * The modal itself writes nothing. Dispatch belongs to the Guardhouse's
 * dispatch drawer (firestore.rules refuse workflow fields from the admin
 * console), so the primary action is supplied by the app: the Guardhouse hands
 * off to its dispatch drawer, the Admin console to the Hazard Map. Audit
 * History is derived from these same timestamps, so it updates as they land.
 *
 * Tags are the shared oblong Pill (rounded-full px-3 py-1 text-xs semibold).
 * Colours are the console's tokens: in dark mode the reference's slate panel
 * maps to the same near-black surfaces every other Admin screen uses.
 *
 * @param {{ label: string, icon: any, onClick: (report) => void, tone?: 'amber'|'neutral' } | null} [primaryAction]
 * @param {string} [footerNote]  The footer's left-hand line.
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
      className="dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center sm:p-3 md:p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-sheet-title"
        className="dialog-panel relative flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900/95 shadow-2xl shadow-black/80 backdrop-blur-xl sm:max-h-[92vh] sm:rounded-2xl dark:bg-base-950/95"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Grab handle — phone sheet only. */}
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-6 shrink-0 items-center justify-center pt-2 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-tint/25" />
        </button>

        {/* ═══ HEADER ═══ */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-hairline px-6 py-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex shrink-0 items-center justify-center rounded-xl border border-danger/20 bg-danger/10 p-2.5 text-danger">
              <ShieldAlert size="md" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 id="ticket-sheet-title" className="truncate text-xl font-bold tracking-tight text-text-primary">
                  {title}
                </h2>
                <Pill className="font-mono">{ticketCode(report.id)}</Pill>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">{footerNote}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Pill tone={categoryTone(report.category)} pulse={false}>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
              {category}
            </Pill>
            <Pill tone={stage.tone} pulse={stage.pulse}>
              {stage.text}
            </Pill>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-hairline" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close report details"
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              <X size="md" />
            </button>
          </div>
        </header>

        {/* ═══ BODY ═══ */}
        <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* ═══ COLUMN 1 — MEDIA EVIDENCE (4/12) ═══ */}
            <section aria-label="Media evidence" className="flex flex-col gap-3 lg:col-span-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <Camera size="sm" className="text-success" aria-hidden="true" />
                  Media evidence
                </h3>
                {media.length ? (
                  <Pill tone="success" icon={CheckCircle2}>
                    {media.length} file{media.length === 1 ? '' : 's'} verified
                  </Pill>
                ) : (
                  <Pill tone="warning" icon={Clock}>
                    {report.hasMedia ? 'Uploading' : 'No files'}
                  </Pill>
                )}
              </div>

              <div className="group relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-xl border border-hairline bg-zinc-900 shadow-inner">
                {active?.type === 'video' ? (
                  <video key={active.url} src={active.url} controls className="absolute inset-0 h-full w-full object-contain" />
                ) : active ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(media.indexOf(active))}
                      aria-label="Open evidence full screen"
                      className="absolute inset-0 transition-transform duration-500 group-hover:scale-105 focus-visible:outline-none"
                    >
                      <EvidenceImage src={active.url} alt="Incident evidence" eager />
                    </button>
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-90 transition-opacity group-hover:opacity-80" />
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(media.indexOf(active))}
                      aria-label="View full resolution"
                      title="View full resolution"
                      className="absolute right-3 top-3 rounded-lg border border-white/15 bg-black/60 p-2 text-white opacity-0 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Maximize2 size="sm" />
                    </button>
                  </>
                ) : (
                  <span className="flex flex-col items-center gap-2 text-sm text-zinc-400">
                    <ImageOff size="lg" aria-hidden="true" />
                    {report.hasMedia ? 'Media still uploading…' : 'No media attached'}
                  </span>
                )}

                {/* Caption — white on the photo's own scrim in both themes. */}
                {active && active.type !== 'video' ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-1 p-4 text-xs">
                    <div className="flex items-center justify-between gap-2 text-zinc-300">
                      <span className="flex items-center gap-1.5 font-medium text-white">
                        <Calendar size="sm" className="text-zinc-400" aria-hidden="true" />
                        Captured
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-zinc-300">{capturedAt}</span>
                    </div>
                    <p className="flex items-center gap-1.5 truncate text-[11px] text-zinc-400">
                      <MapPin size="sm" className="shrink-0 text-zinc-500" aria-hidden="true" />
                      <span className="truncate">
                        {watermark.name} • {address}
                      </span>
                    </p>
                  </div>
                ) : null}

                {media.length > 1 ? (
                  <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-2xs font-semibold tabular-nums text-white backdrop-blur-sm">
                    {media.indexOf(active) + 1} / {media.length}
                  </span>
                ) : null}
              </div>

              {media.length > 1 ? (
                <div className="grid grid-cols-5 gap-2">
                  {media.map((item, index) => (
                    <button
                      key={item.url}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      aria-label={`Show evidence ${index + 1} of ${media.length}`}
                      aria-current={item === active ? 'true' : undefined}
                      className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-[border-color,opacity] duration-150 ${
                        item === active ? 'border-brand-500' : 'border-hairline opacity-70 hover:opacity-100'
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
            </section>

            {/* ═══ COLUMN 2 — REPORTER, TELEMETRY, DESCRIPTION (5/12) ═══ */}
            <div className="min-w-0 space-y-5 lg:col-span-5">
              <section className={CARD}>
                <CardTitle icon={User} iconClass="text-info">
                  Reporter information
                </CardTitle>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Full name" wide empty={!report.reportedByName}>
                    {report.reportedByName || 'Unknown'}
                  </Field>
                  <Field label="Property address" wide>
                    <span className="flex items-center gap-1">
                      <Home size="sm" className="shrink-0 text-text-muted" aria-hidden="true" />
                      {address}
                    </span>
                  </Field>
                </div>
              </section>

              <section className={CARD}>
                <CardTitle icon={Crosshair} iconClass="text-info">
                  Incident telemetry
                </CardTitle>
                <div className="grid grid-cols-2 gap-3.5">
                  <Field label="Ticket ID">
                    <span className="font-mono font-semibold">{ticketCode(report.id)}</span>
                  </Field>
                  <Field label="Category">{category}</Field>
                  <Field label="Priority level">
                    <Pill tone={SEVERITY_TONES[severity] ?? 'warning'} icon={AlertTriangle} className="mt-0.5">
                      {urgencyLabel}
                    </Pill>
                  </Field>
                  <Field label="Assigned responder" empty={!report.assignedGuardName}>
                    {report.assignedGuardName || 'Unassigned'}
                  </Field>
                  {report.location && report.location !== address ? (
                    <Field label="Reported location" wide>
                      {report.location}
                    </Field>
                  ) : null}
                  <div className="col-span-2 border-t border-hairline pt-2">
                    <span className="block text-[11px] text-text-muted">GPS coordinates</span>
                    <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-hairline bg-base-900/80 p-2 dark:bg-base-950/60">
                      <span className="select-all font-mono text-xs text-info">{coordinates || 'No GPS fix'}</span>
                      {coordinates ? (
                        <button
                          type="button"
                          onClick={copyCoordinates}
                          className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-primary hover:underline"
                        >
                          {copied ? <Check size="sm" className="text-success" aria-hidden="true" /> : <Copy size="sm" aria-hidden="true" />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>

              <section className={`${CARD} space-y-2`}>
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <FileText size="sm" className="text-warning" aria-hidden="true" />
                  Incident notes / description
                </h3>
                <p className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-base-900/90 p-3 font-mono text-xs leading-relaxed text-text-secondary dark:bg-base-950/70">
                  {report.description || 'No written description.'}
                </p>
              </section>
            </div>

            {/* ═══ COLUMN 3 — STATUS HISTORY (3/12) ═══ */}
            <section aria-label="Status history" className="flex flex-col rounded-xl border border-hairline bg-base-800/40 p-4 lg:col-span-3 dark:bg-base-900/40">
              <h3 className="mb-4 flex items-center gap-2 border-b border-hairline pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                <History size="sm" className="text-violet" aria-hidden="true" />
                Status history
              </h3>
              <StatusTimeline report={report} />
              <p className="mt-auto flex items-center gap-1.5 border-t border-hairline pt-6 text-[11px] text-text-muted">
                <Info size="sm" className="shrink-0" aria-hidden="true" />
                <span>Each stage is stamped with the officer who changed it, and appears in Audit History as it lands.</span>
              </p>
            </section>
          </div>
        </div>

        {/* ═══ FOOTER ═══ */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-base-900/90 px-6 py-4 dark:bg-base-950/90">
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <ShieldCheck size="sm" className="text-success" aria-hidden="true" />
            <span>{primaryAction?.hint ?? 'Guardhouse dispatch system • Monticello Villas'}</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={exportSummary}
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-tint/[0.05] px-5 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-tint/[0.1] hover:text-text-primary"
            >
              <Printer size="sm" aria-hidden="true" />
              Export summary
            </button>
            {primaryAction ? (
              <button
                type="button"
                onClick={() => primaryAction.onClick(report)}
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold shadow-md transition-colors active:scale-[0.97] ${
                  primaryAction.tone === 'amber'
                    ? 'bg-amber-400 text-amber-950 shadow-amber-500/10 hover:bg-amber-300'
                    : 'bg-[var(--color-cta)] text-[var(--color-cta-fg)] hover:bg-[var(--color-cta-hover)]'
                }`}
              >
                {PrimaryIcon ? <PrimaryIcon size="sm" aria-hidden="true" /> : null}
                {primaryAction.label}
              </button>
            ) : null}
          </div>
        </footer>
      </div>

      {lightboxIndex !== null ? (
        <Lightbox media={media} startIndex={lightboxIndex} watermark={watermark} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </div>
  )
}
