import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertOctagon,
  Archive,
  BadgeCheck,
  ClipboardCheck,
  ClipboardList,
  FileText,
  IdCard,
  Loader2,
  MapPin,
  Radio,
  ShieldQuestion,
  ShieldX,
  Ticket,
  Timer,
  User,
  UserRoundCheck,
  X,
} from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import Lightbox from '@shared/components/Lightbox'
import CategoryIconBadge from '@shared/components/dispatch/CategoryIconBadge'
import StageStepper from '@shared/components/dispatch/StageStepper'
import Receipt from '@shared/components/dispatch/Receipt'
import EvidenceGrid, {
  forensicCoordinates,
  forensicTimestamp,
} from '@shared/components/dispatch/EvidenceGrid'
import { MetaItem, MetaList } from '@shared/components/MetaList'
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
import { categoryLabel } from '@shared/lib/incidentCategories'
import { categoryTone } from '@shared/theme/badgeStyles'
import { relativeTime } from '@shared/lib/notifications'
import {
  ACK_TIMEOUT_MS,
  deriveDispatchStage,
  RESOLUTION_OUTCOMES,
} from '@shared/lib/dispatchStage'
import { unitLabel } from '@shared/lib/unitIdentity'
import { normalizeResidentStatus, RESIDENT_STATUS, RESIDENT_STATUS_LABELS } from '@shared/lib/residents'
import { ROUTES } from '@/config/portal'

/**
 * Width of the desktop rail, in px, exported so the Hazard Map can tell
 * IncidentMap how much of its right edge is spoken for. It IS this component's
 * `lg:w-[26rem]`, and matches the Guardhouse's DispatchDetailDrawer so the two
 * consoles' panels are the same object at the same size. Two places holding
 * this number independently is how a centred marker ends up underneath the
 * panel that was opened to describe it.
 */
export const DRAWER_WIDTH_PX = 416

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
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const CLOCK = { hour: '2-digit', minute: '2-digit', hour12: false }
const clock = (at) => (at ? new Date(at).toLocaleTimeString('en-GB', CLOCK) : '—')

/**
 * One titled group inside the unified inspection card.
 *
 * This is MetaSection's header with the panel taken away: inside a single
 * divided surface the per-group border, background and rounding are exactly
 * the chrome the merge set out to remove, but the icon + 14px semibold title
 * is what still tells two groups apart at a glance.
 *
 * `p-6` by request and because the rail earns it — measured at 416px the
 * coordinate row, the narrowest thing here, still holds one line.
 */
function Group({ icon: Icon, title, action, children }) {
  return (
    <div className="p-6">
      <header className="mb-4 flex min-h-6 items-center justify-between gap-3">
        <h3 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-text-primary">
          {Icon ? <Icon size="sm" className="shrink-0 text-brand-400" /> : null}
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </header>
      {children}
    </div>
  )
}

/**
 * The key/value treatment for this rail: 12px uppercase labels on wide
 * tracking against semibold values, by request.
 *
 * Applied with child selectors on the <dl> rather than by editing
 * `.meta-label`, which four other detail views share and which deliberately
 * sets labels at the SAME 14px as their values — see the note in
 * shared/components/MetaList.jsx. This rail opts out; nothing else moves.
 *
 * The tradeoff is real and worth stating: 12px uppercase on wide tracking is
 * a weaker read than 14px sentence case, and it is the label — the word naming
 * the fact — that pays. It buys a sharper value column, which is the B2B
 * convention this panel was asked for.
 */
const META =
  '[&>dt]:text-xs [&>dt]:uppercase [&>dt]:tracking-wider [&>dt]:text-text-muted [&>dd]:font-semibold'

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
      setFeedback({ tone: 'success', text: `${label}.` })
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
export default function IncidentInspectorDrawer({ report, units = [], onClose }) {
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
  const { staffIds } = useStaffAccounts()
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
   * address their account was provisioned with. The live fleet is consulted
   * for a badge number the incident document may predate.
   */
  const assignedUnit = report.assignedGuardUid
    ? units.find((u) => u.uid === report.assignedGuardUid) ?? null
    : null
  const assigned = report.assignedGuardUid
    ? unitLabel({
        name: report.assignedGuardName,
        badgeNumber: report.assignedGuardBadge || assignedUnit?.badgeNumber,
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
          className="btn btn-action btn-brand"
        >
          {busy === 'review' ? spinner : <ClipboardCheck size="sm" aria-hidden="true" />}
          {reviewed ? 'Resolution verified' : 'Verify resolution'}
        </button>
        {!archived ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run('archive', 'Incident archived', () => archiveIncidents([report.id]))}
            className="btn btn-action btn-outline"
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
        className="btn btn-action btn-outline"
      >
        <Ticket size="sm" aria-hidden="true" />
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

  return (
    <div className="pointer-events-none fixed inset-0 z-[var(--z-modal)] flex items-end justify-end lg:items-stretch">
      {/* Scrim BELOW `lg` only. On a desktop the map behind this rail is still
          the thing being read — dimming it would undo the whole reason this is
          a rail — and the camera has already slid the marker clear of it. On a
          phone the sheet covers the map anyway, so the scrim is what makes the
          strip above it read as a way out. */}
      <div
        className="dialog-scrim pointer-events-auto absolute inset-0 bg-scrim lg:hidden"
        onClick={onClose}
        role="presentation"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Incident ${code}`}
        className="pointer-events-auto relative flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-xl border border-hairline bg-base-900 shadow-modal animate-[riseIn_220ms_var(--ease-spring)] lg:h-full lg:w-[26rem] lg:animate-[drawerInRight_260ms_var(--ease-spring)] lg:rounded-none lg:border-y-0 lg:border-r-0"
      >
        {/* Grab handle — the affordance that says "this sheet dismisses", and a
            tap target for it. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close incident details"
          className="flex h-6 shrink-0 items-center justify-center pt-2 lg:hidden"
        >
          <span className="h-1 w-9 rounded-full bg-tint/25" />
        </button>

        {/* ══ HEADER ══ what this is, its quotable code, how urgent, and where
            in the response it stands — the Guardhouse's header, group for
            group, so an administrator and a dispatcher looking at the same
            call see the same four things in the same order. */}
        <header className="shrink-0 border-b border-hairline px-4 pb-3 pt-3.5">
          <div className="flex items-start gap-3">
            <CategoryIconBadge category={report.category} />
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-base font-semibold leading-snug text-text-primary">{title}</h2>
              <p className="mt-0.5 text-caption text-text-muted">
                <span className="font-mono font-semibold text-text-secondary">{code}</span>
                {report.reportedAt ? ` · Reported ${clock(report.reportedAt)}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close incident details"
              className="icon-btn icon-btn-sm -mr-1.5 -mt-1 shrink-0"
            >
              <X size="sm" />
            </button>
          </div>

          {/* ── THE PILL ROW ───────────────────────────────────────────────
              What KIND of call and how urgent — the two questions a badge is
              good at and a stepper is not. Both were a plain sentence and a
              bare severity word inside the card below; as pills in the header
              they are the same objects, in the same tones, that the Guardhouse
              and the incident tables already draw.

              THE WIRE-STATUS PILL IS GONE. It read "Pending" / "Dispatched" /
              "Resolved" directly above a three-step pipeline that spells the
              same fact out in labelled steps WITH the time each was reached —
              and worse, it could disagree with the pipeline, because `status`
              and `dispatchStage` are two fields and a legacy document carries
              `in_progress` under a stage of `responding`. One of them had to
              be the panel's answer. The pipeline is the better one: it is the
              fact the Guardhouse writes, and it shows the whole arc rather
              than one word of it.

              `archived` moved up here from the reporter banner, where being
              archived was never a property of the person who filed it. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {/* ── NOBODY IS ON THIS CALL ──────────────────────────────────
                The one stage the pipeline understates. Steps 2 and 3 are
                plainly ahead of you, but step 1 not having happened looks the
                same as step 1 being in progress at a glance — both are "the
                first node is not filled in". So the header says it in words,
                in the Guardhouse's words, rather than leaving an em-dash in an
                "Assigned to" row to imply it. */}
            {stage === 'none' ? (
              <StatusBadge tone="warning" size="sm" icon={Radio}>
                Unassigned — awaiting dispatch
              </StatusBadge>
            ) : null}
            <StatusBadge tone={categoryTone(report.category)} size="sm">
              {categoryLabel(report.category)}
            </StatusBadge>
            <StatusBadge severity={severity} size="sm">
              {SEVERITY_LABELS[severity] ?? 'Medium'} priority
            </StatusBadge>
            {ackExpired ? (
              <StatusBadge tone="danger" size="sm" icon={Timer}>
                No acknowledgement
              </StatusBadge>
            ) : null}
            {report.escalation ? (
              <StatusBadge tone="danger" size="sm" icon={AlertOctagon}>
                Escalated
              </StatusBadge>
            ) : null}
            {archived ? (
              <StatusBadge tone="neutral" size="sm" icon={Archive}>
                Archived
              </StatusBadge>
            ) : null}
          </div>

          {/* ── THE PIPELINE, CENTRED ──────────────────────────────────────
              In the header rather than three groups down the card, and centred
              rather than strung across a five-column grid built for a machine
              that has two fewer stages than it used to. Same component, same
              geometry and same derived stage as the Guardhouse's. */}
          <div className="mt-3">
            <StageStepper report={report} stage={stage} />
          </div>
        </header>

        {/* ══ ONE CARD ═══════════════════════════════════════════════════
            One surface divided by hairlines rather than five bordered cards
            stacked in a 416px column. `divide-y` rather than a border on each
            child, so there is no doubled rule where two groups meet and no
            leading rule under the header; `overflow-hidden` keeps the dividers
            inside the rounded corners.

            ── WHY THERE IS STILL EXACTLY ONE SCROLLBAR ────────────────────
            The <aside> is height-bounded (`h-[88dvh]`, `lg:h-full`) and is a
            flex column; THIS div is the only `overflow-y-auto` in the panel
            and takes `min-h-0 flex-1`, which is what lets a flex child shrink
            below its content and scroll instead of pushing the panel taller.
            That is already the "fits the viewport, no double scrollbar"
            behaviour — a `max-h-[calc(100vh-80px)]` on top of a parent that
            is exactly 100vh would simply strand 80px of empty rail under the
            card, so the bound stays on the panel where it belongs. */}
        <div ref={bodyRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <section className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-base-800">
            {/* ── 1. REPORTER PROFILE ───────────────────────────────────
                Who filed it, answered before anything else on the card. The
                name is the only `text-base` on the surface and the only bold
                weight, so it wins the first fixation; everything below it is
                14px or smaller. */}
            <Group icon={officerFiled ? IdCard : User} title={officerFiled ? 'Filed by officer' : 'Reporter'}>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-400 ring-1 ring-inset ring-brand-500/25"
                >
                  {reporterInitial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold leading-tight text-text-primary">
                    {report.reportedByName || 'Unknown reporter'}
                  </p>

                  {/* The verification badge, which is the whole reason this
                      block is a banner and not another key/value row. It
                      states whether an administrator has confirmed the
                      resident owns or occupies the lot. It is NOT a verified
                      phone number — nothing here sends a code to a handset. */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {officerFiled ? (
                      <StatusBadge tone="neutral" size="sm" icon={IdCard}>
                        Security officer
                      </StatusBadge>
                    ) : contactLoading ? (
                      <span className="text-2xs text-text-muted">{'Looking up…'}</span>
                    ) : household === RESIDENT_STATUS.verified ? (
                      <StatusBadge tone="success" size="sm" icon={BadgeCheck}>
                        Verified resident
                      </StatusBadge>
                    ) : household === RESIDENT_STATUS.rejected ? (
                      <StatusBadge tone="danger" size="sm" icon={ShieldX}>
                        {RESIDENT_STATUS_LABELS[household]}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="warning" size="sm" icon={ShieldQuestion}>
                        {RESIDENT_STATUS_LABELS[household]}
                      </StatusBadge>
                    )}
                  </div>

                  {/* Both times, one line. "14 minutes ago" is what an
                      operator reasons with; the timestamp is what they quote
                      into a log. A record needs both. */}
                  <p className="mt-2 text-2xs leading-relaxed text-text-muted">
                    {exactTime(report.reportedAt) || 'Time unavailable'}
                    {report.reportedAt ? ` · ${relativeTime(report.reportedAt)}` : ''}
                  </p>
                </div>
              </div>
            </Group>

            {/* ── 2. WHO IS ON IT ───────────────────────────────────────
                ── NO MORE "ASSIGNED TO: —" ────────────────────────────────
                This was a key/value row printing `report.assignedGuardName`
                raw. It failed at both ends: with nobody on the call it drew an
                em-dash, which reads as a field the console failed to load
                rather than as the most important fact on the panel; and with
                somebody on it, it printed whatever is in `staff_accounts.name`
                — frequently the address the account was provisioned with — on
                a screen an administrator shares in a meeting.

                A badge instead, from `unitLabel` — the same derivation the
                Guardhouse's unit picker and drawer use, so the officer is
                named identically in both consoles.

                ── AND NO GROUP AT ALL WHEN NOBODY IS ON IT ────────────────
                The unassigned case is stated ONCE, as the amber badge in the
                header, where it sits beside the other two facts a reader
                scans for before anything else. Drawn here as well it was the
                same badge with the same words twice in one viewport, 300px
                apart, which is the redundancy every other change on this
                panel has been spending lines to remove.

                The header is the right of the two because "nobody has this
                call" outranks the card: it is the first thing a reader needs
                and it is exceptional, which is what the header's pill row is
                for. An empty group under a heading reading "Assigned unit" is
                the weaker statement of the same fact. */}
            {assigned ? (
              <Group icon={Radio} title="Assigned unit">
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
              </Group>
            ) : null}

            {/* ── 3. GEOSPATIAL LOCATION ────────────────────────────────
                The address lives HERE and only here. It is not repeated in
                the reporter banner above: `phase`/`block`/`lot` on an incident
                ARE the reporting resident's property fields, so the two rows
                could never disagree — printing them twice in a 416px rail
                spends a line to say nothing new. */}
            <Group icon={MapPin} title="Location">
              <MetaList className={META}>
                <MetaItem label="Address">{address || report.location}</MetaItem>
                {/* `location` is `describeIncidentLocation`, which composes the
                    very phase/block/lot string above whenever the document has
                    no `propertyLabel` and no free-text location — so for most
                    reports this row printed the Address again, verbatim, one
                    line below it. Shown only when it says something else. */}
                <MetaItem label="Reported at" hidden={!report.location || report.location === address}>
                  {report.location}
                </MetaItem>
                <MetaItem label="Coordinates" mono>
                  {coordinates}
                </MetaItem>
              </MetaList>
            </Group>

            {/* ── 4. WHAT THE RESIDENT SENT, IN ONE CONTAINER ───────────
                The description and the photos were two groups with two headers,
                and they are one submission: the resident typed the sentence and
                attached the pictures in the same breath, about the same thing.
                Reading them apart is the administrator doing a join the panel
                should have done.

                It also fixes a worse case than the tidiness one. The photos
                frequently ARRIVE after the text — a phone on estate wi-fi
                finishes the write before the uploads — so a "Description"
                group and an "Evidence · 0 files" group saying "No media
                attached" were two separate claims about one report, and the
                reader had to work out they were about the same thing. In one
                container the count is a caption on the content it counts.

                The group is rendered even with no description, which it was
                not: a report whose narrative is empty but whose photos are
                still uploading used to drop the description group entirely,
                so the panel went quiet about the submission at exactly the
                moment it was changing.

                The divider, not a gap: a hairline says "same card, next part",
                where whitespace at this width reads as the edge of the card. */}
            <Group
              icon={FileText}
              title="Reported description"
              action={
                media.length ? (
                  <span className="shrink-0 text-2xs font-medium text-text-muted">
                    {media.length} file{media.length === 1 ? '' : 's'}
                  </span>
                ) : null
              }
            >
              {report.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                  {report.description}
                </p>
              ) : (
                <p className="text-sm text-text-muted">The resident submitted no written description.</p>
              )}

              {media.length || report.hasMedia ? (
                <div className="mt-5 border-t border-hairline pt-5">
                  <EvidenceGrid
                    media={media}
                    stamp={stamp}
                    onOpen={(index) => setLightbox({ items: media, index, watermark })}
                    emptyText="Media still uploading…"
                  />
                </div>
              ) : null}
            </Group>

            {/* ── 5. WHAT CAME OUT OF IT ────────────────────────────────
                The resolution the Guardhouse filed: its outcome, the officer's
                notes and the scene photographs. This panel had none of it, so
                the console that signs a resolution off could read everything
                about the REPORT and nothing about the RESPONSE — the one thing
                "verify" is a verb about. The grid is stamped at the
                resolution's own time and position, not the report's. */}
            {stage === 'resolved' && report.resolution ? (
              <Group
                icon={ClipboardList}
                title="Resolution"
                action={
                  outcomeLabel ? (
                    <span className="shrink-0 text-2xs font-medium text-text-muted">{outcomeLabel}</span>
                  ) : null
                }
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                  {report.resolution.notes}
                </p>
                {resolutionMedia.length ? (
                  <div className="mt-5 border-t border-hairline pt-5">
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
              </Group>
            ) : null}
          </section>
        </div>

        {/* ══ THE OVERSIGHT ACTION — PINNED ══
            The footer this panel used to have was four buttons wide — Call
            reporter, Directions, Copy coordinates, Archive — all four
            available at once, at every stage, whatever the call was doing.
            That is the pattern the Guardhouse's footer was rebuilt away from:
            a row of equally-weighted controls makes a reader answer "what can
            I do here" on every line, and the two questions compete.

            What is pinned here instead is the ONE action the stage calls for,
            with Close last. The shortcuts that went are not missed: the
            coordinates in Location are selectable text, and the full ticket
            record — which the pre-resolution footer now links to directly —
            carries the history, the documents and the PDF export. */}
        <footer className="relative shrink-0 border-t border-hairline bg-base-900 px-3.5 pb-3.5 pt-3">
          {feedback ? <Receipt feedback={feedback} onDismiss={dismiss} /> : null}
          {/* Centred, and Close LAST, for the reason the X is top-RIGHT: the
              control that takes your place away should never be where the
              thumb lands for the thing you meant to do. `flex-wrap` lets Close
              drop to its own row exactly when the two resolved-stage actions
              already fill the width, instead of squeezing either. */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {footer}
            <button type="button" onClick={onClose} className="btn btn-action btn-outline">
              <X size="sm" aria-hidden="true" />
              Close
            </button>
          </div>
          {hint ? <p className="mt-2 text-caption leading-snug text-text-muted">{hint}</p> : null}
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
