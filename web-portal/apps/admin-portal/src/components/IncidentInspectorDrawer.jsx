import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertOctagon,
  AlignLeft,
  Archive,
  BadgeCheck,
  Check,
  IdCard,
  ImageOff,
  Images,
  MapPin,
  Radio,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  User,
  X,
} from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import PriorityBadge from '@shared/components/PriorityBadge'
import EvidenceImage from '@shared/components/EvidenceImage'
import Lightbox from '@shared/components/Lightbox'
import { MetaItem, MetaList, MetaSection } from '@shared/components/MetaList'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useNow } from '@shared/hooks/useNow'
import { useReporterContact } from '@shared/hooks/useReporterContact'
import { useStaffAccounts } from '@shared/hooks/useStaffAccounts'
import { buildMediaItems, isArchived } from '@shared/lib/incidents'
import { isOfficerFiled } from '@shared/lib/staffFiling'
import { categoryLabel } from '@shared/lib/incidentCategories'
import { relativeTime } from '@shared/lib/notifications'
import { DISPATCH_STAGES, STAGE_LABELS, stageIndex } from '@shared/lib/dispatchStage'
import { normalizeResidentStatus, RESIDENT_STATUS, RESIDENT_STATUS_LABELS } from '@shared/lib/residents'
import { boundaryCenter, containsPoint } from '@shared/lib/subdivisionBoundary'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import { describeSlaBreach, isServerRecordedBreach, slaBreachState } from '@shared/lib/operationsTargets'

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

// A severity pill carries its own glyph rather than a bare dot, so the level
// survives a greyscale print of the record and never rests on colour alone.
const SEVERITY_ICONS = {
  critical: AlertOctagon,
  high: ShieldAlert,
  medium: ShieldQuestion,
  low: ShieldCheck,
}

/** The timestamp stamped at each stage, for the stepper's per-step time. */
const STAGE_STAMPS = {
  dispatched: 'dispatchedAt',
  responding: 'respondingAt',
  on_site: 'onSceneAt',
  investigating: 'investigatingAt',
  resolved: 'resolvedAt',
}

/** Human-quotable code, derived from the document id — the one IncidentsTable prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

const PREMISES_CENTRE = boundaryCenter()

/*
 * Body padding for every card in this rail.
 *
 * 24px, where the shared default is 16px. This is a single column of stacked
 * cards with nothing beside it, so the card edge is the only thing separating
 * a label from the panel wall, and 16px read as tight once the action footer
 * came off and the eye had nothing else to land on.
 *
 * Measured at the rail's real 416px before it was adopted: p-6 costs 75px of
 * total scroll and wraps nothing. The coordinate row is the narrowest thing in
 * here and still holds one line, which is the test that mattered — a
 * latitude/longitude broken across two lines is unreadable as a pair.
 *
 * One constant rather than five literals: five cards that are supposed to be
 * one object should not be able to disagree about their own padding.
 */
const CARD_BODY = 'p-6'

const exactTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const shortTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { timeStyle: 'short' })
}

/**
 * Great-circle distance in metres.
 *
 * Written here rather than pulled from the Guardhouse's `directions` module
 * because that one is about a ROUTE — it formats the distance the Mapbox
 * Directions API returns for a path along roads. This is a straight line from
 * the premises centre, a different measurement that must not be mistaken for a
 * driving distance. The two deliberately do not share a helper.
 */
function haversineMetres([lngA, latA], [lngB, latB]) {
  const R = 6_371_000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(latB - latA)
  const dLng = rad(lngB - lngA)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** Eight points, not sixteen. "NNE" is false precision across a 400 m estate. */
function compassFrom([lngA, latA], [lngB, latB]) {
  const rad = (d) => (d * Math.PI) / 180
  const dLng = rad(lngB - lngA)
  const y = Math.sin(dLng) * Math.cos(rad(latB))
  const x =
    Math.cos(rad(latA)) * Math.sin(rad(latB)) - Math.sin(rad(latA)) * Math.cos(rad(latB)) * Math.cos(dLng)
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return COMPASS[Math.round(deg / 45) % 8]
}

const formatMetres = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`)

/**
 * ── THE DISPATCH STAGE, READ-ONLY AND SAYING SO ────────────────────────────
 *
 * The same five-step machine the Guardhouse drives, drawn here as a readout
 * and nothing more. There is no control on it, and that is not an oversight.
 *
 * `firestore.rules` grants admin staff `allow update … && !touchesWorkflow()`,
 * and `workflowFields()` lists `status`, `dispatchStage`, `assignedGuardUid`,
 * `escalation` and `resolution` among them. An administrator pressing
 * "Dispatch" here would be refused by the server, so offering the button would
 * be offering a lie. The stage still belongs on this panel: an administrator
 * looking at a pin needs to know whether anyone is on it, and until now the
 * only way to find out was to leave the map.
 */
function StageReadout({ report }) {
  const current = stageIndex(report.dispatchStage)

  return (
    <ol className="grid grid-cols-5" aria-label="Dispatch stage">
      {DISPATCH_STAGES.map((stage, i) => {
        const step = i + 1
        const done = step < current || (step === current && stage === 'resolved')
        const active = step === current && !done
        const at = report[STAGE_STAMPS[stage]]
        return (
          <li
            key={stage}
            aria-current={active ? 'step' : undefined}
            className="relative flex min-w-0 flex-col items-center text-center"
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={`absolute right-1/2 top-2.5 h-0.5 w-full -translate-y-1/2 ${
                  step <= current ? 'bg-brand-500' : 'bg-tint/10'
                }`}
              />
            ) : null}
            <span
              className={`relative z-[1] flex h-5 w-5 items-center justify-center rounded-full text-2xs font-bold ${
                done
                  ? 'bg-brand-500 text-base-900'
                  : active
                    ? 'bg-base-800 text-brand-400 ring-2 ring-brand-500'
                    : 'bg-base-800 text-text-muted ring-1 ring-tint/15'
              }`}
            >
              {done ? <Check size="sm" strokeWidth={3} aria-hidden="true" /> : step}
            </span>
            <span
              className={`mt-1 w-full truncate px-0.5 text-2xs font-semibold ${
                active ? 'text-text-primary' : done ? 'text-text-secondary' : 'text-text-muted'
              }`}
            >
              {STAGE_LABELS[stage]}
            </span>
            {/* The time each step was reached, where there is one. A stepper
                without them states the order; with them it states the
                response. The non-breaking space holds the row's height so the
                five columns stay aligned when only some stages have a stamp. */}
            <span className="w-full truncate text-2xs leading-tight text-text-muted">
              {at ? shortTime(at) : ' '}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * ── THE HAZARD MAP'S INSPECTION PANEL ──────────────────────────────────────
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
 */
export default function IncidentInspectorDrawer({ report, onClose }) {
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const { contact, loading: contactLoading } = useReporterContact(report?.reporterUid)
  const { staffIds } = useStaffAccounts()
  const now = useNow()
  const ackTargetMinutes = useSystemSettings((state) => state.values.incidents.ackTargetMinutes)
  const resolveTargetHours = useSystemSettings((state) => state.values.incidents.resolveTargetHours)

  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(report), containerRef: panelRef })

  // Per-report view state, reset when the rail is pointed at a different pin.
  // It stays mounted between selections — clicking pin B while pin A is open
  // swaps the content rather than unmounting and remounting — so nothing in
  // here resets on its own.
  useEffect(() => {
    setLightboxIndex(null)
  }, [report?.id])

  /*
   * Escape closes the rail, unless the Lightbox is up — that owns Escape while
   * it is open, so this defers rather than closing both at once and dumping the
   * operator back to a bare map from a full-screen photo.
   */
  useEffect(() => {
    if (!report || lightboxIndex !== null) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [report, lightboxIndex, onClose])

  const media = useMemo(() => buildMediaItems(report), [report])

  if (!report) return null

  const title = report.title || `${categoryLabel(report.category)} report`
  const severity = report.severity ?? 'medium'
  const SeverityIcon = SEVERITY_ICONS[severity] ?? ShieldQuestion
  const archived = isArchived(report)
  const officerFiled = isOfficerFiled(report, staffIds)

  const hasFix = typeof report.lat === 'number' && typeof report.lng === 'number'
  const coordinates = hasFix ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}` : ''
  const inBounds = hasFix && containsPoint({ lat: report.lat, lng: report.lng })
  const proximity = hasFix
    ? `${formatMetres(haversineMetres(PREMISES_CENTRE, [report.lng, report.lat]))} ${compassFrom(
        PREMISES_CENTRE,
        [report.lng, report.lat],
      )} of centre`
    : ''

  const address = [
    report.phase && `Phase ${report.phase}`,
    report.block && `Block ${report.block}`,
    report.lot && `Lot ${report.lot}`,
  ]
    .filter(Boolean)
    .join(' • ')

  const household = normalizeResidentStatus(contact?.verificationStatus ?? contact?.status)
  const slaTargets = { ackTargetMinutes, resolveTargetHours }
  const slaBreach = describeSlaBreach(slaBreachState(report, now, slaTargets), slaTargets)

  const watermark = {
    name: report.reportedByName ?? 'Unknown resident',
    address: address || 'Address unavailable',
    timestamp: report.reportedAt ? new Date(report.reportedAt).toLocaleString() : 'Timestamp unavailable',
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
        aria-label={`Incident ${ticketCode(report.id)}`}
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

        {/* ══ HEADER BANNER ══ what this is, how urgent, and exactly when. */}
        <header className="shrink-0 border-b border-hairline px-4 pb-3 pt-3.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-base font-semibold leading-snug text-text-primary">{title}</h2>
              <p className="mt-1 text-caption text-text-muted">
                <span className="font-mono font-semibold text-text-secondary">{ticketCode(report.id)}</span>
                {' · '}
                {exactTime(report.reportedAt) || 'Time unavailable'}
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

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <PriorityBadge severity={severity} size="sm" icon={SeverityIcon}>
              {SEVERITY_LABELS[severity] ?? 'Medium'}
            </PriorityBadge>
            <StatusBadge status={report.status ?? 'Pending'} size="sm" />
            <StatusBadge tone="neutral" size="sm" dot>
              {categoryLabel(report.category)}
            </StatusBadge>
            {archived ? (
              <StatusBadge tone="neutral" size="sm" icon={Archive}>
                Archived
              </StatusBadge>
            ) : null}
          </div>

          {/* Relative time under the exact one, not instead of it. "14 minutes
              ago" is what an operator reasons with; the timestamp is what they
              quote into a log. A record needs both. */}
          <p className="mt-1.5 text-2xs text-text-muted">{relativeTime(report.reportedAt)}</p>
        </header>

        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
          {/* ══ DISPATCH ══ */}
          <MetaSection icon={Radio} title="Dispatch" bodyClassName={CARD_BODY}>
            <StageReadout report={report} />
            <div className="mt-3 border-t border-hairline pt-3">
              <MetaList>
                <MetaItem label="Assigned to">{report.assignedGuardName}</MetaItem>
                <MetaItem label="Dispatched by">{report.dispatchedByName}</MetaItem>
              </MetaList>
            </div>
            {slaBreach ? (
              <p className="mt-2 text-2xs leading-relaxed text-warning">
                {slaBreach}{' '}
                {isServerRecordedBreach(report)
                  ? 'Recorded against the report by the scheduled sweep.'
                  : 'Derived from this report’s timestamps; the scheduled sweep has not recorded it.'}
              </p>
            ) : null}
            {/* Stated once, plainly, where the buttons would otherwise be. An
                administrator who cannot find a Dispatch control should learn
                that its absence is deliberate, not go hunting for it. */}
            <p className="mt-2 text-2xs leading-relaxed text-text-muted">
              Dispatch, escalation and resolution are performed by the Guardhouse, which holds the
              officer telemetry each stage is recorded with. This console reads the workflow.
            </p>
          </MetaSection>

          {/* ══ GEOSPATIAL LOCATION ══ */}
          <MetaSection icon={MapPin} title="Location" bodyClassName={CARD_BODY}>
            <MetaList>
              <MetaItem label="Address">{address || report.location}</MetaItem>
              {/* `location` is `describeIncidentLocation`, which composes the
                  very phase/block/lot string above whenever the document has no
                  `propertyLabel` and no free-text location — so for most reports
                  this row printed the Address again, verbatim, one line below
                  it. Shown only when it actually says something else. */}
              <MetaItem label="Reported at" hidden={!report.location || report.location === address}>
                {report.location}
              </MetaItem>
              <MetaItem label="Coordinates" mono>
                {coordinates}
              </MetaItem>
              <MetaItem label="Proximity">{proximity}</MetaItem>
              <MetaItem label="Premises">
                {hasFix ? (
                  <span className={`inline-flex items-center gap-1.5 ${inBounds ? '' : 'text-warning'}`}>
                    {inBounds ? <ShieldCheck size="sm" className="text-success" /> : <ShieldAlert size="sm" />}
                    {inBounds ? 'Inside Monticello Villas' : 'Outside the boundary'}
                  </span>
                ) : null}
              </MetaItem>
            </MetaList>
          </MetaSection>

          {/* ══ REPORTER METADATA ══ */}
          <MetaSection
              icon={officerFiled ? IdCard : User}
              title={officerFiled ? 'Filed by officer' : 'Resident'}
              bodyClassName={CARD_BODY}
            >
            <MetaList>
              <MetaItem label="Name">{report.reportedByName}</MetaItem>
              <MetaItem label="Phone">
                {contactLoading ? <span className="text-text-muted">{'Looking up…'}</span> : contact?.phone}
              </MetaItem>
              {/* ── HOUSEHOLD, NOT "VERIFIED CONTACT" ───────────────────────
                  This is the household's VERIFICATION status — whether an
                  administrator has confirmed the resident owns or occupies the
                  lot. It is not a verified phone number: nothing in this system
                  sends a code to that handset, so a tick beside the number would
                  claim a check that never happened. The badge sits on the row
                  whose claim it actually supports. */}
              <MetaItem label="Household" hidden={officerFiled}>
                {contactLoading ? (
                  <span className="text-text-muted">{'Looking up…'}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {household === RESIDENT_STATUS.verified ? (
                      <BadgeCheck size="sm" className="text-success" />
                    ) : household === RESIDENT_STATUS.rejected ? (
                      <ShieldX size="sm" className="text-danger" />
                    ) : (
                      <ShieldQuestion size="sm" className="text-warning" />
                    )}
                    {RESIDENT_STATUS_LABELS[household]}
                  </span>
                )}
              </MetaItem>
              {/* NO "Residence" ROW. It was here, and it printed the Address
                  from the Location section again — the same characters, eight
                  lines apart. They are not two facts that happen to agree:
                  `phase`/`block`/`lot` on an incident ARE the reporting
                  resident's property fields, so the two rows can never differ.
                  The pin's own coordinates, above, are the one piece of
                  geography that says where the incident actually is. */}
            </MetaList>
          </MetaSection>

          {/* ══ DESCRIPTION ══ */}
          {report.description ? (
            <MetaSection icon={AlignLeft} title="Description" bodyClassName={CARD_BODY}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{report.description}</p>
            </MetaSection>
          ) : null}

          {/* ══ EVIDENCE ══ a grid, not a stage with a filmstrip.
              The shared modal gives evidence a large frame because it has a
              two-column body to spend it on. This rail is 416px wide, so one
              big frame would push every fact below the fold. A three-up grid
              shows the whole set at a glance and opens any of it full-screen,
              which is the gesture that actually gets used. */}
          <MetaSection
            icon={Images}
            title="Evidence"
            bodyClassName={CARD_BODY}
            action={
              <span className="text-2xs font-medium text-text-muted">
                {media.length} file{media.length === 1 ? '' : 's'}
              </span>
            }
          >
            {media.length ? (
              <div className="grid grid-cols-3 gap-2">
                {media.map((item, index) => (
                  <button
                    key={item.url}
                    type="button"
                    onClick={() => setLightboxIndex(index)}
                    aria-label={`Open evidence ${index + 1} of ${media.length}`}
                    className="relative aspect-square overflow-hidden rounded-lg border border-hairline bg-base-950 transition-[border-color] duration-150 hover:border-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {item.type === 'video' ? (
                      <>
                        <video src={item.url} className="h-full w-full object-cover" muted />
                        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-2xs font-semibold text-white">
                          Video
                        </span>
                      </>
                    ) : (
                      <EvidenceImage src={item.url} />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-4 text-center">
                <ImageOff size="md" className="text-text-muted" />
                <p className="text-caption text-text-secondary">
                  {report.hasMedia ? 'Media still uploading…' : 'No media attached'}
                </p>
              </div>
            )}
          </MetaSection>
        </div>

        {/* ── NO ACTION BAR, AND THAT IS THE POINT ────────────────────────
            This rail used to end in a pinned footer of four buttons: Call
            reporter, Directions, Copy coordinates, Archive. They are gone by
            request, and the panel is now a strictly read-only inspection view.

            The record reads better for it. A detail panel that also dispatches
            has to answer "what can I do here" on every line, and the two
            questions compete: the Dispatch section already explains that the
            workflow belongs to the Guardhouse, and a row of controls under it
            argued the opposite. What is left is one job, done plainly — what
            was reported, where, by whom, and what the evidence shows.

            The facts the buttons acted on are all still on screen and
            selectable: the phone number in Reporter, the coordinates in
            Location. Nothing an operator could reach from here has been
            hidden, only the shortcuts that performed it.

            ARCHIVE IS THE ONE REAL LOSS, and it is worth stating plainly
            rather than discovering later. This rail was the only manual way an
            administrator could archive a RESIDENT-filed incident: the ticket
            queue has no archive control, and Admin > Reports filters to
            `staffById.has(report.reporterUid)`, so officer-filed reports only.
            What still archives a resident report is the scheduled sweep, and
            only once it is RESOLVED and past its TTL. An open resident report
            now has no manual archive path anywhere in the console. */}
      </aside>

      {lightboxIndex !== null ? (
        <Lightbox
          media={media}
          startIndex={lightboxIndex}
          watermark={watermark}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  )
}
