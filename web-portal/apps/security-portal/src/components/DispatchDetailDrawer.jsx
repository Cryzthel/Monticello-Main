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
  INVESTIGATION_TAGS,
  deriveDispatchStage,
  RESOLUTION_OUTCOMES,
} from '@shared/lib/dispatchStage'
import {
  acknowledgeAndRespond,
  canActOn,
  dispatchUnit,
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

/**
 * Width of the desktop rail, in px, exported so the dispatch page can tell the
 * map how much of its right edge is spoken for. It IS this component's
 * `lg:w-[26rem]`. Two places holding it independently is how a centred
 * marker ends up under the panel.
 */
export const DRAWER_WIDTH_PX = 416

const PRIORITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

/** The priority field's left rule, coloured like its pill (as in the Admin ticket). */
const PRIORITY_RULE = {
  danger: 'border-danger/50',
  high: 'border-orange-500/50',
  warning: 'border-warning/50',
  info: 'border-info/50',
  success: 'border-success/50',
}

/** Where the call stands, as the header pill (the Admin ticket's stage pill). */
function stagePill(stage, ackExpired) {
  if (stage === 'none') return { text: 'Awaiting acknowledgement', tone: 'warning', pulse: true, icon: Radio }
  if (stage === 'dispatched')
    return ackExpired
      ? { text: 'No acknowledgement', tone: 'danger', pulse: true, icon: Timer }
      : { text: 'Acknowledged · ready to navigate', tone: 'info', pulse: true, icon: ShieldCheck }
  if (stage === 'responding') return { text: 'Guard dispatched · en route', tone: 'info', pulse: true, icon: Navigation }
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
 *   │ [ the ONE next action for this stage ]  [Close]            pinned    │
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
 * which restarts a stalled stream and rolls back on a refusal.
 *
 * From `lg` up this is a right-hand rail with no scrim (the map stays live);
 * below `lg` it is a bottom sheet with a scrim.
 *
 * `navigation` (from the dispatch page), for an active call:
 *   { state: 'ready' | 'active' | 'routing' | 'unavailable', reason?, onStart, onExit, onCommitted }
 */
export default function DispatchDetailDrawer({ report, units = [], previewUid, onPreviewUnit, onClose, navigation = null }) {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const uid = user?.uid
  const { busy, feedback, offline, run, dismiss } = useStageAction(report?.id)

  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(report), containerRef: panelRef })
  const ack = useAckClock(report)

  const [mediaLightbox, setMediaLightbox] = useState(false)
  /** The resolution grid has its own, because it shows different media. */
  const [resolutionLightbox, setResolutionLightbox] = useState(null)
  const [reassigning, setReassigning] = useState(false)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    setResolutionLightbox(null)
    setReassigning(false)
    setResolving(false)
  }, [report?.id])

  // One stage, derived, for every part of this panel — never the raw stored
  // value, which reads the retired `on_site` / `investigating` as nothing.
  const stage = deriveDispatchStage(report)
  useEffect(() => {
    if (stage !== 'dispatched') setReassigning(false)
    if (stage !== 'responding') setResolving(false)
  }, [stage])

  const anyDialog = mediaLightbox || resolutionLightbox !== null || resolving
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
  const pill = stagePill(stage, ack?.expired)

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
  } else if (stage === 'responding') {
    // Arrival is stamped from the officer's own GPS; the button turns primary
    // on arrival but is never taken away, so a bad fix cannot strand a call.
    footer = canAct ? (
      <button
        type="button"
        onClick={() => setResolving(true)}
        disabled={Boolean(busy)}
        className={`btn btn-action ${report.onSceneAt ? 'btn-brand' : 'btn-outline'}`}
      >
        <CheckCircle2 size="sm" aria-hidden="true" />
        Resolve incident
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
        className="btn btn-action btn-outline !basis-full whitespace-nowrap"
      >
        <History size="sm" aria-hidden="true" className="shrink-0" />
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
        className="pointer-events-auto relative flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-modal animate-[riseIn_220ms_var(--ease-spring)] lg:h-full lg:w-[26rem] lg:animate-[drawerInRight_260ms_var(--ease-spring)] lg:rounded-none lg:border-y-0 lg:border-r-0"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close incident details"
          className="flex h-6 shrink-0 items-center justify-center pt-2 lg:hidden"
        >
          <span className="h-1 w-9 rounded-full bg-tint/25" />
        </button>

        {/* ══ HEADER ══ the Admin ticket's header, sized for a rail. */}
        <header className="relative shrink-0 border-b border-hairline px-4 pb-4 pt-4 pr-12">
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
            className="absolute right-3 top-3 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
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
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain bg-base-950/40 p-4">
          {pickerOpen ? (
            <DetailCard
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
        <footer className="relative shrink-0 border-t border-hairline bg-base-950 px-4 pb-4 pt-3">
          {feedback ? <Receipt feedback={feedback} onDismiss={dismiss} /> : null}
          {status ? <div className="mt-1">{status}</div> : null}
          {/* START NAVIGATION — its own full-width row above the stage
              actions: getting to the call comes before any stage action. */}
          {navigation && stage === 'responding' ? (
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
          {/* The stage action and Close share the row at equal size; Close is
              last so the thumb never lands on it for the thing it meant. The
              header ✕ is the same control for a pointer; this one is where a
              phone thumb already is. */}
          <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-[8.5rem] [&>*]:flex-1">
            {footer}
            <button type="button" onClick={onClose} className="btn btn-action btn-outline">
              Close
            </button>
          </div>
          {offline && stage !== 'resolved' ? (
            <p className="mt-2 flex items-center gap-1.5 text-caption font-semibold leading-snug text-warning" role="status">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              Offline — actions save on this device and sync when the signal returns.
            </p>
          ) : null}
          {hint ? <p className="mt-2 text-caption leading-snug text-text-muted">{hint}</p> : null}
        </footer>
      </aside>

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
