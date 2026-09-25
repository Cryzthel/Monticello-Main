import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertOctagon,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Images,
  Loader2,
  IdCard,
  MapPinCheck,
  Navigation,
  Phone,
  Radio,
  Search,
  ShieldAlert,
  Tags,
  Timer,
  UserRoundCheck,
  UserRoundCog,
  X,
} from 'lucide-react'
import StatusBadge from '@shared/components/StatusBadge'
import { categoryTone } from '@shared/theme/badgeStyles'
import Lightbox from '@shared/components/Lightbox'
import { useAuth } from '@shared/auth/AuthContext'
import { useReporterContact } from '@shared/hooks/useReporterContact'
import { buildMediaItems } from '@shared/lib/incidents'
import { categoryLabel } from '@shared/lib/incidentCategories'
import {
  ACK_TIMEOUT_MS,
  ARRIVAL_RADIUS_M,
  INVESTIGATION_PHOTOS_MAX,
  INVESTIGATION_TAGS,
  RESOLUTION_OUTCOMES,
  STAGE_LABELS,
} from '@shared/lib/dispatchStage'
import {
  acknowledgeAndRespond,
  addInvestigationPhotos,
  beginInvestigation,
  canActOn,
  checkArrival,
  confirmArrival,
  dispatchUnit,
  escalateIncident,
  resolveIncident,
  toggleInvestigationTag,
} from '@/lib/dispatchWorkflow'
import {
  dispatchEta,
  formatStopwatch,
  incidentReference,
  residentMessageForStage,
} from '@/lib/dispatch'
import { formatDistance, formatDuration } from '@/lib/directions'
import { ROUTES } from '@/config/portal'
import { UNIT_STATE_LABELS } from '@/hooks/useGuardUnits'
import { useStageAction } from '@/hooks/useStageAction'
import {
  BatteryIndicator,
  CategoryIconBadge,
  ElapsedClock,
  Section,
  StageBadge,
  StageStepper,
  TelemetryBadge,
  initials,
} from '@/components/dispatch/parts'
import EvidenceGrid, { forensicCoordinates, forensicTimestamp } from '@/components/dispatch/EvidenceGrid'
import UnitPicker from '@/components/dispatch/UnitPicker'
import ReasonDialog from '@/components/dispatch/ReasonDialog'
import ResolveIncidentModal from '@/components/dispatch/ResolveIncidentModal'
import { usePhotoUploads } from '@/components/dispatch/usePhotoUploads'
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

const TARGET_TONES = {
  resolved: 'text-success',
  met: 'text-success',
  en_route: 'text-info',
  awaiting: 'text-warning',
  missed: 'text-danger',
  overdue: 'text-danger',
  unknown: 'text-text-muted',
}

const CLOCK = { hour: '2-digit', minute: '2-digit', hour12: false }
const clock = (at) => (at ? new Date(at).toLocaleTimeString('en-GB', CLOCK) : '—')

const ARRIVAL_PRESETS = ['Pin is misplaced', 'GPS unavailable indoors', 'Met resident at the gate', 'Resident moved location']
const ESCALATION_PRESETS = ['Armed or violent suspect', 'Medical emergency', 'Fire or smoke', 'Officer needs backup']

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
      <Icon className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-xs font-medium leading-snug">{feedback.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 opacity-70 transition-[opacity,background-color] duration-150 hover:bg-tint/10 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
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
 * The unit booked to the call: who, how to reach them, and what their device
 * is reporting. `unit` is the live unit from useGuardUnits, or null if the
 * officer has since clocked out.
 */
function AssignedUnit({ report, unit, route, eta }) {
  const roadEta =
    route?.phase === 'ready' && route.route
      ? `${formatDuration(route.route.duration)} · ${formatDistance(route.route.distance)} by road`
      : null
  const distance =
    unit?.distanceM != null ? `${formatDistance(unit.distanceM)} away` : route?.straightM != null ? `${formatDistance(route.straightM)} away` : null
  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-400 ring-1 ring-inset ring-brand-500/30"
        >
          {initials(report.assignedGuardName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">{report.assignedGuardName}</p>
          <p className="truncate text-caption text-text-muted">
            Badge <span className="font-mono">{report.assignedGuardBadge || unit?.badgeNumber || '—'}</span>
            {' · '}
            {unit ? UNIT_STATE_LABELS[unit.state] : 'Not on duty'}
          </p>
        </div>
        <BatteryIndicator battery={unit?.battery} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {unit ? (
          <TelemetryBadge unit={unit} />
        ) : (
          <StatusBadge tone="warning" size="sm">
            Clocked out — no telemetry
          </StatusBadge>
        )}
        {unit?.mode === 'active' ? (
          <StatusBadge tone="info" size="sm" icon={Navigation}>
            High-precision GPS
          </StatusBadge>
        ) : null}
      </div>

      <dl className="mt-3 border-t border-hairline pt-2">
        {report.dispatchStage === 'dispatched' || report.dispatchStage === 'responding' ? (
          <Row label="Road ETA">
            {roadEta ??
              (route?.phase === 'routing'
                ? 'Plotting…'
                : route?.phase === 'no-origin'
                  ? 'No position to route from'
                  : route?.error ?? distance)}
          </Row>
        ) : null}
        {distance && report.dispatchStage !== 'resolved' ? <Row label="Distance">{distance}</Row> : null}
        <Row label="Response">
          <span className={TARGET_TONES[eta.state] ?? TARGET_TONES.unknown}>{eta.label}</span>
          <span className="block text-caption font-normal text-text-muted">{eta.detail}</span>
        </Row>
        {report.arrival ? (
          <Row label="Arrival">
            {report.arrival.withinRadius
              ? `GPS match, ${Math.round(report.arrival.distanceM ?? 0)} m from pin`
              : `Override: ${report.arrival.overrideReason}`}
          </Row>
        ) : null}
      </dl>
    </div>
  )
}

/**
 * Tags, scene photos and the escalation, while INVESTIGATING. Read-only for
 * anyone who cannot act on the call, and once the call is resolved.
 */
function InvestigationPanel({ report, editable, busy, run, role }) {
  const tags = report.investigation?.tags ?? []
  const photoUrls = report.investigation?.photoUrls ?? []
  const room = INVESTIGATION_PHOTOS_MAX - photoUrls.length
  const uploads = usePhotoUploads({ max: Math.max(0, room) })
  const fileRef = useRef(null)
  const [lightbox, setLightbox] = useState(null)

  // Scene photos go on the record as soon as their uploads finish: an officer
  // at a scene should not have to find a second Save button.
  const committingRef = useRef(false)
  // Set when a commit did not land — refused, or blocked because an earlier
  // action on this call is still queued. The uploads stay in the tray and the
  // panel offers to try again.
  const [unsaved, setUnsaved] = useState(false)
  const { urls, uploading, failed, reset } = uploads

  const commitPhotos = useCallback(() => {
    if (committingRef.current || !urls.length) return
    committingRef.current = true
    setUnsaved(false)
    run('photos', 'Scene photos added', () => addInvestigationPhotos(report, urls, { role }))
      .then((landed) => {
        // Clear the tray ONLY once the record holds them. Clearing regardless
        // threw away uploaded evidence whenever the write was refused.
        if (landed) reset()
        else setUnsaved(true)
      })
      .finally(() => {
        committingRef.current = false
      })
  }, [urls, run, report, role, reset])

  useEffect(() => {
    if (!editable || uploading || failed || unsaved) return
    commitPhotos()
  }, [editable, uploading, failed, unsaved, commitPhotos])

  const media = photoUrls.map((url) => ({ url, type: 'image' }))
  const stamp = {
    at: report.investigatingAt,
    lat: report.arrival?.lat ?? report.lat,
    lng: report.arrival?.lng ?? report.lng,
    reference: incidentReference(report.id),
  }

  return (
    <Section icon={Search} title="Investigation" meta={report.investigatingAt ? `since ${clock(report.investigatingAt)}` : null}>
      {report.escalation ? (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-danger">
          <AlertOctagon className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-xs font-medium leading-snug">
            Escalated by {report.escalation.byName} at {clock(report.escalatedAt)}: {report.escalation.reason}
          </p>
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 text-caption font-semibold text-text-muted">
        <Tags className="h-3 w-3" aria-hidden="true" />
        Quick tags
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {INVESTIGATION_TAGS.map((tag) => {
          const on = tags.includes(tag.value)
          if (!editable && !on) return null
          return (
            <button
              key={tag.value}
              type="button"
              aria-pressed={on}
              disabled={!editable || Boolean(busy)}
              onClick={() =>
                run(`tag:${tag.value}`, on ? `${tag.label} removed` : `${tag.label} tagged`, () =>
                  toggleInvestigationTag(report, tag.value, { role }),
                )
              }
              className={`chip px-3 ${on ? 'chip-active' : 'chip-idle'} disabled:opacity-100`}
            >
              {busy === `tag:${tag.value}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
              {tag.label}
            </button>
          )
        })}
        {!editable && !tags.length ? <span className="text-caption text-text-muted">None recorded</span> : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-caption font-semibold text-text-muted">
          <Camera className="h-3 w-3" aria-hidden="true" />
          Scene photos · {photoUrls.length}
        </p>
        {editable && room > 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploads.uploading || Boolean(busy)}
            className="btn btn-drawer btn-outline"
          >
            {uploads.uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Camera className="h-3.5 w-3.5" aria-hidden="true" />}
            {uploads.uploading ? 'Uploading…' : 'Add photos'}
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            uploads.add(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
      {uploads.failed ? (
        <p className="mt-1.5 flex items-center justify-between gap-2 text-caption text-danger">
          A photo failed to upload.
          <button type="button" onClick={uploads.reset} className="font-semibold underline">
            Clear and retry
          </button>
        </p>
      ) : null}
      {unsaved ? (
        <p className="mt-1.5 flex items-center justify-between gap-2 text-caption text-warning">
          {uploads.urls.length} photo{uploads.urls.length === 1 ? '' : 's'} uploaded but not yet on the record.
          <button type="button" onClick={commitPhotos} disabled={Boolean(busy)} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : null}
      {media.length ? (
        <div className="mt-2">
          <EvidenceGrid media={media} stamp={stamp} onOpen={setLightbox} emptyText="" />
        </div>
      ) : null}
      {lightbox !== null ? (
        <Lightbox
          media={media}
          startIndex={lightbox}
          watermark={{
            name: `${stamp.reference} · scene photo`,
            address: forensicCoordinates(stamp.lat, stamp.lng),
            timestamp: forensicTimestamp(stamp.at),
          }}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </Section>
  )
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
export default function DispatchDetailDrawer({ report, units = [], route = null, previewUid, onPreviewUnit, onClose }) {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const uid = user?.uid
  const { contact, loading: contactLoading } = useReporterContact(report?.reporterUid)
  const action = useStageAction(report?.id)
  const { busy, feedback, run, dismiss } = action

  // Focus moves into the panel, stays inside it, and returns to whatever
  // opened the call when it closes. See useDialogFocus for what this was
  // before: `role="dialog"` with none of the behaviour the role promises.
  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(report), containerRef: panelRef })
  const ack = useAckClock(report)

  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [reassigning, setReassigning] = useState(false)
  const [arrivalCheck, setArrivalCheck] = useState(null)
  const [checkingArrival, setCheckingArrival] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    setLightboxIndex(null)
    setReassigning(false)
    setArrivalCheck(null)
    setEscalating(false)
    setResolving(false)
  }, [report?.id])

  // A dialog for a stage the call has left is a dialog for a press that has
  // already happened. Offline, the stage moves locally before the server
  // answers, and leaving the dialog open invited a second press that the
  // rules would refuse when it arrived.
  const stage = report?.dispatchStage
  const escalated = Boolean(report?.escalation)
  useEffect(() => {
    if (stage !== 'dispatched') setReassigning(false)
    if (stage !== 'responding') setArrivalCheck(null)
    if (stage !== 'investigating') setResolving(false)
  }, [stage])
  useEffect(() => {
    if (escalated) setEscalating(false)
  }, [escalated])

  const anyDialog = lightboxIndex !== null || arrivalCheck || escalating || resolving
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
    const label = stage === 'dispatched' ? `Reassigned to ${selectedUnit.name}` : `${selectedUnit.name} dispatched`
    run('dispatch', label, () => dispatchUnit(report, selectedUnit, { role })).then((ok) => {
      if (ok) {
        setReassigning(false)
        onPreviewUnit?.(null)
      }
    })
  }, [selectedUnit, stage, run, report, role, onPreviewUnit])

  const startArrival = useCallback(async () => {
    setCheckingArrival(true)
    let check
    try {
      check = await checkArrival(report)
    } finally {
      setCheckingArrival(false)
    }
    if (check.verdict === 'within') {
      run('arrive', 'Arrival confirmed', () => confirmArrival(report, check, { role }))
    } else {
      setArrivalCheck(check)
    }
  }, [report, run, role])

  if (!report) return null

  const actor = { uid, role }
  const canAct = canActOn(report, actor)
  const isMine = report.assignedGuardUid === uid
  const assignedUnit = report.assignedGuardUid ? units.find((u) => u.uid === report.assignedGuardUid) ?? null : null
  const eta = dispatchEta(report)
  const address = [
    report.phase && `Phase ${report.phase}`,
    report.block && `Block ${report.block}`,
    report.lot && `Lot ${report.lot}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const reference = incidentReference(report.id)
  const media = buildMediaItems(report)
  const stamp = { at: report.reportedAt, lat: report.lat, lng: report.lng, reference }
  const resolutionMedia = (report.resolution?.photoUrls ?? []).map((url) => ({ url, type: 'image' }))
  const outcomeLabel = RESOLUTION_OUTCOMES.find((o) => o.value === report.resolution?.outcome)?.label
  const residentName = report.reportedByName || 'the resident'
  const nextMessage = residentMessageForStage(
    report,
    { dispatched: 'responding', responding: 'on_site', investigating: 'resolved' }[stage],
    report.assignedGuardName,
  )

  const arrivalMessage = (() => {
    if (!arrivalCheck) return ''
    switch (arrivalCheck.verdict) {
      case 'far':
        return `Your GPS puts you ${formatDistance(arrivalCheck.distanceM)} from the pin, outside the ${ARRIVAL_RADIUS_M} m arrival radius.`
      case 'imprecise':
        return `Your GPS fix is only accurate to ±${Math.round(arrivalCheck.accuracyM ?? 0)} m, too coarse to confirm you are within ${ARRIVAL_RADIUS_M} m of the pin.`
      case 'no-pin':
        return 'This report has no map coordinates to measure your position against.'
      default:
        return arrivalCheck.error === 'location-denied'
          ? 'Location access is blocked for this site, so your arrival cannot be checked by GPS.'
          : 'This device could not get a GPS fix to check your arrival.'
    }
  })()

  // ── THE FOOTER: THE ONE NEXT ACTION ──────────────────────────────────────
  let footer = null
  let hint = null
  const spinner = <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />

  if (pickerOpen) {
    footer = (
      <>
        {stage === 'dispatched' ? (
          <button type="button" onClick={() => { setReassigning(false); onPreviewUnit?.(null) }} className="btn btn-drawer btn-outline">
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={!selectedUnit || Boolean(busy)}
          onClick={dispatchSelected}
          className="btn btn-drawer btn-brand flex-1"
        >
          {busy === 'dispatch' ? spinner : <Radio className="h-3.5 w-3.5" aria-hidden="true" />}
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
    footer = (
      <>
        <div
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold ${ack?.expired ? 'text-danger' : 'text-text-secondary'}`}
          aria-live="polite"
        >
          <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {ack?.expired ? 'No acknowledgement' : 'Awaiting acknowledgement'} ·{' '}
            <span className="font-mono tabular-nums">{formatStopwatch(ack?.waited ?? 0)}</span>
          </span>
        </div>
        {!isMine ? (
          <button
            type="button"
            onClick={() => setReassigning(true)}
            disabled={Boolean(busy)}
            className={`btn btn-drawer ${ack?.expired ? 'btn-danger' : 'btn-outline'}`}
          >
            <UserRoundCog className="h-3.5 w-3.5" aria-hidden="true" />
            Reassign
          </button>
        ) : null}
        {canAct ? (
          <button
            type="button"
            onClick={() => run('respond', 'Acknowledged — responding', () => acknowledgeAndRespond(report, { role }))}
            disabled={Boolean(busy)}
            className="btn btn-drawer btn-brand"
          >
            {busy === 'respond' ? spinner : <UserRoundCheck className="h-3.5 w-3.5" aria-hidden="true" />}
            Acknowledge & respond
          </button>
        ) : null}
      </>
    )
    hint = canAct
      ? `${isMine ? 'Switches this device to high-precision GPS until the call is resolved' : `Acknowledges on behalf of ${report.assignedGuardName}`}. Sends: “${nextMessage}”`
      : ack?.expired
        ? `${report.assignedGuardName} has not acknowledged within ${ACK_TIMEOUT_MS / 1000} s, and every console has been alerted. Reassign the call to another unit.`
        : `${report.assignedGuardName} has ${ACK_TIMEOUT_MS / 1000} s to acknowledge before every console is alerted.`
  } else if (stage === 'responding') {
    footer = canAct ? (
      <button
        type="button"
        onClick={startArrival}
        disabled={Boolean(busy) || checkingArrival}
        className="btn btn-drawer btn-brand flex-1"
      >
        {busy === 'arrive' || checkingArrival ? spinner : <MapPinCheck className="h-3.5 w-3.5" aria-hidden="true" />}
        {checkingArrival ? 'Checking your position…' : 'I have arrived'}
      </button>
    ) : null
    hint = canAct
      ? `Checks your GPS is within ${ARRIVAL_RADIUS_M} m of the pin. Sends: “${nextMessage}”`
      : `${report.assignedGuardName} is en route.`
  } else if (stage === 'on_site') {
    footer = canAct ? (
      <button
        type="button"
        onClick={() => run('investigate', 'Investigation started', () => beginInvestigation(report, { role }))}
        disabled={Boolean(busy)}
        className="btn btn-drawer btn-brand flex-1"
      >
        {busy === 'investigate' ? spinner : <Search className="h-3.5 w-3.5" aria-hidden="true" />}
        Begin investigation
      </button>
    ) : null
    hint = canAct
      ? 'Opens scene photos, quick tags and emergency escalation.'
      : `${report.assignedGuardName} arrived at ${clock(report.onSceneAt)}.`
  } else if (stage === 'investigating') {
    footer = canAct ? (
      <>
        <button
          type="button"
          onClick={() => setEscalating(true)}
          disabled={Boolean(busy) || Boolean(report.escalation)}
          className="btn btn-drawer btn-danger"
          title={report.escalation ? 'Already escalated' : undefined}
        >
          <AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" />
          {report.escalation ? 'Escalated' : 'Escalate'}
        </button>
        <button
          type="button"
          onClick={() => setResolving(true)}
          disabled={Boolean(busy)}
          className="btn btn-drawer btn-brand flex-1"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Resolve incident
        </button>
      </>
    ) : null
    hint = canAct
      ? 'Resolving needs an outcome, notes and at least one photo.'
      : `${report.assignedGuardName} is investigating.`
  } else if (stage === 'resolved') {
    footer = (
      <button
        type="button"
        onClick={() => navigate(`${ROUTES.history}?incident=${report.id}`)}
        className="btn btn-drawer btn-outline flex-1"
      >
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        Open in incident history
      </button>
    )
    hint = `Resolved at ${clock(report.resolvedAt)} by ${report.resolvedByName || 'security'}. It has left the live map.`
  }

  if (!canAct && stage !== 'none' && stage !== 'resolved' && !pickerOpen) {
    hint = `${hint} Only ${report.assignedGuardName || 'the assigned officer'} or a supervisor can advance this call.`
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
            <div className="shrink-0 text-right">
              <p className="text-2xs font-semibold text-text-muted">{report.resolvedAt ? 'Took' : 'Elapsed'}</p>
              <ElapsedClock
                since={report.reportedAt}
                until={report.resolvedAt}
                className={`text-lg font-semibold leading-tight ${eta.state === 'overdue' ? 'text-danger' : 'text-text-primary'}`}
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close incident details"
              className="icon-btn icon-btn-sm -mr-1.5 -mt-1 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Stage, then what kind of call and how urgent: the category and
              priority ride here as pills rather than as a label over the title. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <StageBadge stage={stage} />
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
            <StageStepper report={report} />
          </div>
        </header>

        {/* ══ BODY ══ the only band that scrolls. */}
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3.5">
          {/* ── THE DISPATCH CARD ────────────────────────────────────────
              Retitled from "Location", which had stopped being true: the card
              already opened with Resident and Contact, and it now also carries
              the category and the time the call was booked. Those two were
              only in the header — the category as a badge, the timestamp in a
              subline beside the ticket reference — which meant the officer
              reading the details had to look back up to answer "what kind of
              call is this, and how old". Both now sit in the same column as
              everything else they are read with.

              The label gutter stays `w-20`. "Contact number" and "Resident
              name" would wrap inside it, and widening it to fit two words
              would take the space from every value in the drawer — on a panel
              this narrow the values are what the officer is reading. */}
          <Section icon={IdCard} title="Incident details">
            <div className="flex items-start gap-3">
              <dl className="min-w-0 flex-1">
                <Row label="Resident">{report.reportedByName}</Row>
                <Row label="Contact" mono>
                  {contactLoading ? 'Looking up…' : contact?.phone}
                </Row>
                <Row label="Category">{categoryLabel(report.category)}</Row>
                <Row label="Reported">{clock(report.reportedAt)}</Row>
                <Row label="Address">{address || report.location}</Row>
                <Row label="GPS" mono>
                  {typeof report.lat === 'number' ? forensicCoordinates(report.lat, report.lng) : null}
                </Row>
              </dl>
              {contact?.phone ? (
                <a href={`tel:${contact.phone}`} className="btn btn-drawer btn-outline mt-1">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  Call
                </a>
              ) : null}
            </div>
          </Section>

          <Section icon={FileText} title="Reported description">
            {report.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{report.description}</p>
            ) : (
              <p className="text-sm text-text-muted">The resident submitted no written description.</p>
            )}
          </Section>

          <Section icon={Images} title="Evidence" meta={`${media.length} file${media.length === 1 ? '' : 's'}`}>
            <EvidenceGrid
              media={media}
              stamp={stamp}
              onOpen={setLightboxIndex}
              emptyText={report.hasMedia ? 'Media still uploading…' : 'No photos or video were attached.'}
            />
          </Section>

          {pickerOpen ? (
            <Section
              icon={Radio}
              title={stage === 'dispatched' ? `Reassign from ${report.assignedGuardName}` : 'Dispatch a unit'}
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

          {stage !== 'none' ? (
            <Section icon={UserRoundCheck} title="Assigned unit & telemetry" meta={report.dispatchedAt ? `dispatched ${clock(report.dispatchedAt)}` : null}>
              <AssignedUnit report={report} unit={assignedUnit} route={route?.incidentId === report.id ? route : null} eta={eta} />
            </Section>
          ) : null}

          {stage === 'investigating' || report.investigation ? (
            <InvestigationPanel
              report={report}
              editable={stage === 'investigating' && canAct}
              busy={busy}
              run={run}
              role={role}
            />
          ) : null}

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
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-text-secondary">
              {pickerOpen
                ? 'Dispatch'
                : stage === 'resolved'
                  ? 'Call closed'
                  : `Next: ${STAGE_LABELS[{ dispatched: 'responding', responding: 'on_site', on_site: 'investigating', investigating: 'resolved' }[stage]]}`}
            </h3>
            <StageBadge stage={stage} />
          </div>
          {footer ? <div className="mt-2 flex items-center gap-2">{footer}</div> : null}
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

      <ReasonDialog
        open={Boolean(arrivalCheck)}
        icon={MapPinCheck}
        title="Confirm arrival without a GPS match?"
        message={`${arrivalMessage} Say why you are confirming anyway. This goes on the call's record.`}
        presets={ARRIVAL_PRESETS}
        placeholder="e.g. The pin is on the road; the house is 60 m in."
        confirmLabel="Confirm arrival"
        busy={busy === 'arrive'}
        onCancel={() => setArrivalCheck(null)}
        onConfirm={(reason) =>
          run('arrive', 'Arrival confirmed by override', () =>
            confirmArrival(report, arrivalCheck, { role, overrideReason: reason }),
          ).then((ok) => ok && setArrivalCheck(null))
        }
      />

      <ReasonDialog
        open={escalating}
        icon={AlertOctagon}
        tone="danger"
        title="Escalate this incident?"
        message={`Raises a critical alert on every Guardhouse console for ${reference}. Use it when the scene needs more than one officer.`}
        presets={ESCALATION_PRESETS}
        placeholder="What is happening that needs escalation?"
        confirmLabel="Escalate"
        busy={busy === 'escalate'}
        onCancel={() => setEscalating(false)}
        onConfirm={(reason) =>
          run('escalate', 'Incident escalated', () => escalateIncident(report, reason, { role })).then(
            (ok) => ok && setEscalating(false),
          )
        }
      />

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
