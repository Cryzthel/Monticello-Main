import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Home,
  Loader2,
  MapPinCheck,
  Navigation,
  Radio,
  ShieldCheck,
  Timer,
  User,
  UserRoundCog,
  X,
} from '@shared/icons'
import Pill from '@shared/components/Pill'
import { SEVERITY_TONES, categoryTone } from '@shared/theme/badgeStyles'
import Lightbox from '@shared/components/Lightbox'
import { useAuth } from '@shared/auth/AuthContext'
import { categoryLabel } from '@shared/lib/incidentCategories'
import {
  ACK_TIMEOUT_MS,
  ARRIVAL_RADIUS_M,
  INVESTIGATION_TAGS,
  deriveDispatchStage,
  RESOLUTION_OUTCOMES,
} from '@shared/lib/dispatchStage'
import {
  acknowledgeAndRespond,
  canActOn,
  dispatchUnit,
  checkArrival,
  confirmArrival,
  resolveIncident,
} from '@/lib/dispatchWorkflow'
import { GUARD_STAGE_LABELS, formatStopwatch, residentMessageForStage } from '@/lib/dispatch'
import { ROUTES } from '@/config/portal'
import { useStageAction } from '@/hooks/useStageAction'
import CategoryIconBadge from '@shared/components/dispatch/CategoryIconBadge'
import StageStepper from '@shared/components/dispatch/StageStepper'
import Receipt from '@shared/components/dispatch/Receipt'
import { unitLabel } from '@shared/lib/unitIdentity'
import EvidenceGrid, { forensicCoordinates, forensicTimestamp } from '@shared/components/dispatch/EvidenceGrid'
import { DetailCard, DetailField as Field } from '@shared/components/detail/DetailCard'
import {
  CoordinatesBlock,
  MediaEvidenceCard,
} from '@shared/components/detail/IncidentDetailCards'
import { incidentAddress, ticketCode } from '@shared/lib/incidentDetail'
import UnitPicker from '@/components/dispatch/UnitPicker'
import ResolveIncidentModal from '@/components/dispatch/ResolveIncidentModal'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { formatTime } from '@shared/lib/dates'

/** How long the exit runs; matches `.dialog-panel-out` in the shared CSS. */
const EXIT_MS = 150

const PRIORITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

/** The priority field's left rule, coloured like its pill (as in the Admin ticket). */
const PRIORITY_RULE = {
  danger: 'border-danger/50',
  high: 'border-orange-500/50',
  warning: 'border-warning/50',
  info: 'border-info/50',
  success: 'border-success/50',
}

/**
 * Where the call stands, as the header pill (the Admin ticket's stage pill).
 * `claimedBy` is set when another officer holds the call: it then says whose
 * it is rather than inviting this console to navigate.
 */
function stagePill(stage, ackExpired, claimedBy, onScene = false) {
  if (stage === 'none') return { text: 'Awaiting acknowledgement', tone: 'warning', pulse: true, icon: Radio }
  if (stage === 'dispatched')
    return ackExpired
      ? { text: 'No acknowledgement', tone: 'danger', pulse: true, icon: Timer }
      : claimedBy
        ? { text: `Acknowledged by ${claimedBy}`, tone: 'info', pulse: false, icon: ShieldCheck }
        : { text: 'Acknowledged · ready to navigate', tone: 'info', pulse: true, icon: ShieldCheck }
  if (stage === 'responding')
    return onScene
      ? { text: 'Arrived on scene', tone: 'success', pulse: true, icon: MapPinCheck }
      : { text: 'En route', tone: 'info', pulse: true, icon: Navigation }
  return { text: 'Resolved', tone: 'success', pulse: false, icon: CheckCircle2 }
}

// 12-hour, from the shared date module, so "Reported 1:25 AM" here matches
// the stamp on the same report's photos.
const clock = (at) => formatTime(at)

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
 * The Incident Details rail for the Live Dispatch map — drawn with the SAME
 * cards as the Admin ticket modal (IncidentDetailModal), so the two consoles
 * read one report one way (2026-10-19, by request):
 *
 *   ┌ [icon] Title  (MV-XXXX)                                         [×] ┐
 *   │ (• Category) (Priority) (• Stage)                                    │
 *   │ ①──②──③  Verified by Security → Dispatched → Resolved               │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ MEDIA EVIDENCE · NOTES · REPORTER · TELEMETRY (GPS + Copy)           │
 *   │ ASSIGN A UNIT (before verification) · RESOLUTION · STATUS HISTORY    │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ [Start navigation]                                                   │
 *   │ [ the ONE next action for this stage ]                     pinned    │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * ONE ACTION AT A TIME (2026-10-19, by request): the footer offers only the
 * next edge of the machine (lib/dispatchWorkflow.js), to someone allowed to
 * take it; the rules enforce the same.
 *   1. ACKNOWLEDGE — take the call yourself, or assign a unit (none →
 *      dispatched). Navigation details stay off the map until this is done.
 *   2. START NAVIGATION — replaces the action at once (dispatched →
 *      responding) and opens turn-by-turn for the officer's own call.
 *   3. GUARD DISPATCHED · EN ROUTE — the header says so, and the resident is
 *      told, the moment step 2 reaches the server.
 * Each press moves the drawer on as soon as the write is applied on this
 * device; the server's answer follows in the background (useStageAction),
 * which restarts a stalled stream and rolls back on a refusal. A CLAIM made
 * online is the exception: it waits for a transaction, so an officer who
 * lost the race to Acknowledge sees "Acknowledged by …" and never a claim of
 * their own that rolls back.
 *
 * A CENTRED MODAL (2026-10-19, by request; was a right-hand rail / bottom
 * sheet). A dark glass plate in BOTH themes — the panel carries `.dark`, so
 * every token inside resolves to its dark value — over a blurred scrim. It
 * enters with the shared dialogIn and leaves with dialogOut: the wrapper
 * below keeps the last report mounted for EXIT_MS after the page clears it.
 *
 * READ-ONLY WHEN SOMEONE ELSE HOLDS THE CALL: an officer who is neither the
 * assigned unit nor a supervisor sees whose it is and no stage action. Only a
 * call whose 90-second acknowledgement has lapsed offers Reassign.
 *
 * `navigation` (from the dispatch page), for an active call:
 *   { state: 'ready' | 'active' | 'routing' | 'unavailable', reason?, onStart, onExit, onCommitted }
 */
export default function DispatchDetailDrawer({ report, ...rest }) {
  // The report on screen, held through the exit so the panel can leave
  // rather than vanish. Synced during render (the derived-state pattern), so
  // a newly opened call is drawn on the same frame it was clicked.
  const [held, setHeld] = useState(report)
  const [closing, setClosing] = useState(false)
  if (report && held !== report) {
    setHeld(report)
    setClosing(false)
  } else if (!report && held && !closing) {
    setClosing(true)
  }
  // A timer, not `animationend`: a hidden pane or reduced motion never fires
  // the event, and a modal that cannot finish closing blocks the map.
  useEffect(() => {
    if (!closing) return undefined
    const timer = setTimeout(() => {
      setHeld(null)
      setClosing(false)
    }, EXIT_MS)
    return () => clearTimeout(timer)
  }, [closing])

  if (!held) return null
  return <ReportDetailsModal report={held} closing={closing} {...rest} />
}

function ReportDetailsModal({ report, closing, units = [], previewUid, onPreviewUnit, onClose, navigation = null }) {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const uid = user?.uid
  const { busy, feedback, offline, run, dismiss } = useStageAction(report?.id)

  const panelRef = useRef(null)
  useDialogFocus({ open: !closing, containerRef: panelRef })
  const ack = useAckClock(report)

  const [mediaLightbox, setMediaLightbox] = useState(false)
  /** The resolution grid has its own, because it shows different media. */
  const [resolutionLightbox, setResolutionLightbox] = useState(null)
  const [reassigning, setReassigning] = useState(false)
  const [resolving, setResolving] = useState(false)
  /**
   * The Arrived-on-scene press: `checking` while a fresh GPS fix is taken,
   * then `arrivalPrompt` holds a check that did NOT place the officer at the
   * pin, so they can confirm with a reason or back out.
   */
  const [checking, setChecking] = useState(false)
  const [arrivalPrompt, setArrivalPrompt] = useState(null)
  const [arrivalReason, setArrivalReason] = useState('')

  useEffect(() => {
    setResolutionLightbox(null)
    setReassigning(false)
    setResolving(false)
    setArrivalPrompt(null)
    setArrivalReason('')
  }, [report?.id])

  // Arrival registered (by this press, the geofence or another device): the
  // question is answered.
  const onScene = Boolean(report?.onSceneAt)
  useEffect(() => {
    if (onScene) setArrivalPrompt(null)
  }, [onScene])

  // One stage, derived, for every part of this panel — never the raw stored
  // value, which reads the retired `on_site` / `investigating` as nothing.
  const stage = deriveDispatchStage(report)
  useEffect(() => {
    if (stage !== 'dispatched') setReassigning(false)
    if (stage !== 'responding') setResolving(false)
  }, [stage])

  const anyDialog = mediaLightbox || resolutionLightbox !== null || resolving
  useEffect(() => {
    if (!report || closing || anyDialog || busy) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [report, closing, anyDialog, busy, onClose])

  const pickerOpen = stage === 'none' || (stage === 'dispatched' && reassigning)
  const selectedUnit = pickerOpen && previewUid ? units.find((u) => u.uid === previewUid) ?? null : null
  /** This officer as a unit, when they are on duty — for "Acknowledge". */
  const selfUnit = uid ? units.find((u) => u.uid === uid) ?? null : null

  const dispatchTo = useCallback(
    (unit) => {
      if (!unit) return
      // `unitLabel`, not the raw name: this string is shown as a receipt and
      // an email-provisioned account would put an address in it.
      const picked = unitLabel(unit).label
      const label = stage === 'dispatched' ? `Reassigned to ${picked}` : unit.uid === uid ? 'Acknowledged' : `Acknowledged — ${picked} assigned`
      run('dispatch', label, () => dispatchUnit(report, unit, { role })).then((ok) => {
        if (ok) {
          setReassigning(false)
          onPreviewUnit?.(null)
          // Taking the call yourself: navigation opens as soon as the route
          // plots (DashboardPage `autoNav`).
          if (unit.uid === uid) navigation?.onCommitted?.()
        }
      })
    },
    [stage, run, report, role, onPreviewUnit, uid, navigation],
  )

  if (!report) return null

  const canAct = canActOn(report, { uid, role })
  const isMine = report.assignedGuardUid === uid
  const assignedUnit = report.assignedGuardUid ? units.find((u) => u.uid === report.assignedGuardUid) ?? null : null
  const address = incidentAddress(report)
  const reference = ticketCode(report.id)
  // The assigned officer as the hints may name them — never a raw email.
  const guardLabel = unitLabel({
    name: report.assignedGuardName,
    badgeNumber: report.assignedGuardBadge || assignedUnit?.badgeNumber,
  }).label
  const severity = String(report.severity ?? 'medium').toLowerCase()
  const severityTone = SEVERITY_TONES[severity] ?? 'warning'
  const stamp = { at: report.reportedAt, lat: report.lat, lng: report.lng, reference }
  const resolutionMedia = (report.resolution?.photoUrls ?? []).map((url) => ({ url, type: 'image' }))
  const outcomeLabel = RESOLUTION_OUTCOMES.find((o) => o.value === report.resolution?.outcome)?.label
  const nextMessage = residentMessageForStage(
    report,
    { dispatched: 'responding', responding: 'resolved' }[stage],
    guardLabel,
  )
  // Another officer holds this call and this console may not act for them:
  // drawn read-only, with their name, instead of offering actions the server
  // would refuse.
  const claimedByOther = !canAct && Boolean(report.assignedGuardUid) && (stage === 'dispatched' || stage === 'responding')
  const pill = stagePill(stage, ack?.expired, claimedByOther ? guardLabel : null, Boolean(report.onSceneAt))

  /** Arrived on scene: a fresh fix first; inside the radius it stamps at once. */
  const markArrived = async () => {
    setChecking(true)
    let check
    try {
      check = await checkArrival(report)
    } finally {
      setChecking(false)
    }
    if (check.verdict === 'within') run('arrive', 'Arrived on scene', () => confirmArrival(report, check, { role }))
    else setArrivalPrompt(check)
  }

  // ── THE FOOTER: THE ONE NEXT ACTION ──────────────────────────────────────
  let footer = null
  /** A readout pinned ABOVE the action row, so it can never be squeezed out. */
  let status = null
  let hint = null
  const spinner = <Loader2 size="sm" className="animate-spin" aria-hidden="true" />

  if (pickerOpen) {
    const takeSelf = stage === 'none' && selfUnit && !selectedUnit
    footer = (
      <>
        {stage === 'dispatched' ? (
          <button type="button" onClick={() => { setReassigning(false); onPreviewUnit?.(null) }} className="btn btn-action btn-outline">
            Cancel
          </button>
        ) : null}
        {takeSelf ? (
          // STEP 1, the fast path: an officer acknowledging a report they
          // will attend themselves, without picking their own name from a list.
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => dispatchTo(selfUnit)}
            className="btn btn-action btn-brand flex-1"
          >
            {busy === 'dispatch' ? spinner : <ShieldCheck size="sm" aria-hidden="true" />}
            Acknowledge
          </button>
        ) : (
          <button
            type="button"
            disabled={!selectedUnit || Boolean(busy)}
            onClick={() => dispatchTo(selectedUnit)}
            className="btn btn-action btn-brand flex-1"
          >
            {busy === 'dispatch' ? spinner : stage === 'dispatched' ? <Radio size="sm" aria-hidden="true" /> : <ShieldCheck size="sm" aria-hidden="true" />}
            {selectedUnit
              ? `${stage === 'dispatched' ? 'Reassign to' : 'Acknowledge & assign'} ${selectedUnit.name}`
              : stage === 'dispatched'
                ? 'Reassign unit'
                : 'Acknowledge & assign unit'}
          </button>
        )}
      </>
    )
    hint =
      stage === 'dispatched'
        ? selectedUnit
          ? `${selectedUnit.name} is alerted and has ${ACK_TIMEOUT_MS / 1000} s to acknowledge.`
          : 'Pick an available unit above. Its road route previews on the map.'
        : takeSelf
          ? 'Takes the call. Start navigation comes next. Or pick another unit above.'
          : selectedUnit
            ? `Acknowledges the report and assigns it. ${selectedUnit.name} has ${ACK_TIMEOUT_MS / 1000} s to respond.`
            : 'Pick an available unit above to acknowledge and assign the report.'
  } else if (stage === 'dispatched') {
    status = (
      <div
        className={`flex min-w-0 items-center gap-1.5 text-xs font-semibold ${ack?.expired ? 'text-danger' : 'text-text-secondary'}`}
        aria-live="polite"
      >
        {claimedByOther && !ack?.expired ? (
          <ShieldCheck size="sm" className="shrink-0 text-info" aria-hidden="true" />
        ) : (
          <Timer size="sm" className="shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">
          {ack?.expired ? 'No acknowledgement' : claimedByOther ? `Acknowledged by ${guardLabel}` : 'Awaiting acknowledgement'} ·{' '}
          <span className="font-mono tabular-nums">{formatStopwatch(ack?.waited ?? 0)}</span>
        </span>
      </div>
    )
    footer = (
      <>
        {/* Reassign: a supervisor any time; anyone else only once the
            holder has let the acknowledgement window lapse. */}
        {!isMine && (canAct || ack?.expired) ? (
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
          // STEP 2: Start navigation. Puts the officer en route (dispatched →
          // responding) and, for their own call, opens turn-by-turn once the
          // server has it (DashboardPage `autoNav`).
          <button
            type="button"
            onClick={() =>
              run('respond', 'Guard dispatched — en route', () => acknowledgeAndRespond(report, { role })).then(
                (ok) => ok && isMine && navigation?.onCommitted?.(),
              )
            }
            disabled={Boolean(busy)}
            className="btn btn-action btn-brand"
          >
            {busy ? spinner : <Navigation size="sm" aria-hidden="true" />}
            {isMine ? 'Start navigation' : 'Mark en route'}
          </button>
        ) : null}
      </>
    )
    hint = canAct
      ? `${isMine ? 'Opens turn-by-turn navigation to the call' : `Marks ${guardLabel} en route`}. Sends: “${nextMessage}”`
      : ack?.expired
        ? `${guardLabel} has not acknowledged within ${ACK_TIMEOUT_MS / 1000} s, and every console has been alerted. Reassign the call to another unit.`
        : `${guardLabel} has ${ACK_TIMEOUT_MS / 1000} s to acknowledge before every console is alerted.`
  } else if (stage === 'responding' && !report.onSceneAt) {
    // STEP 3: ARRIVED ON SCENE. Resolve does not exist yet — it is locked
    // until arrival is registered, here and in firestore.rules. The geofence
    // (useAutoArrival) usually registers it first; this button is the
    // explicit path, and it asks for a reason when the GPS disagrees.
    footer =
      canAct && !arrivalPrompt ? (
        <button type="button" onClick={markArrived} disabled={Boolean(busy) || checking} className="btn btn-action btn-brand">
          {checking || busy === 'arrive' ? spinner : <MapPinCheck size="sm" aria-hidden="true" />}
          {checking ? 'Checking your position…' : 'Arrived on scene'}
        </button>
      ) : null
    hint = canAct
      ? `Resolve unlocks once your arrival is registered — automatically within ${ARRIVAL_RADIUS_M} m of the pin, or press Arrived on scene.`
      : `${guardLabel} is en route.`
  } else if (stage === 'responding') {
    // STEP 4: RESOLVE — only now that the officer is on scene.
    footer = canAct ? (
      <button type="button" onClick={() => setResolving(true)} disabled={Boolean(busy)} className="btn btn-action btn-brand">
        <CheckCircle2 size="sm" aria-hidden="true" />
        Resolve incident
      </button>
    ) : null
    hint = canAct
      ? `On scene since ${clock(report.onSceneAt)}. Resolving needs an outcome, notes and at least one photo.`
      : `${guardLabel} arrived at ${clock(report.onSceneAt)}.`
  } else if (stage === 'resolved') {
    footer = (
      <button
        type="button"
        onClick={() => navigate(`${ROUTES.history}?incident=${report.id}`)}
        className="btn btn-action btn-outline !basis-full whitespace-nowrap"
      >
        <History size="sm" aria-hidden="true" className="shrink-0" />
        Open in incident history
      </button>
    )
    hint = `Resolved at ${clock(report.resolvedAt)} by ${report.resolvedByName || 'security'}. It has left the live map.`
  }

  if (claimedByOther && !pickerOpen) {
    hint = `${hint} Read-only here — only ${guardLabel} or a supervisor can advance this call.`
  }

  return (
    <div
      className={`fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-3 sm:p-6 ${
        closing ? 'pointer-events-none' : ''
      }`}
    >
      <div
        className={`${closing ? 'dialog-scrim-out' : 'dialog-scrim'} absolute inset-0 bg-black/55 backdrop-blur-sm`}
        onClick={onClose}
        role="presentation"
      />

      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Incident ${reference}`}
        className={`dark ${closing ? 'dialog-panel-out' : 'dialog-panel'} relative flex max-h-[min(90dvh,56rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/90 text-text-primary shadow-2xl backdrop-blur-2xl`}
      >
        {/* ══ HEADER ══ the Admin ticket's header. */}
        <header className="relative shrink-0 border-b border-zinc-800/80 px-5 pb-4 pt-5 pr-14">
          <div className="flex items-start gap-3">
            <CategoryIconBadge category={report.category} />
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-base font-bold leading-snug tracking-tight text-text-primary">
                {report.title || `${categoryLabel(report.category)} report`}
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                <span className="font-mono font-semibold tracking-wider text-text-secondary">{reference}</span>
                <span aria-hidden="true">·</span>
                <span>Reported {clock(report.reportedAt)}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close incident details"
            className="absolute right-4 top-4 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <X size={20} />
          </button>

          {/* Oblong pills: what kind, how urgent, where it stands. */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Pill tone={categoryTone(report.category)}>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
              {categoryLabel(report.category)}
            </Pill>
            <Pill tone={severityTone} icon={AlertTriangle}>
              {PRIORITY_LABELS[severity] ?? 'Medium'} priority
            </Pill>
            <Pill tone={pill.tone} pulse={pill.pulse}>
              {pill.text}
            </Pill>
            {report.escalation ? (
              <Pill tone="danger" icon={AlertOctagon}>
                Escalated
              </Pill>
            ) : null}
          </div>

          <div className="mt-4">
            <StageStepper report={report} stage={stage} labels={GUARD_STAGE_LABELS} />
          </div>
        </header>

        {/* ══ BODY ══ stacked cards, the only band that scrolls. */}
        {/* Two columns from `md`: what the resident sent beside who sent it
            and where. The unit picker and the resolution span both. */}
        <div className="custom-scrollbar grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5 md:grid-cols-2">
          {pickerOpen ? (
            <DetailCard
              className="md:col-span-2"
              compact
              icon={Radio}
              title={stage === 'dispatched' ? `Reassign from ${guardLabel}` : 'Acknowledge & assign a unit'}
              action={
                <Pill tone="success">
                  {units.filter((u) => u.state === 'available').length} available
                </Pill>
              }
            >
              <UnitPicker
                units={units}
                value={previewUid}
                onChange={(next) => onPreviewUnit?.(next)}
                excludeUid={stage === 'dispatched' ? report.assignedGuardUid : null}
                disabled={Boolean(busy)}
              />
            </DetailCard>
          ) : null}

          {/* EVIDENCE & NOTES — one card (2026-10-19, by request): what the
              resident showed and what they said belong together. */}
          <MediaEvidenceCard report={report} compact title="Evidence & notes" onLightboxChange={setMediaLightbox}>
            <div className="border-t border-hairline pt-3">
              <span className="mb-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                <FileText size={12} aria-hidden="true" />
                Resident&rsquo;s notes
              </span>
              {/* `[overflow-wrap:anywhere]`: a resident's text can be one
                  unbroken string, which pre-wrap alone runs out of the card. */}
              <p className="whitespace-pre-wrap rounded-lg border border-hairline bg-base-950 p-3 text-sm font-medium leading-relaxed text-text-secondary shadow-inner [overflow-wrap:anywhere]">
                {report.description || 'No written description.'}
              </p>
            </div>
          </MediaEvidenceCard>

          {/* REPORTER & TELEMETRY — one card, one grid (2026-10-19, by
              request). No contact number: the call is worked from the map. */}
          <DetailCard compact icon={User} title="Reporter & telemetry" bodyClassName="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Reported by" empty={!report.reportedByName}>
                {report.reportedByName || 'Unknown'}
              </Field>
              <Field label="Ticket ID" mono>
                {reference}
              </Field>
              <Field label="Category">{categoryLabel(report.category)}</Field>
              <Field label="Priority level" accent={PRIORITY_RULE[severityTone] ?? 'border-hairline'}>
                <Pill tone={severityTone} icon={AlertTriangle} className="mt-0.5">
                  {PRIORITY_LABELS[severity] ?? 'Medium'}
                </Pill>
              </Field>
              <Field label="Assigned responder" empty={!report.assignedGuardName} className="col-span-2">
                {report.assignedGuardName ? guardLabel : 'Unassigned'}
              </Field>
              <Field label="Property address" className="col-span-2">
                <span className="mt-0.5 flex items-center gap-1.5">
                  <Home size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
                  {address}
                </span>
              </Field>
              {report.location && report.location !== address ? (
                <Field label="Reported location" className="col-span-2">
                  {report.location}
                </Field>
              ) : null}
            </div>
            <CoordinatesBlock lat={report.lat} lng={report.lng} />
          </DetailCard>

          {stage === 'resolved' && report.resolution ? (
            <DetailCard
              className="md:col-span-2"
              compact
              icon={ClipboardList}
              title="Resolution"
              action={report.resolvedAt ? <Pill tone="success">{clock(report.resolvedAt)}</Pill> : null}
            >
              <div className="grid grid-cols-1 gap-4">
                <Field label="What happened">{outcomeLabel}</Field>
                {report.resolution.tags?.length ? (
                  <Field label="What was done">
                    {report.resolution.tags
                      .map((t) => INVESTIGATION_TAGS.find((o) => o.value === t)?.label ?? t)
                      .join(' · ')}
                  </Field>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap rounded-lg border border-hairline bg-base-950 p-3 text-sm leading-relaxed text-text-secondary">
                {report.resolution.notes}
              </p>
              <EvidenceGrid
                media={resolutionMedia}
                stamp={{ ...stamp, label: 'Resolved', at: report.resolvedAt, lat: report.arrival?.lat ?? report.lat, lng: report.arrival?.lng ?? report.lng }}
                onOpen={setResolutionLightbox}
                emptyText=""
              />
            </DetailCard>
          ) : null}

        </div>

        {/* ══ THE NEXT ACTION — PINNED ══ */}
        <footer className="relative shrink-0 border-t border-zinc-800/80 bg-zinc-950/70 px-4 pb-4 pt-3 sm:px-5">
          {feedback ? <Receipt feedback={feedback} onDismiss={dismiss} /> : null}
          {status ? <div className="mt-1">{status}</div> : null}
          {/* START NAVIGATION — its own full-width row above the stage
              actions: getting to the call comes before any stage action. */}
          {navigation && stage === 'responding' && !report.onSceneAt ? (
            <div className="mt-2">
              {navigation.state === 'active' ? (
                <button type="button" onClick={navigation.onExit} aria-pressed className="btn btn-action btn-danger w-full">
                  <X size="sm" aria-hidden="true" />
                  Exit navigation
                </button>
              ) : (
                <button
                  type="button"
                  onClick={navigation.onStart}
                  disabled={navigation.state !== 'ready'}
                  title={navigation.state === 'ready' ? undefined : navigation.reason}
                  className="btn btn-action btn-outline w-full"
                >
                  {navigation.state === 'routing' ? spinner : <Navigation size="sm" aria-hidden="true" />}
                  {navigation.state === 'routing' ? 'Plotting route…' : 'Start navigation'}
                </button>
              )}
              {navigation.state === 'unavailable' && navigation.reason ? (
                <p className="mt-1.5 text-caption leading-snug text-text-muted">{navigation.reason}</p>
              ) : null}
            </div>
          ) : null}
          {arrivalPrompt ? (
            <ArrivalOverride
              check={arrivalPrompt}
              reason={arrivalReason}
              onReason={setArrivalReason}
              busy={busy === 'arrive'}
              onCancel={() => {
                setArrivalPrompt(null)
                setArrivalReason('')
              }}
              onConfirm={() =>
                run('arrive', 'Arrived on scene', () =>
                  confirmArrival(report, arrivalPrompt, { role, reason: arrivalReason }),
                ).then((ok) => ok && setArrivalReason(''))
              }
            />
          ) : null}
          {/* The ONE stage action, full width. No Close here (2026-10-19, by
              request): the header ✕, Escape and the scrim all dismiss. */}
          {footer ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-[8.5rem] [&>*]:flex-1">{footer}</div>
          ) : null}
          {offline && stage !== 'resolved' ? (
            <p className="mt-2 flex items-center gap-1.5 text-caption font-semibold leading-snug text-warning" role="status">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              Offline — actions save on this device and sync when the signal returns.
            </p>
          ) : null}
          {hint ? <p className="mt-2 text-caption leading-snug text-text-muted">{hint}</p> : null}
        </footer>
      </section>

      {/* The resolution's own photos, watermarked with the resolution's time
          and the arrival position — not the report's. */}
      {resolutionLightbox !== null ? (
        <Lightbox
          media={resolutionMedia}
          startIndex={resolutionLightbox}
          watermark={{
            name: `${reference} · resolved by ${report.resolvedByName || 'security'}`,
            address: `${address} · ${forensicCoordinates(report.arrival?.lat ?? report.lat, report.arrival?.lng ?? report.lng)}`,
            timestamp: forensicTimestamp(report.resolvedAt),
          }}
          onClose={() => setResolutionLightbox(null)}
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

/** Why the fresh fix did not place the officer at the pin, in their words. */
function arrivalVerdictText(check) {
  switch (check?.verdict) {
    case 'far':
      return `Your position reads ${Math.round(check.distanceM)} m from the pin${
        Number.isFinite(check.accuracyM) ? ` (±${Math.round(check.accuracyM)} m)` : ''
      }.`
    case 'imprecise':
      return `Your GPS is too coarse${Number.isFinite(check.accuracyM) ? ` (±${Math.round(check.accuracyM)} m)` : ''} to confirm you are at the pin.`
    case 'no-pin':
      return 'This report has no pinned location to check against.'
    default:
      return 'No position fix — location may be switched off or blocked.'
  }
}

/**
 * The override for an arrival the GPS did not confirm. A reason is required
 * (3–280 chars, as the rules demand) and is stored on the call, so a stamp
 * the device could not back up is recorded as exactly that.
 */
function ArrivalOverride({ check, reason, onReason, busy, onCancel, onConfirm }) {
  const ready = reason.trim().length >= 3
  return (
    <div className="mt-2 rounded-xl border border-warning/30 bg-warning/10 p-3" role="group" aria-label="Confirm arrival">
      <p className="flex items-start gap-2 text-sm font-semibold text-text-primary">
        <AlertTriangle size="sm" className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        {arrivalVerdictText(check)}
      </p>
      <label className="mt-2 block text-caption font-medium text-text-secondary" htmlFor="arrival-reason">
        Confirm you are on scene anyway — why couldn&rsquo;t GPS confirm it?
      </label>
      <textarea
        id="arrival-reason"
        rows={2}
        maxLength={280}
        value={reason}
        onChange={(event) => onReason(event.target.value)}
        placeholder="e.g. Inside the clubhouse, no GPS signal"
        className="field-textarea mt-1.5 resize-none leading-relaxed"
      />
      <div className="mt-2 flex gap-2 [&>*]:flex-1">
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-action btn-outline">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={!ready || busy} className="btn btn-action btn-brand">
          {busy ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : <MapPinCheck size="sm" aria-hidden="true" />}
          Confirm arrival
        </button>
      </div>
    </div>
  )
}
