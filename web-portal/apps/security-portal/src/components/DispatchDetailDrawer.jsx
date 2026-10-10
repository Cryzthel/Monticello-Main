import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertOctagon,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Loader2,
  MapPin,
  Phone,
  Radio,
  ShieldAlert,
  Timer,
  UserRoundCheck,
  UserRoundCog,
  X,
} from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import { categoryTone } from '@shared/theme/badgeStyles'
import Lightbox from '@shared/components/Lightbox'
import { useAuth } from '@shared/auth/AuthContext'
import { useReporterContact } from '@shared/hooks/useReporterContact'
import { buildMediaItems } from '@shared/lib/incidents'
import { categoryLabel } from '@shared/lib/incidentCategories'
import {
  ACK_TIMEOUT_MS,
  deriveDispatchStage,
  RESOLUTION_OUTCOMES,
} from '@shared/lib/dispatchStage'
import {
  acknowledgeAndRespond,
  canActOn,
  dispatchUnit,
  resolveIncident,
} from '@/lib/dispatchWorkflow'
import {
  formatStopwatch,
  incidentReference,
  residentMessageForStage,
} from '@/lib/dispatch'
import { ROUTES } from '@/config/portal'
import { useStageAction } from '@/hooks/useStageAction'
import {
  CategoryIconBadge,
  Section,
  StageStepper,
} from '@/components/dispatch/parts'
import { unitLabel } from '@/lib/unitIdentity'
import EvidenceGrid, { forensicCoordinates, forensicTimestamp } from '@/components/dispatch/EvidenceGrid'
import UnitPicker from '@/components/dispatch/UnitPicker'
import ResolveIncidentModal from '@/components/dispatch/ResolveIncidentModal'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'

/**
 * Width of the desktop rail, in px, exported so the dispatch page can tell the
 * map how much of its right edge is spoken for. It IS this component's
 * `lg:w-[26rem]`. Two places holding it independently is how a centred
 * marker ends up under the panel.
 */
export const DRAWER_WIDTH_PX = 416

const SEVERITY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const CLOCK = { hour: '2-digit', minute: '2-digit', hour12: false }
const clock = (at) => (at ? new Date(at).toLocaleTimeString('en-GB', CLOCK) : '—')


/** The receipt for the last action. See useStageAction. */
const RECEIPT_TONES = {
  success: { shell: 'border-success/30 bg-success/10 text-success', Icon: CheckCircle2 },
  warning: { shell: 'border-warning/30 bg-warning/10 text-warning', Icon: ShieldAlert },
  danger: { shell: 'border-danger/30 bg-danger/10 text-danger', Icon: ShieldAlert },
}

function Receipt({ feedback, onDismiss }) {
  const { shell, Icon } = RECEIPT_TONES[feedback.tone] ?? RECEIPT_TONES.warning
  return (
    <div
      role="status"
      className={`absolute inset-x-3 bottom-full z-10 mb-2 flex items-start gap-2.5 rounded-xl border p-3 shadow-overlay animate-[riseIn_180ms_var(--ease-spring)] ${shell}`}
    >
      <Icon size="sm" className="mt-px shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs font-medium leading-snug">{feedback.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 opacity-70 transition-[opacity,background-color] duration-150 hover:bg-tint/10 hover:opacity-100"
      >
        <X size="sm" />
      </button>
    </div>
  )
}

/** A label/value row on a fixed gutter, so every value in the drawer starts on one edge. */
function Row({ label, mono = false, children }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <dt className="w-20 shrink-0 text-caption font-medium text-text-muted">{label}</dt>
      <dd className={`m-0 min-w-0 flex-1 break-words text-label font-medium text-text-primary ${mono ? 'font-mono' : ''}`}>
        {children || <span className="text-text-muted">—</span>}
      </dd>
    </div>
  )
}

/** Seconds since the call was booked, for the 90-second acknowledgement window. */
function useAckClock(report) {
  const waiting = report?.dispatchStage === 'dispatched'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!waiting) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waiting])
  if (!waiting) return null
  const since = report.dispatchedAt ? new Date(report.dispatchedAt).getTime() : now
  const waited = Math.max(0, now - since)
  return { waited, expired: waited >= ACK_TIMEOUT_MS }
}

/**
 * The Incident Details panel for the Live Dispatch map.
 *
 *   ┌ [icon] Security · High                       12:43  [×] ┐
 *   │ Break-in attempt at the side gate                        │
 *   │ INC-A1B2C3D4 · Reported 10:16                            │
 *   │ ●───●───◉───○───○  Dispatched → … → Resolved             │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ LOCATION        resident, number, phase · block · lot    │
 *   │ DESCRIPTION                                              │
 *   │ EVIDENCE        watermarked thumbnails                   │
 *   │ UNIT            picker, or the assigned unit + telemetry │
 *   │ INVESTIGATION   tags, scene photos, escalation           │
 *   │ RESOLUTION      outcome, notes, photos                   │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ [ the ONE next action for this stage ]          pinned   │
 *   └──────────────────────────────────────────────────────────┘
 *
 * ── ONE ACTION AT A TIME ───────────────────────────────────────────────────
 * The old footer offered Dispatch, On-Site and Resolve side by side, and any
 * of them could be pressed at any time. The footer now offers only the next
 * edge of the machine (lib/dispatchWorkflow.js), and only to someone allowed
 * to take it: the dispatcher picks the unit, the unit acknowledges, arrives,
 * investigates and resolves. The rules enforce the same, so a stale screen
 * that still shows an old button is refused, not obeyed.
 *
 * ── A RAIL, NOT A MODAL ────────────────────────────────────────────────────
 * From `lg` up this is a right-hand rail with no scrim: the map stays lit and
 * clickable, the camera centres the pin in the space the rail leaves (see
 * DRAWER_WIDTH_PX), and clicking another pin moves the rail to it. Below `lg`
 * it is a bottom sheet with a scrim, because there is no "beside" at that
 * width.
 */
export default function DispatchDetailDrawer({ report, units = [], previewUid, onPreviewUnit, onClose }) {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const uid = user?.uid
  const { contact, loading: contactLoading } = useReporterContact(report?.reporterUid)
  const action = useStageAction(report?.id)

  // The ETA chip that lived here is gone: the route panel over the map
  // carries the same figure, live and counting down, and a static copy of it
  // in a drawer header was the second place to read one number.
  const { busy, feedback, run, dismiss } = action

  // Focus moves into the panel, stays inside it, and returns to whatever
  // opened the call when it closes. See useDialogFocus for what this was
  // before: `role="dialog"` with none of the behaviour the role promises.
  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(report), containerRef: panelRef })
  const ack = useAckClock(report)

  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [reassigning, setReassigning] = useState(false)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    setLightboxIndex(null)
    setReassigning(false)
    setResolving(false)
  }, [report?.id])

  // A dialog for a stage the call has left is a dialog for a press that has
  // already happened. Offline, the stage moves locally before the server
  // answers, and leaving the dialog open invited a second press that the
  // rules would refuse when it arrived.
  /**
   * ── ONE STAGE, DERIVED, FOR EVERY PART OF THIS PANEL ───────────────────
   *
   * This was `report?.dispatchStage` — the RAW stored value — while the
   * progress bar beside it went through `deriveDispatchStage`. Two sources
   * of truth for one fact, and they disagreed on exactly the documents that
   * matter: a call still stored at the retired `on_site` or `investigating`
   * derives to `responding`, so the bar lit Responding while NOTHING here
   * matched a branch. No action button, no hint, and a heading that computed
   * `STAGE_LABELS[undefined]` and rendered the words "Next: undefined".
   *
   * That is the mismatch this panel was reported for. It is not a labelling
   * problem; it is the bar and the controls reading different fields.
   */
  const stage = deriveDispatchStage(report)
  useEffect(() => {
    if (stage !== 'dispatched') setReassigning(false)
    if (stage !== 'responding') setResolving(false)
  }, [stage])

  const anyDialog = lightboxIndex !== null || resolving
  useEffect(() => {
    if (!report || anyDialog || busy) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [report, anyDialog, busy, onClose])

  const pickerOpen = stage === 'none' || (stage === 'dispatched' && reassigning)
  const selectedUnit = pickerOpen && previewUid ? units.find((u) => u.uid === previewUid) ?? null : null

  const dispatchSelected = useCallback(() => {
    if (!selectedUnit) return
    // `unitLabel`, not the raw name: this string is shown as a receipt and
    // an email-provisioned account would put an address in it.
    const picked = unitLabel(selectedUnit).label
    const label = stage === 'dispatched' ? `Reassigned to ${picked}` : `${picked} dispatched`
    run('dispatch', label, () => dispatchUnit(report, selectedUnit, { role })).then((ok) => {
      if (ok) {
        setReassigning(false)
        onPreviewUnit?.(null)
      }
    })
  }, [selectedUnit, stage, run, report, role, onPreviewUnit])

  if (!report) return null

  const actor = { uid, role }
  const canAct = canActOn(report, actor)
  const isMine = report.assignedGuardUid === uid
  const assignedUnit = report.assignedGuardUid ? units.find((u) => u.uid === report.assignedGuardUid) ?? null : null
  const address = [
    report.phase && `Phase ${report.phase}`,
    report.block && `Block ${report.block}`,
    report.lot && `Lot ${report.lot}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const reference = incidentReference(report.id)
  /**
   * The assigned officer, as the hints below are allowed to name them.
   *
   * Nine strings in this file interpolated `report.assignedGuardName`
   * directly, which on an email-provisioned account prints the address into
   * sentences a dispatcher reads aloud. One derivation, used by all of them.
   */
  const guardLabel = unitLabel({
    name: report.assignedGuardName,
    badgeNumber: report.assignedGuardBadge || assignedUnit?.badgeNumber,
  }).label
  const media = buildMediaItems(report)
  const stamp = { at: report.reportedAt, lat: report.lat, lng: report.lng, reference }
  const resolutionMedia = (report.resolution?.photoUrls ?? []).map((url) => ({ url, type: 'image' }))
  const outcomeLabel = RESOLUTION_OUTCOMES.find((o) => o.value === report.resolution?.outcome)?.label
  const nextMessage = residentMessageForStage(
    report,
    { dispatched: 'responding', responding: 'resolved' }[stage],
    guardLabel,
  )


  // ── THE FOOTER: THE ONE NEXT ACTION ──────────────────────────────────────
  let footer = null
  /**
   * A readout pinned ABOVE the action row, not inside it.
   *
   * The acknowledgement countdown used to be the first child of the button
   * row, as a `flex-1` block that would give way to the buttons. With a third
   * control in that row it gave way to 34 pixels — measured — and
   * "No acknowledgement · 9:08", the one thing on the panel saying a unit has
   * gone quiet on a live call, truncated to nothing.
   *
   * It was never an action, and sharing a row with actions meant it was
   * competing for space against them on a rule ("whoever is flexible yields")
   * that had no idea which of the two mattered. On its own line it cannot
   * lose, and it cannot push a button off the row either.
   */
  let status = null
  let hint = null
  const spinner = <Loader2 size="sm" className="animate-spin" aria-hidden="true" />

  if (pickerOpen) {
    footer = (
      <>
        {stage === 'dispatched' ? (
          <button type="button" onClick={() => { setReassigning(false); onPreviewUnit?.(null) }} className="btn btn-action btn-outline">
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={!selectedUnit || Boolean(busy)}
          onClick={dispatchSelected}
          className="btn btn-action btn-brand flex-1"
        >
          {busy === 'dispatch' ? spinner : <Radio size="sm" aria-hidden="true" />}
          {selectedUnit
            ? `${stage === 'dispatched' ? 'Reassign to' : 'Dispatch'} ${selectedUnit.name}`
            : stage === 'dispatched'
              ? 'Reassign unit'
              : 'Dispatch unit'}
        </button>
      </>
    )
    hint = selectedUnit
      ? `${selectedUnit.name} is alerted and has ${ACK_TIMEOUT_MS / 1000} s to acknowledge.`
      : 'Pick an available unit above. Its road route previews on the map.'
  } else if (stage === 'dispatched') {
    status = (
      <div
        className={`flex min-w-0 items-center gap-1.5 text-xs font-semibold ${ack?.expired ? 'text-danger' : 'text-text-secondary'}`}
        aria-live="polite"
      >
        <Timer size="sm" className="shrink-0" aria-hidden="true" />
        <span className="truncate">
          {ack?.expired ? 'No acknowledgement' : 'Awaiting acknowledgement'} ·{' '}
          <span className="font-mono tabular-nums">{formatStopwatch(ack?.waited ?? 0)}</span>
        </span>
      </div>
    )
    footer = (
      <>
        {!isMine ? (
          <button
            type="button"
            onClick={() => setReassigning(true)}
            disabled={Boolean(busy)}
            className={`btn btn-action ${ack?.expired ? 'btn-danger' : 'btn-outline'}`}
          >
            <UserRoundCog size="sm" aria-hidden="true" />
            Reassign
          </button>
        ) : null}
        {canAct ? (
          <button
            type="button"
            onClick={() => run('respond', 'Acknowledged — responding', () => acknowledgeAndRespond(report, { role }))}
            disabled={Boolean(busy)}
            className="btn btn-action btn-brand"
          >
            {busy === 'respond' ? spinner : <UserRoundCheck size="sm" aria-hidden="true" />}
            Acknowledge & respond
          </button>
        ) : null}
      </>
    )
    hint = canAct
      ? `${isMine ? 'Switches this device to high-precision GPS until the call is resolved' : `Acknowledges on behalf of ${guardLabel}`}. Sends: “${nextMessage}”`
      : ack?.expired
        ? `${guardLabel} has not acknowledged within ${ACK_TIMEOUT_MS / 1000} s, and every console has been alerted. Reassign the call to another unit.`
        : `${guardLabel} has ${ACK_TIMEOUT_MS / 1000} s to acknowledge before every console is alerted.`
  } else if (stage === 'responding') {
    /**
     * ── ONE STAGE WHERE THERE WERE THREE ───────────────────────────────
     * Responding used to end at "I have arrived", which opened ON-SITE,
     * whose only control was "Begin investigation", which opened
     * INVESTIGATING, where the real work finally lived. Three stages and two
     * button presses between a guard reaching a scene and being able to
     * photograph it.
     *
     * Both presses are gone. The arrival is stamped from the unit's own
     * telemetry the moment it comes inside the radius (see `autoArrival`),
     * and the scene tools are available for the whole of responding. What is
     * left here is the two things that are genuinely decisions: escalate, and
     * close.
     */
    /* One action. Escalate sat beside this and is gone — backup is called
       by radio. See the note in lib/dispatchWorkflow.js for what that gave
       up, because nothing automatic inherited it. */
    footer = canAct ? (
      <button
        type="button"
        onClick={() => setResolving(true)}
        disabled={Boolean(busy)}
        className="btn btn-action btn-brand"
      >
        <CheckCircle2 size="sm" aria-hidden="true" />
        {/* "Proceed to resolve", not "Resolve incident". The press does not
            resolve anything — it opens a modal that then demands an outcome,
            notes and a photo. A button whose label claims to finish the call
            is a button people expect to be the last one, and they press it
            to find out what it wants. */}
        Proceed to resolve
      </button>
    ) : null
    hint = canAct
      ? report.onSceneAt
        ? `On scene since ${clock(report.onSceneAt)}. Resolving needs an outcome, notes and at least one photo.`
        : 'Arrival is stamped automatically when your position reaches the pin. Resolving needs an outcome, notes and at least one photo.'
      : report.onSceneAt
        ? `${guardLabel} arrived at ${clock(report.onSceneAt)}.`
        : `${guardLabel} is en route.`
  } else if (stage === 'resolved') {
    footer = (
      <button
        type="button"
        onClick={() => navigate(`${ROUTES.history}?incident=${report.id}`)}
        className="btn btn-action btn-outline flex-1"
      >
        <History size="sm" aria-hidden="true" />
        Open in incident history
      </button>
    )
    hint = `Resolved at ${clock(report.resolvedAt)} by ${report.resolvedByName || 'security'}. It has left the live map.`
  }

  if (!canAct && stage !== 'none' && stage !== 'resolved' && !pickerOpen) {
    hint = `${hint} Only ${guardLabel} or a supervisor can advance this call.`
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[var(--z-modal)] flex items-end justify-end lg:items-stretch">
      <div
        className="dialog-scrim pointer-events-auto absolute inset-0 bg-scrim lg:hidden"
        onClick={onClose}
        role="presentation"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Incident ${reference}`}
        className="pointer-events-auto relative flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-xl border border-hairline bg-base-900 shadow-modal animate-[riseIn_220ms_var(--ease-spring)] lg:h-full lg:w-[26rem] lg:animate-[drawerInRight_260ms_var(--ease-spring)] lg:rounded-none lg:border-y-0 lg:border-r-0"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close incident details"
          className="flex h-6 shrink-0 items-center justify-center pt-2 lg:hidden"
        >
          <span className="h-1 w-9 rounded-full bg-tint/25" />
        </button>

        {/* ══ HEADER ══ category, reference, elapsed time, and the stepper. */}
        <header className="shrink-0 border-b border-hairline px-4 pb-3 pt-3.5">
          <div className="flex items-start gap-3">
            <CategoryIconBadge category={report.category} />
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-base font-semibold leading-snug text-text-primary">
                {report.title || `${categoryLabel(report.category)} report`}
              </h2>
              <p className="mt-0.5 text-caption text-text-muted">
                <span className="font-mono font-semibold text-text-secondary">{reference}</span>
                {' · '}Reported {clock(report.reportedAt)}
              </p>
            </div>
            {/* ── THE RUNNING CLOCK IS GONE ────────────────────────────
                "Open for 42:04", ticking every second in the top-right corner
                of an emergency console, was the loudest number in this drawer
                and nothing was downstream of it. An officer does not drive
                faster because a counter passed forty minutes, and a number
                that moves constantly in peripheral vision costs attention on
                every glance at the panel — all shift, on every call.

                What it was really carrying was two facts, and both survive in
                cheaper form: WHEN the call came in is in the subline above
                ("Reported 12:43"), and whether it has BREACHED its response
                target is now the pill below. A breach is a state, which is
                worth a badge; the live count towards one is a metric, which
                belongs on the metrics page where someone is actually reading
                figures. The per-stage stamps in the stepper give the exact
                durations to anyone who needs them. */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close incident details"
              className="icon-btn icon-btn-sm -mr-1.5 -mt-1 shrink-0"
            >
              <X size="sm" />
            </button>
          </div>

          {/* Stage, then what kind of call and how urgent: the category and
              priority ride here as pills rather than as a label over the title. */}
          {/* ── THE PILL ROW, DOWN FROM SIX TO TWO ─────────────────────
              Gone: the stage badge, which the pipeline directly below spells
              out in three labelled steps; the ETA chip, which the route
              panel over the map carries live and counting down; and the
              overdue / target-missed pill, which measured a response target
              against an arrival the console now stamps silently.

              What is left answers the two questions a badge is good at and a
              stepper is not: what KIND of call, and how urgent. The
              escalation badge stays as a historic fact — calls escalated
              before that control was removed still carry one, and nothing
              can set it now. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {/* ── NOBODY IS ON THIS CALL ──────────────────────────────────
                The one stage the progress bar understates. Steps 2 and 3
                are plainly ahead of you, but step 1 not having happened
                looks the same as step 1 being in progress at a glance —
                both are "the first node is not filled in".

                So the header says it in words. The trigger it implies is
                already on screen rather than in this badge: at this stage
                the unit picker is open in the body and the footer button
                reads "Dispatch <name>", so a second Assign control would be
                a third way to start one action. */}
            {stage === 'none' ? (
              <StatusBadge tone="warning" size="sm" icon={Radio}>
                Unassigned — awaiting dispatch
              </StatusBadge>
            ) : null}
            <StatusBadge tone={categoryTone(report.category)} size="sm">
              {categoryLabel(report.category)}
            </StatusBadge>
            <StatusBadge severity={report.severity} size="sm">
              {SEVERITY_LABELS[report.severity] ?? 'Medium'} priority
            </StatusBadge>
            {ack?.expired ? (
              <StatusBadge tone="danger" size="sm" icon={Timer}>
                No acknowledgement
              </StatusBadge>
            ) : null}
            {report.escalation ? (
              <StatusBadge tone="danger" size="sm" icon={AlertOctagon}>
                Escalated
              </StatusBadge>
            ) : null}
          </div>

          <div className="mt-3">
            <StageStepper report={report} stage={stage} />
          </div>
        </header>

        {/* ══ BODY ══ the only band that scrolls. */}
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3.5">
          {/* ── WHERE, AND WHO TO RING ───────────────────────────────────
              Back to ONE card, after a spell as two.

              Splitting them read well as an argument — an officer takes a
              call, then drives to it, so the reporter and the destination are
              two steps — and it was wrong in practice for a reason the
              argument could not see: the two cards were four rows between
              them, and a 416px rail spent two section headers, two borders
              and 24px of padding to separate four rows. The chrome was taller
              than the content it was organising.

              They answer one question anyway. "Lot 12, and the daughter who
              filed it is on 0917…" is what an officer reads on the way out of
              the gate, and it is one thought.

              CATEGORY AND REPORTED ARE GONE from this card. They were moved
              here on the reasoning that an officer reading the details should
              not have to look back up for them — true when this card was
              below a long header, and no longer true now the header has shed
              its clock: the category pill and "Reported 12:43" are both in
              plain sight, two inches up. A fact in two places on one screen
              is not twice as findable.

              The label gutter stays `w-20`. "Contact number" and "Resident
              name" would wrap inside it, and widening it to fit two words
              would take that space from every value in the drawer — on a
              panel this narrow the values are what the officer is reading. */}
          <Section icon={MapPin} title="Location & contact">
            <div className="flex items-start gap-3">
              <dl className="min-w-0 flex-1">
                <Row label="Address">{address || report.location}</Row>
                <Row label="GPS" mono>
                  {typeof report.lat === 'number' ? forensicCoordinates(report.lat, report.lng) : null}
                </Row>
                <Row label="Resident">{report.reportedByName}</Row>
                <Row label="Contact" mono>
                  {contactLoading ? 'Looking up…' : contact?.phone}
                </Row>
              </dl>
              {contact?.phone ? (
                <a href={`tel:${contact.phone}`} className="btn btn-drawer btn-outline mt-1">
                  <Phone size="sm" aria-hidden="true" />
                  Call
                </a>
              ) : null}
            </div>
          </Section>

          {/* ── WHAT THE RESIDENT SENT, IN ONE CONTAINER ─────────────────
              The description and the photos were two cards with two headers,
              and they are one submission: the resident typed the sentence and
              attached the pictures in the same breath, about the same thing.
              Reading them apart is the officer doing a join the panel should
              have done.

              It also fixes a worse case than the tidiness one. The photos
              frequently ARRIVE after the text — a phone on estate wi-fi
              finishes the write before the uploads — so "Reported
              description" and an "Evidence · 0 files" card saying "Media
              still uploading…" were two separate claims about one report, and
              the officer had to work out they were about the same thing. In
              one container the count is a caption on the content it counts.

              The divider, not a gap: a hairline says "same card, next part",
              where whitespace at this width reads as the edge of the card. */}
          <Section
            icon={FileText}
            title="Reported description"
            meta={media.length ? `${media.length} file${media.length === 1 ? '' : 's'}` : null}
          >
            {report.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{report.description}</p>
            ) : (
              <p className="text-sm text-text-muted">The resident submitted no written description.</p>
            )}

            {media.length || report.hasMedia ? (
              <div className="mt-3.5 border-t border-hairline pt-3.5">
                <EvidenceGrid
                  media={media}
                  stamp={stamp}
                  onOpen={setLightboxIndex}
                  emptyText="Media still uploading…"
                />
              </div>
            ) : null}
          </Section>

          {pickerOpen ? (
            <Section
              icon={Radio}
              /* Only the reassignment names itself, because "reassign FROM
                 Officer Reyes" carries a fact the buttons below do not. The
                 plain dispatch case has no heading at all — see Section. */
              title={stage === 'dispatched' ? `Reassign from ${guardLabel}` : null}
              meta={`${units.filter((u) => u.state === 'available').length} available`}
            >
              <UnitPicker
                units={units}
                value={previewUid}
                onChange={(next) => onPreviewUnit?.(next)}
                excludeUid={stage === 'dispatched' ? report.assignedGuardUid : null}
                disabled={Boolean(busy)}
              />
            </Section>
          ) : null}

          {/* ── WHAT CAME OUT OF HERE ─────────────────────────────────
              "Assigned unit & telemetry", and the investigation panel.

              The unit card named the responder, their badge and their
              distance. All three are already on screen: the route panel over
              the map carries distance and ETA, and the footer hint below
              names the officer in a sentence ("Officer Dela Cruz is en
              route", "On scene since 14:12"). A card restating them spent a
              fifth of the drawer on what two other surfaces already said.

              The investigation panel's quick tags moved into the resolution,
              stated once with the outcome they belong to rather than toggled
              live mid-response. Its scene photos went with them: resolving
              already demands a photo, and two trays on one call is a
              question about which to use rather than extra evidence. */}
          {stage === 'resolved' && report.resolution ? (
            <Section icon={ClipboardList} title="Resolution" meta={outcomeLabel}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{report.resolution.notes}</p>
              <div className="mt-3">
                <EvidenceGrid
                  media={resolutionMedia}
                  stamp={{ ...stamp, at: report.resolvedAt, lat: report.arrival?.lat ?? report.lat, lng: report.arrival?.lng ?? report.lng }}
                  onOpen={() => {}}
                  emptyText=""
                />
              </div>
            </Section>
          ) : null}
        </div>

        {/* ══ THE NEXT ACTION — PINNED ══ */}
        <footer className="relative shrink-0 border-t border-hairline bg-base-900 px-3.5 pb-3.5 pt-3">
          {feedback ? <Receipt feedback={feedback} onDismiss={dismiss} /> : null}
          {/* ── NO "NEXT: RESOLVED" HEADING ───────────────────────────────
              It sat directly under a progress bar reading "Responding" and
              said the word "Resolved" in the same glance, which reads as the
              two disagreeing even when they are both right. A heading naming
              a STAGE, above controls naming an ACTION, inches from a bar
              that also names stages, is three vocabularies for one thing.

              The button says what pressing it does and the bar says where
              the call is. Nothing in between needs to speak. */}
          {/* ── CLOSE SITS WITH THE OTHER ACTIONS ──────────────────────
              `flex-wrap`, and Close LAST, which together are the whole of why
              a third control is safe to put in this row.

              The rail is 416px with 28px of padding, and the stage actions
              already run to two buttons at some stages ("Escalate" +
              "Resolve incident"). A third on the same line would either
              overflow or squeeze the commit action, and the commit action is
              what this footer is for. Wrapping lets Close drop to its own row
              exactly when there is no space, instead of taking space from the
              button an officer came here to press.

              Last, not first, for the same reason the X is top-RIGHT: the
              destructive-to-your-place control should never be where the
              thumb lands for the thing you meant to do. `ml-auto` holds it
              clear of the stage buttons while they share a line. */}
          {status ? <div className="mt-2">{status}</div> : null}
          {/* ── CENTRED, AND CLOSE NO LONGER PUSHED TO THE EDGE ──────────
              `ml-auto` held Close against the right rail, which on a
              416px drawer put a dead strip between it and the commit
              action that was neither a gap nor a button. Centring the row
              makes the group read as one set of controls, which is what
              they are, and the wrap still drops Close to its own line when
              two stage actions already fill the width.

              Close stays LAST for the reason the X is top-right: the
              control that takes your place away should never be where the
              thumb lands for the thing you meant to do. */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {footer}
            <button type="button" onClick={onClose} className="btn btn-action btn-outline">
              <X size="sm" aria-hidden="true" />
              Close
            </button>
          </div>
          {hint ? <p className="mt-2 text-caption leading-snug text-text-muted">{hint}</p> : null}
        </footer>
      </aside>

      {lightboxIndex !== null ? (
        <Lightbox
          media={media}
          startIndex={lightboxIndex}
          watermark={{
            name: `${reference} · ${report.reportedByName ?? 'Unknown resident'}`,
            address: `${address || 'Location not recorded'} · ${forensicCoordinates(report.lat, report.lng)}`,
            timestamp: forensicTimestamp(report.reportedAt),
          }}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}

      <ResolveIncidentModal
        open={resolving}
        report={report}
        busy={busy === 'resolve'}
        onCancel={() => setResolving(false)}
        onSubmit={(values) =>
          run('resolve', 'Incident resolved', () => resolveIncident(report, values, { role })).then(
            (ok) => ok && setResolving(false),
          )
        }
      />
    </div>
  )
}
