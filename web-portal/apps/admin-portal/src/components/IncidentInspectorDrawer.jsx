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
  ShieldX,
  Timer,
  UserRoundCheck,
  X,
} from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
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

/**
 * Width of the desktop rail, in px, exported so the Hazard Map can tell
 * IncidentMap how much of its right edge is spoken for. It IS this component's
 * `lg:w-[28rem]` (the reference's `max-w-md`). It was 416px to match the
 * Guardhouse's DispatchDetailDrawer; the redesign widened this rail only. Two places holding
 * this number independently is how a centred marker ends up underneath the
 * panel that was opened to describe it.
 */
export const DRAWER_WIDTH_PX = 448

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

// Tags are the shared oblong Pill — the same shape on every Hazard Map modal
// (user's request, 2026-10-18). MiniTag is its one-step-down size, inline
// beside the reporter's name.
const Tag = Pill
const MiniTag = (props) => <Pill size="sm" {...props} />

/** Section label: a muted glyph and 11px tracked caps, with an optional right-hand note. */
function SectionTitle({ icon: Icon, action = null, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon size="sm" className="text-text-muted" aria-hidden="true" />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted">{children}</h3>
      </div>
      {action}
    </div>
  )
}

/** One label/value line inside the location container: a 100px label column. */
function LocationRow({ label, children }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-baseline gap-2">
      <dt className="text-[11px] font-bold uppercase tracking-widest text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
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
 * ── THE HAZARD MAP'S INSPECTION PANEL ──────────────────────────────────────
 *
 *   ┌ [icon] Break-in attempt at the side gate               [×] ┐
 *   │        MV-A1B2C3D4 · Reported 10:16                        │
 *   │ [Unassigned — awaiting dispatch] [Security] [High priority]│
 *   │          ●───────◉───────○                                 │
 *   │       Dispatched Responding Resolved                       │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ REPORTER        who filed it, and whether they are verified│
 *   │ ASSIGNED UNIT   the unit, or one badge saying nobody is    │
 *   │ LOCATION        address, coordinates                       │
 *   │ REPORTED …      the narrative AND the photos, one card     │
 *   │ RESOLUTION      outcome, notes, photos (once closed)       │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ [ the oversight action for this stage ]            pinned  │
 *   └────────────────────────────────────────────────────────────┘
 *
 * A RAIL, NOT A CENTRED MODAL. The Hazard Map used the shared
 * `IncidentDetailModal`, which is the right shape on the ticket queue — a table
 * row has nothing behind it worth preserving — and the wrong one here. A dialog
 * over a scrim blanks the map, so the one thing that makes a pin mean anything
 * (what is AROUND it: the other pins on that street, the phase it sits in, how
 * far it is from the gate) disappears at the exact moment someone asks about
 * it. A rail down one edge keeps the map live, leaves the camera free to slide
 * the marker clear of it, and lets an administrator click the next pin without
 * closing anything first.
 *
 * Below `lg` it is a bottom sheet instead, for the reason the shared modal
 * gives: a 416px rail on a 375px phone is the whole screen with none of a
 * sheet's affordances.
 *
 * The shared modal is UNTOUCHED and still serves the Admin ticket queue and the
 * Guard triage queue. This panel exists because the map wants different things
 * on screen, not because the modal was wrong where it already was.
 *
 * ── ONE PANEL, TWO CONSOLES, ONE VOCABULARY ────────────────────────────────
 * This rail and the Guardhouse's DispatchDetailDrawer describe the same
 * document at the same width, and they had drifted into describing it
 * differently in every way a reader would notice:
 *
 *   • The pipeline. Three stages drawn here in a `grid-cols-5` built for the
 *     five-stage machine — left-weighted, with the connectors reaching across
 *     two empty columns — against a centred flex row there. The two consoles
 *     drew the same three facts as two different objects. Both are now
 *     `@shared/components/dispatch/StageStepper`, driven by one derived
 *     `stage`.
 *
 *   • The submission. The resident's sentence and the resident's photos were
 *     two groups with two headers here and one card there. They are one
 *     submission — typed and attached in the same breath, about the same thing
 *     — and the photos frequently ARRIVE after the text, so two cards meant
 *     two separate claims about one report with the reader left to join them.
 *
 *   • The evidence itself. A bare `grid-cols-3` of square tiles here against
 *     the stamped two-up grid there, which means the same photograph carried
 *     its time, position and incident code for an officer and carried none of
 *     them for the administrator who exports the record.
 *
 *   • The assigned unit. `report.assignedGuardName` printed raw into an
 *     "Assigned to" row, which on an email-provisioned account prints
 *     `guard.test@…` onto a screen shared in a meeting — and an em-dash when
 *     nobody is on the call at all, which reads as a missing field rather than
 *     as the fact it is.
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
export default function IncidentInspectorDrawer({ report, onClose }) {
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
   * Escape closes the rail, unless the Lightbox is up — that owns Escape while
   * it is open, so this defers rather than closing both at once and dumping the
   * operator back to a bare map from a full-screen photo. A write in flight
   * also holds the rail open: closing it would leave the receipt nowhere to
   * land.
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

  return (
    <div className="pointer-events-none fixed inset-0 z-[var(--z-modal)] flex items-end justify-end lg:items-stretch">
      {/* Scrim BELOW `lg` only. On a desktop the map behind this rail is still
          the thing being read — dimming or blurring it would undo the whole
          reason this is a rail — and the camera has already slid the marker
          clear of it. On a phone the sheet covers the map anyway. */}
      <div
        className="dialog-scrim pointer-events-auto absolute inset-0 bg-black/50 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        role="presentation"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Incident ${code}`}
        className="pointer-events-auto relative flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-[-30px_0_60px_-15px_rgba(0,0,0,0.8)] animate-[riseIn_220ms_var(--ease-spring)] lg:h-full lg:w-[28rem] lg:animate-[drawerInRight_260ms_var(--ease-spring)] lg:rounded-none lg:border-y-0 lg:border-r-0 dark:bg-base-950"
      >
        {/* Grab handle (phone sheet only). */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close incident details"
          className="flex h-6 shrink-0 items-center justify-center pt-2 lg:hidden"
        >
          <span className="h-1 w-9 rounded-full bg-tint/25" />
        </button>

        {/* ══ STICKY HEADER ══ what it is, its code, and where the response
            stands: the category tile, the tags, then the 3-step pipeline. */}
        <header className="relative z-20 shrink-0 border-b border-hairline bg-base-900/95 px-6 pb-6 pt-6 backdrop-blur-md sm:px-8 lg:pt-8 dark:bg-base-950/95">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close incident details"
            className="absolute right-6 top-6 rounded-md p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:right-8 lg:top-8"
          >
            <X size="md" />
          </button>

          <div className="flex items-start gap-4 pr-10">
            {/* The category's own colour, as the reference's rose tile is for
                Medical: tinted fill, a matching edge and a soft glow. */}
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
              style={{
                color: categoryHex,
                backgroundColor: `${categoryHex}1a`,
                borderColor: `${categoryHex}33`,
                boxShadow: `0 0 15px -3px ${categoryHex}26`,
              }}
            >
              <CategoryGlyph size="md" />
            </span>
            <div className="flex min-w-0 flex-col pt-0.5">
              <h2 className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight text-text-primary">{title}</h2>
              <p className="mt-0.5 text-[13px] font-medium text-text-secondary">
                <span className="font-mono">{code}</span>
                {report.reportedAt ? (
                  <>
                    <span aria-hidden="true" className="mx-1.5 opacity-40">•</span>
                    Reported {clock(report.reportedAt)}
                  </>
                ) : null}
              </p>
            </div>
          </div>

          {/* ── TAGS ── unassigned state, category, priority, and the
              exceptional states (no acknowledgement, escalated, archived). */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {stage === 'none' ? (
              <Tag tone="warning" icon={Radio}>
                Unassigned
              </Tag>
            ) : null}
            <Tag tone={categoryTone(report.category)}>{categoryLabel(report.category)}</Tag>
            <Tag tone={SEVERITY_TONES[severity] ?? 'warning'} pulse={severity === 'critical'}>
              {SEVERITY_LABELS[severity] ?? 'Medium'} priority
            </Tag>
            {ackExpired ? (
              <Tag tone="danger" icon={Timer}>
                No acknowledgement
              </Tag>
            ) : null}
            {report.escalation ? (
              <Tag tone="danger" icon={AlertOctagon}>
                Escalated
              </Tag>
            ) : null}
            {archived ? (
              <Tag tone="neutral" icon={Archive}>
                Archived
              </Tag>
            ) : null}
          </div>

          {/* ── THE 3-STEP LIFECYCLE ── Dispatched → Responding → Resolved, the
              same component and derived stage as the Guardhouse's drawer. */}
          <div className="mt-6">
            <StageStepper report={report} stage={stage} />
          </div>
        </header>

        {/* ══ BODY ══ borderless sections on the panel itself. The one scroll
            region; the scrollbar is hidden per the reference. */}
        <div
          ref={bodyRef}
          className="hide-scrollbar min-h-0 flex-1 space-y-10 overflow-y-auto overscroll-contain px-6 py-8 sm:px-8"
        >
          {/* ── REPORTER ── */}
          <section className="flex items-center gap-4" aria-label={officerFiled ? 'Filed by officer' : 'Reporter'}>
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-500/20 bg-brand-500/10 text-[15px] font-semibold text-brand-500"
            >
              {reporterInitial}
            </span>
            <div className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="truncate text-[15px] font-semibold text-text-primary">
                  {report.reportedByName || 'Unknown reporter'}
                </span>
                {/* Whether an administrator has confirmed this resident owns or
                    occupies the lot. Not a verified phone number. */}
                {officerFiled ? (
                  <MiniTag tone="neutral" icon={IdCard}>Security officer</MiniTag>
                ) : contactLoading ? (
                  <span className="text-[11px] text-text-muted">Looking up…</span>
                ) : household === RESIDENT_STATUS.verified ? (
                  <MiniTag tone="success" icon={BadgeCheck}>Verified</MiniTag>
                ) : household === RESIDENT_STATUS.rejected ? (
                  <MiniTag tone="danger" icon={ShieldX}>{RESIDENT_STATUS_LABELS[household]}</MiniTag>
                ) : (
                  <MiniTag tone="warning" icon={Clock}>{RESIDENT_STATUS_LABELS[household]}</MiniTag>
                )}
              </div>
              <span className="mt-1 text-[13px] font-medium text-text-muted">
                {exactTime(report.reportedAt) || 'Time unavailable'}
                {/* The relative time only while it IS relative: past a week
                    relativeTime falls back to a plain date, which beside the
                    exact time above just printed the date twice. */}
                {report.reportedAt && /ago|now|Yesterday/i.test(relativeTime(report.reportedAt))
                  ? ` · ${relativeTime(report.reportedAt)}`
                  : ''}
              </span>
            </div>
          </section>

          {/* ── ASSIGNED UNIT ── only when somebody is on the call; the
              unassigned case is the amber tag in the header. */}
          {assigned ? (
            <section className="space-y-3">
              <SectionTitle icon={Radio}>Assigned unit</SectionTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone="info" size="sm" icon={UserRoundCheck}>
                  {assigned.label}
                </StatusBadge>
                {assigned.badge ? (
                  <StatusBadge tone="neutral" size="sm">
                    Badge {assigned.badge}
                  </StatusBadge>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* ── LOCATION ── */}
          <section className="space-y-3">
            <SectionTitle icon={MapPin}>Location</SectionTitle>
            <dl className="flex flex-col gap-4 rounded-xl border border-hairline bg-base-800/60 p-5 dark:bg-base-900/40">
              <LocationRow label="Address">
                <span className="text-[14px] font-semibold text-text-primary">
                  {(address || report.location || '').replaceAll(' · ', ' • ') || '—'}
                </span>
              </LocationRow>
              {/* Only when it says something the address does not. */}
              {report.location && report.location !== address ? (
                <LocationRow label="Reported at">
                  <span className="text-[14px] text-text-primary">{report.location}</span>
                </LocationRow>
              ) : null}
              <LocationRow label="Coordinates">
                <span className="select-all font-mono text-[13px] text-text-secondary">{coordinates || '—'}</span>
              </LocationRow>
            </dl>
          </section>

          {/* ── WHAT THE RESIDENT SENT ── the narrative and the photos as one
              submission. Photos often land after the text: while the document
              says media is coming (`hasMedia`) and no URL has arrived, the
              uploading line shows; the next snapshot that carries URLs swaps
              it for the stamped, clickable evidence grid. */}
          <section className="space-y-4">
            <SectionTitle
              icon={FileText}
              action={
                media.length ? (
                  <span className="text-[12px] font-medium text-text-muted">
                    {media.length} file{media.length === 1 ? '' : 's'}
                  </span>
                ) : null
              }
            >
              Reported description
            </SectionTitle>
            {report.description ? (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary">
                {report.description}
              </p>
            ) : (
              <p className="text-[15px] text-text-muted">The resident submitted no written description.</p>
            )}

            {media.length ? (
              <div className="pt-2">
                <EvidenceGrid
                  media={media}
                  stamp={stamp}
                  onOpen={(index) => setLightbox({ items: media, index, watermark })}
                  emptyText=""
                />
              </div>
            ) : report.hasMedia ? (
              <p role="status" className="flex items-center gap-3 pt-2 text-[13px] font-medium text-text-muted">
                <Loader2 size="sm" className="animate-[spin_1.5s_linear_infinite]" aria-hidden="true" />
                Media still uploading…
              </p>
            ) : null}
          </section>

          {/* ── RESOLUTION ── once the Guardhouse closes the call. */}
          {stage === 'resolved' && report.resolution ? (
            <section className="space-y-4">
              <SectionTitle
                icon={ClipboardList}
                action={
                  outcomeLabel ? <span className="text-[12px] font-medium text-text-muted">{outcomeLabel}</span> : null
                }
              >
                Resolution
              </SectionTitle>
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary">
                {report.resolution.notes}
              </p>
              {resolutionMedia.length ? (
                <div className="pt-2">
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

        {/* ══ STICKY FOOTER ══ the one action the stage calls for, Close last,
            and the helper note saying what this console may and may not do. */}
        <footer className="relative z-20 shrink-0 border-t border-hairline bg-base-900/90 px-6 py-6 backdrop-blur-md sm:px-8 dark:bg-base-950/90">
          {feedback ? <Receipt feedback={feedback} onDismiss={dismiss} /> : null}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {footer}
            <button type="button" onClick={onClose} className="sheet-btn sheet-btn-outline">
              <X size="sm" className="opacity-70" aria-hidden="true" />
              Close
            </button>
          </div>
          {hint ? <p className="text-center text-[12px] leading-relaxed text-text-muted">{hint}</p> : null}
        </footer>
      </aside>

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
