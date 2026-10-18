import { toast } from '@shared/lib/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertOctagon,
  Archive,
  BadgeCheck,
  ClipboardCheck,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  IdCard,
  Loader2,
  MapPin,
  Radio,
  ShieldCheck,
  ShieldX,
  Timer,
  UserRoundCheck,
  X,
} from '@shared/icons'
import Lightbox from '@shared/components/Lightbox'
import Pill from '@shared/components/Pill'
import StageStepper from '@shared/components/dispatch/StageStepper'
import Receipt from '@shared/components/dispatch/Receipt'
import EvidenceGrid, {
  forensicCoordinates,
  forensicTimestamp,
} from '@shared/components/dispatch/EvidenceGrid'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useReporterContact } from '@shared/hooks/useReporterContact'
import { useStaffAccounts } from '@shared/hooks/useStaffAccounts'
import {
  archiveIncidents,
  buildMediaItems,
  isArchived,
  markReportsReviewed,
} from '@shared/lib/incidents'
import { isOfficerFiled } from '@shared/lib/staffFiling'
import { categoryColor, categoryLabel, normalizeCategory } from '@shared/lib/incidentCategories'
import { categoryIcon } from '@shared/theme/categoryIcons'
import { SEVERITY_TONES, categoryTone } from '@shared/theme/badgeStyles'
import { relativeTime } from '@shared/lib/notifications'
import {
  ACK_TIMEOUT_MS,
  deriveDispatchStage,
  RESOLUTION_OUTCOMES,
} from '@shared/lib/dispatchStage'
import { unitLabel } from '@shared/lib/unitIdentity'
import { normalizeResidentStatus, RESIDENT_STATUS, RESIDENT_STATUS_LABELS } from '@shared/lib/residents'
import { ROUTES } from '@/config/portal'
import { formatDateTime, formatInZone } from '@shared/lib/dates'

const SEVERITY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/** Human-quotable code, derived from the document id — the one IncidentsTable prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

const exactTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : formatDateTime(date)
}

const CLOCK = { hour: '2-digit', minute: '2-digit', hour12: false }
// In the portal time zone (Settings › System), like every other stamp.
const clock = (at) => (at ? formatInZone(at, CLOCK, 'en-GB') : '—')

/** A card's label: a muted glyph and mono tracked caps, with an optional right-hand note. */
function SectionTitle({ icon: Icon, action = null, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-widest text-text-muted">
        <Icon size={14} aria-hidden="true" />
        {children}
      </h3>
      {action}
    </div>
  )
}

/** One label/value line in Location telemetry: label left, value right, a left rule. */
function LocationRow({ label, mono = false, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-l-2 border-hairline pl-3">
      <dt className="shrink-0 font-medium text-text-muted">{label}</dt>
      <dd className={`min-w-0 break-words text-right ${mono ? 'font-mono text-brand-500' : 'font-medium text-text-primary'}`}>
        {children}
      </dd>
    </div>
  )
}

/**
 * Whether the assigned unit has blown its acknowledgement window.
 *
 * The Guardhouse runs this clock to decide whether to offer Reassign. This
 * console cannot reassign (see the footer note), so it runs the clock for the
 * one thing it CAN do with the answer: say so on the panel. An administrator
 * watching the map is often the second pair of eyes on a unit that has gone
 * quiet, and until now the only thing this rail said about a dispatched call
 * with no answer was the word "Dispatched".
 *
 * The interval only runs while a `dispatched` call is open, and it only exists
 * to flip the badge — nothing here counts seconds at an operator.
 */
function useAckExpiry(report, stage) {
  const waiting = stage === 'dispatched'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!waiting) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waiting])
  if (!waiting || !report?.dispatchedAt) return false
  return now - new Date(report.dispatchedAt).getTime() >= ACK_TIMEOUT_MS
}

/**
 * Runs one administrative write for the rail's footer and turns its outcome
 * into one receipt — the Guardhouse's `useStageAction` contract, minus
 * everything that belongs to the dispatch machine.
 *
 * There is no offline-queue notice here, and that is deliberate rather than
 * unfinished: an officer presses Acknowledge in a street on a dying signal and
 * needs to know the press was kept, whereas an administrator presses Verify at
 * a desk. If the write does not land, the plain failure is the honest answer.
 *
 * Keyed to the incident, so a receipt never survives onto another call.
 */
function useAdminAction(incidentId) {
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)

  useEffect(() => {
    setBusy(null)
    setFeedback(null)
  }, [incidentId])

  const run = useCallback(async (key, label, task) => {
    setBusy(key)
    setFeedback(null)
    try {
      await task()
      // Success is a toast (it outlives the drawer); failure stays inline.
      toast.success(label)
      return true
    } catch (err) {
      console.error(`${label} failed`, err)
      setFeedback({
        tone: 'danger',
        /**
         * `permission-denied` is named, because on this panel it is the
         * EXPECTED failure rather than a freak one: `firestore.rules` grants
         * admin staff `allow update … && !touchesWorkflow()`, so the moment
         * anyone wires a control here that writes a workflow field, this is
         * the message it will produce. Saying "refused by the server" instead
         * of "something went wrong" is the difference between a five-minute
         * diagnosis and an afternoon.
         */
        text:
          err?.code === 'permission-denied'
            ? `${label} was refused by the server. This console may not write dispatch fields.`
            : `${label} failed. Check the connection and try again.`,
      })
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  const dismiss = useCallback(() => setFeedback(null), [])
  return { busy, feedback, run, dismiss }
}

/**
 * ── THE HAZARD MAP'S REPORT DETAILS ────────────────────────────────────────
 *
 *   ┌ [icon] Maintenance Report                                   [×] ┐ fixed
 *   │        MV-SACELWL6 • Reported 17:49                              │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ (Maintenance) (● Medium priority)                                │
 *   │ ┌ ●──────◉──────○  Dispatched · Responding · Resolved ┐          │
 *   │ ┌ (L) Lian Nicole Jabagat (Pending)  Aug 30, 2026, 5:49 PM ┐     │
 *   │ ┌ ASSIGNED UNIT  (● Unit MV-0864) ┐                              │
 *   │ ┌ LOCATION TELEMETRY  address · coordinates ┐                    │
 *   │ ┌ REPORTED DESCRIPTION (1 file)  note · evidence ┐               │
 *   │ ┌ RESOLUTION (once closed) ┐                                     │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ [ the action for this stage ]                         (Close)    │ fixed
 *   │ what this console may and may not do                              │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * A CENTRED MODAL (2026-10-19, by request), max-w-xl and max-h-[92vh], with
 * only the body scrolling. It replaced a right-hand rail that left the map
 * visible beside it; the trade was made deliberately for a narrower, card-led
 * read of one report. Each part of the record is its own card.
 *
 * LIVE: `report` is the Hazard Map's own `incidents` onSnapshot document, so
 * the stage, the stepper's timestamps, the assigned unit and the location
 * update in the open modal, in every admin console, as the Guardhouse works
 * the call. Dismissed by ✕, Close, a backdrop click or Escape (the Lightbox
 * owns Escape while it is open; a write in flight holds the modal open).
 *
 * ── WHAT THIS CONSOLE MAY ACTUALLY DO, AND WHAT IT MAY NOT ─────────────────
 * The footer offers the oversight action for the stage the call is in, and the
 * stage decides which, exactly as the Guardhouse's footer does. What it CANNOT
 * offer is any part of the response lifecycle:
 *
 *     firestore.rules  /incidents  allow update:
 *         … || (isAdminStaff() && !touchesWorkflow() && …)
 *
 * and `workflowFields()` lists `status`, `dispatchStage`, `assignedGuardUid`,
 * `assignedGuardName`, `escalation` and `resolution` among them. So a Dispatch
 * or a Reassign button here would be refused by the server on press — offering
 * it would be offering a lie, and a console that lies about its own authority
 * is worse than one that is plainly read-only about the part it does not own.
 * Reassignment is the Guardhouse's, and the hint says so in words rather than
 * leaving an administrator to hunt for a control that was never there.
 *
 * The two writes an administrator genuinely owns are both on the REVIEW and
 * ARCHIVE axes, which are deliberately separate from dispatch (see the note in
 * shared/lib/incidents.js), and both are offered only once the call is
 * resolved — verifying or archiving a call a unit is still working would take
 * it off the backlog while it is live. That is the whole of "without breaking
 * the core response lifecycle": the admin actions sit AFTER it, never inside
 * it.
 *
 * Archive returning here also closes a hole this panel opened when its old
 * four-button footer was removed: the ticket queue has no archive control and
 * Admin › Reports filters to officer-filed reports, so a resolved
 * RESIDENT-filed report had no manual archive path anywhere in the console.
 */
export default function HazardMapReportDetailsModal({ report, onClose }) {
  const navigate = useNavigate()

  /**
   * The open lightbox, as `{ items, index, watermark }` rather than a bare
   * index into one array.
   *
   * There are two sets of photographs on a resolved call — what the resident
   * sent and what the officer shot at the scene — and they carry DIFFERENT
   * stamps: the resident's are stamped at the report's time and position, the
   * officer's at the resolution's. An index alone cannot say which set it
   * indexes, so the Guardhouse made the resolution tray unclickable instead.
   * This console is the one that signs off on a resolution, so it opens both.
   */
  const [lightbox, setLightbox] = useState(null)

  const { contact, loading: contactLoading } = useReporterContact(report?.reporterUid)
  const { staffIds, badgeByUid } = useStaffAccounts()
  const action = useAdminAction(report?.id)
  const { busy, feedback, run, dismiss } = action

  const panelRef = useRef(null)
  const bodyRef = useRef(null)
  useDialogFocus({ open: Boolean(report), containerRef: panelRef })

  // Per-report view state, reset when the rail is pointed at a different pin.
  // It stays mounted between selections — clicking pin B while pin A is open
  // swaps the content rather than unmounting and remounting — so nothing in
  // here resets on its own.
  //
  // THE SCROLL OFFSET IS PART OF THAT STATE, and was the one piece of it left
  // behind. Reading a resolved call to the bottom and then clicking the next
  // pin opened that call already scrolled past its reporter, its unit and its
  // address, on a panel whose whole first screen is the answer to "what is
  // this". Worse on a short record, where the carried offset is most of it.
  useEffect(() => {
    setLightbox(null)
    bodyRef.current?.scrollTo({ top: 0 })
  }, [report?.id])

  /*
   * Escape closes the modal, unless the Lightbox is up — that owns Escape
   * while it is open, so this defers rather than closing both at once. A write
   * in flight also holds the modal open: closing it would leave the receipt
   * nowhere to land.
   */
  useEffect(() => {
    if (!report || lightbox || busy) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [report, lightbox, busy, onClose])

  const media = useMemo(() => buildMediaItems(report), [report])

  /**
   * ── ONE STAGE, DERIVED, FOR EVERY PART OF THIS PANEL ───────────────────
   * Not `report?.dispatchStage`, which five things on this panel now read.
   * The field survives on documents at the retired `on_site` and
   * `investigating`, neither of which is in `DISPATCH_STAGES`, and the
   * derivation maps both onto `responding`.
   *
   * It happens to be a no-op today — `mapIncidentDoc` already stores
   * `deriveDispatchStage(raw)` in that field, so the Hazard Map never hands
   * this a raw one. Deriving here anyway is what makes that a convenience
   * rather than a dependency: the footer, the badge row, the stepper and two
   * sections all branch on this value, and it is cheaper to derive it once
   * than to hold five readers to an assumption about the caller.
   *
   * Computed before the early return so the hook below it never runs
   * conditionally.
   */
  const stage = deriveDispatchStage(report)
  const ackExpired = useAckExpiry(report, stage)

  if (!report) return null

  const title = report.title || `${categoryLabel(report.category)} report`
  const severity = report.severity ?? 'medium'
  const archived = isArchived(report)
  const reviewed = Boolean(report.reviewedAt)
  const officerFiled = isOfficerFiled(report, staffIds)
  const code = ticketCode(report.id)

  const hasFix = typeof report.lat === 'number' && typeof report.lng === 'number'
  const coordinates = hasFix ? forensicCoordinates(report.lat, report.lng) : ''

  const address = [
    report.phase && `Phase ${report.phase}`,
    report.block && `Block ${report.block}`,
    report.lot && `Lot ${report.lot}`,
  ]
    .filter(Boolean)
    .join(' · ')

  // "Phase 3 • Block 1 • Lot 2" and "Phase 3 · Block 1 · Lot 2" are the same
  // place: `location` is built from the same fields with a different joiner,
  // so a plain !== showed every such report's address twice.
  const sameAddress = (a, b) => {
    const norm = (v) => String(v ?? '').replace(/[\s·•,|]+/g, ' ').trim().toLowerCase()
    return norm(a) === norm(b)
  }
  const extraLocation = report.location && !sameAddress(report.location, address) ? report.location : ''

  const household = normalizeResidentStatus(contact?.verificationStatus ?? contact?.status)
  const reporterInitial = (report.reportedByName || '?').trim().charAt(0).toUpperCase() || '?'

  /**
   * The assigned officer, as this panel is allowed to name them — never the
   * address their account was provisioned with. The staff record is consulted
   * for a badge number the incident document may predate.
   */
  const assigned = report.assignedGuardUid
    ? unitLabel({
        name: report.assignedGuardName,
        badgeNumber: report.assignedGuardBadge || badgeByUid.get(report.assignedGuardUid),
      })
    : null

  const stamp = { at: report.reportedAt, lat: report.lat, lng: report.lng, reference: code }
  const watermark = {
    name: `${code} · ${report.reportedByName ?? 'Unknown resident'}`,
    address: `${address || 'Location not recorded'} · ${forensicCoordinates(report.lat, report.lng)}`,
    timestamp: forensicTimestamp(report.reportedAt),
  }

  const resolutionMedia = (report.resolution?.photoUrls ?? []).map((url) => ({ url, type: 'image' }))
  const resolutionStamp = {
    at: report.resolvedAt,
    lat: report.arrival?.lat ?? report.lat,
    lng: report.arrival?.lng ?? report.lng,
    reference: code,
    label: 'Resolved',
  }
  const outcomeLabel = RESOLUTION_OUTCOMES.find((o) => o.value === report.resolution?.outcome)?.label

  // ── THE FOOTER: THE OVERSIGHT ACTION FOR THIS STAGE ──────────────────────
  const spinner = <Loader2 size="sm" className="animate-spin" aria-hidden="true" />
  let footer = null
  let hint = null

  if (stage === 'resolved') {
    footer = (
      <>
        <button
          type="button"
          disabled={reviewed || Boolean(busy)}
          onClick={() =>
            run('review', 'Resolution verified', () => markReportsReviewed([report.id]))
          }
          className="sheet-btn sheet-btn-primary flex-1"
        >
          {busy === 'review' ? spinner : <ClipboardCheck size="sm" aria-hidden="true" />}
          {reviewed ? 'Resolution verified' : 'Verify resolution'}
        </button>
        {!archived ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run('archive', 'Incident archived', () => archiveIncidents([report.id]))}
            className="sheet-btn sheet-btn-outline"
          >
            {busy === 'archive' ? spinner : <Archive size="sm" aria-hidden="true" />}
            Archive
          </button>
        ) : null}
      </>
    )
    hint = reviewed
      ? `Verified by ${report.reviewedByName || 'an administrator'}${
          archived ? ', and archived' : ''
        }. Archiving is reversible from Audit History.`
      : `Resolved at ${clock(report.resolvedAt)} by ${
          report.resolvedByName || 'security'
        }. Verifying stamps your sign-off on the record; archiving takes it off the active backlog.`
  } else {
    /* The one control before the call closes, and it writes nothing: the full
       ticket record, where the queue's own detail view carries the history,
       the documents and the PDF export this rail does not. */
    footer = (
      <button
        type="button"
        onClick={() => navigate(`${ROUTES.tickets}?incident=${report.id}`)}
        className="sheet-btn sheet-btn-primary flex-1"
      >
        <ExternalLink size="sm" aria-hidden="true" />
        Open full ticket record
      </button>
    )
    hint =
      stage === 'none'
        ? 'Nobody is on this call yet. Dispatch belongs to the Guardhouse — this console cannot assign a unit.'
        : stage === 'dispatched'
          ? ackExpired
            ? `${assigned?.label ?? 'The assigned unit'} has not acknowledged within ${
                ACK_TIMEOUT_MS / 1000
              } s. The Guardhouse has been alerted and is the only console that can reassign.`
            : `${assigned?.label ?? 'The assigned unit'} was alerted at ${clock(
                report.dispatchedAt,
              )} and has ${ACK_TIMEOUT_MS / 1000} s to acknowledge.`
          : report.onSceneAt
            ? `${assigned?.label ?? 'The assigned unit'} has been on scene since ${clock(
                report.onSceneAt,
              )}. Verification and archiving unlock once the call is resolved.`
            : `${assigned?.label ?? 'The assigned unit'} is en route. Verification and archiving unlock once the call is resolved.`
  }

  const CategoryGlyph = categoryIcon(normalizeCategory(report.category))
  const categoryHex = categoryColor(normalizeCategory(report.category))
  const CARD = 'rounded-xl border border-hairline bg-base-900/60 p-4'

  return (
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={() => {
        if (!busy) onClose()
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hazard-report-title"
        onClick={(event) => event.stopPropagation()}
        className="dialog-panel flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl shadow-black/90 sm:max-h-[92vh] sm:rounded-2xl"
      >
        {/* ══ HEADER (fixed): category tile, title, code and report time ══ */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline bg-base-900/95 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3.5">
            {/* The category's own colour: tinted fill and a matching edge. */}
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-inner"
              style={{ color: categoryHex, backgroundColor: `${categoryHex}1a`, borderColor: `${categoryHex}33` }}
            >
              <CategoryGlyph size={20} />
            </span>
            <div className="min-w-0">
              <h2 id="hazard-report-title" className="truncate text-base font-bold tracking-tight text-text-primary">
                {title}
              </h2>
              <p className="mt-0.5 font-mono text-xs text-text-muted">
                {code}
                {report.reportedAt ? ` • Reported ${clock(report.reportedAt)}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            aria-label="Close report details"
            className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </header>

        {/* ══ BODY (the one scroll region) ══ */}
        <div ref={bodyRef} className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain bg-base-950/40 p-6">
          {/* ── BADGES & PRIORITY ── plus the exceptional states. */}
          <div className="flex flex-wrap items-center gap-2">
            {stage === 'none' ? (
              <Pill tone="warning" icon={Radio}>
                Unassigned
              </Pill>
            ) : null}
            <Pill tone={categoryTone(report.category)}>{categoryLabel(report.category)}</Pill>
            <Pill tone={SEVERITY_TONES[severity] ?? 'warning'} pulse={stage !== 'resolved'}>
              {SEVERITY_LABELS[severity] ?? 'Medium'} priority
            </Pill>
            {ackExpired ? (
              <Pill tone="danger" icon={Timer}>
                No acknowledgement
              </Pill>
            ) : null}
            {report.escalation ? (
              <Pill tone="danger" icon={AlertOctagon}>
                Escalated
              </Pill>
            ) : null}
            {archived ? (
              <Pill tone="neutral" icon={Archive}>
                Archived
              </Pill>
            ) : null}
          </div>

          {/* ── PROGRESS STEPPER ── Dispatched → Responding → Resolved, the same
              component and derived stage as the Guardhouse's drawer. */}
          <div className="rounded-xl border border-hairline bg-base-900/80 p-4">
            <StageStepper report={report} stage={stage} />
          </div>

          {/* ── REPORTER ── */}
          <section className={`${CARD} flex items-center gap-3.5`} aria-label={officerFiled ? 'Filed by officer' : 'Reporter'}>
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/10 text-sm font-bold text-brand-500"
            >
              {reporterInitial}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-bold tracking-tight text-text-primary">
                  {report.reportedByName || 'Unknown reporter'}
                </h3>
                {/* Whether an administrator has confirmed this resident owns or
                    occupies the lot. Not a verified phone number. */}
                {officerFiled ? (
                  <Pill tone="neutral" icon={IdCard}>Security officer</Pill>
                ) : contactLoading ? (
                  <span className="text-[11px] text-text-muted">Looking up…</span>
                ) : household === RESIDENT_STATUS.verified ? (
                  <Pill tone="success" icon={BadgeCheck}>Verified</Pill>
                ) : household === RESIDENT_STATUS.rejected ? (
                  <Pill tone="danger" icon={ShieldX}>{RESIDENT_STATUS_LABELS[household]}</Pill>
                ) : (
                  <Pill tone="warning" icon={Clock}>{RESIDENT_STATUS_LABELS[household]}</Pill>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-text-muted">
                {exactTime(report.reportedAt) || 'Time unavailable'}
                {/* The relative time only while it IS relative: past a week
                    relativeTime falls back to a plain date. */}
                {report.reportedAt && /ago|now|Yesterday/i.test(relativeTime(report.reportedAt))
                  ? ` · ${relativeTime(report.reportedAt)}`
                  : ''}
              </p>
            </div>
          </section>

          {/* ── ASSIGNED UNIT ── only when somebody is on the call; the
              unassigned case is the amber badge above. */}
          {assigned ? (
            <section className={`${CARD} space-y-2`}>
              <SectionTitle icon={ShieldCheck}>Assigned unit</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={stage === 'resolved' ? 'neutral' : 'success'} pulse={stage !== 'resolved'} icon={stage === 'resolved' ? UserRoundCheck : null}>
                  {assigned.label}
                </Pill>
                {assigned.badge && !assigned.label.includes(assigned.badge) ? (
                  <Pill tone="neutral" className="font-mono">
                    {assigned.badge}
                  </Pill>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* ── LOCATION TELEMETRY ── */}
          <section className={`${CARD} space-y-3`}>
            <div className="border-b border-hairline pb-2.5">
              <SectionTitle icon={MapPin}>Location telemetry</SectionTitle>
            </div>
            <dl className="space-y-2.5 text-xs">
              <LocationRow label="Address">
                {(address || report.location || '').replaceAll(' · ', ' • ') || '—'}
              </LocationRow>
              {/* Only when it says something the address does not. */}
              {extraLocation ? <LocationRow label="Reported at">{extraLocation}</LocationRow> : null}
              <LocationRow label="Coordinates" mono>
                {coordinates ? <span className="select-all">{coordinates}</span> : '—'}
              </LocationRow>
            </dl>
          </section>

          {/* ── WHAT THE RESIDENT SENT ── the narrative and the photos as one
              submission. Photos often land after the text: while the document
              says media is coming (`hasMedia`) and no URL has arrived, the
              uploading line shows; the next snapshot swaps in the evidence. */}
          <section className={`${CARD} space-y-3`}>
            <div className="border-b border-hairline pb-2.5">
              <SectionTitle
                icon={FileText}
                action={
                  media.length ? (
                    <Pill tone="neutral" className="font-mono">
                      {media.length} file{media.length === 1 ? '' : 's'}
                    </Pill>
                  ) : null
                }
              >
                Reported description
              </SectionTitle>
            </div>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-base-950 p-3 font-mono text-xs leading-relaxed text-text-secondary">
              {report.description || 'The resident submitted no written description.'}
            </p>
            {media.length ? (
              <div className="max-w-sm">
                <EvidenceGrid
                  media={media}
                  stamp={stamp}
                  onOpen={(index) => setLightbox({ items: media, index, watermark })}
                  emptyText=""
                />
              </div>
            ) : report.hasMedia ? (
              <p role="status" className="flex items-center gap-2 text-xs font-medium text-text-muted">
                <Loader2 size="sm" className="animate-[spin_1.5s_linear_infinite]" aria-hidden="true" />
                Media still uploading…
              </p>
            ) : null}
          </section>

          {/* ── RESOLUTION ── once the Guardhouse closes the call. */}
          {stage === 'resolved' && report.resolution ? (
            <section className={`${CARD} space-y-3`}>
              <div className="border-b border-hairline pb-2.5">
                <SectionTitle
                  icon={ClipboardList}
                  action={outcomeLabel ? <Pill tone="success">{outcomeLabel}</Pill> : null}
                >
                  Resolution
                </SectionTitle>
              </div>
              <p className="whitespace-pre-wrap break-words rounded-lg border border-hairline bg-base-950 p-3 font-mono text-xs leading-relaxed text-text-secondary">
                {report.resolution.notes}
              </p>
              {resolutionMedia.length ? (
                <div className="max-w-sm">
                  <EvidenceGrid
                    media={resolutionMedia}
                    stamp={resolutionStamp}
                    onOpen={(index) =>
                      setLightbox({
                        items: resolutionMedia,
                        index,
                        watermark: {
                          name: `${code} · resolution evidence`,
                          address: `${address || 'Location not recorded'} · ${forensicCoordinates(
                            resolutionStamp.lat,
                            resolutionStamp.lng,
                          )}`,
                          timestamp: forensicTimestamp(report.resolvedAt),
                        },
                      })
                    }
                    emptyText=""
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        {/* ══ FOOTER (fixed): the action for this stage, Close, and the note
            saying what this console may and may not do. ══ */}
        <footer className="shrink-0 space-y-3 border-t border-hairline bg-base-950 px-6 py-4">
          {feedback ? <Receipt feedback={feedback} onDismiss={dismiss} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            {footer}
            <button type="button" onClick={onClose} disabled={Boolean(busy)} className="sheet-btn sheet-btn-outline">
              Close
            </button>
          </div>
          {hint ? <p className="text-center font-mono text-[10px] leading-relaxed text-text-muted">{hint}</p> : null}
        </footer>
      </div>

      {lightbox ? (
        <Lightbox
          media={lightbox.items}
          startIndex={lightbox.index}
          watermark={lightbox.watermark}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  )
}
