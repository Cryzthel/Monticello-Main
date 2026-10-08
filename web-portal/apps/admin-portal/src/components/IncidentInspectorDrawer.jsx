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
import { MetaItem, MetaList } from '@shared/components/MetaList'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useReporterContact } from '@shared/hooks/useReporterContact'
import { useStaffAccounts } from '@shared/hooks/useStaffAccounts'
import { buildMediaItems, isArchived } from '@shared/lib/incidents'
import { isOfficerFiled } from '@shared/lib/staffFiling'
import { categoryLabel } from '@shared/lib/incidentCategories'
import { relativeTime } from '@shared/lib/notifications'
import { DISPATCH_STAGES, STAGE_LABELS, stageIndex } from '@shared/lib/dispatchStage'
import { normalizeResidentStatus, RESIDENT_STATUS, RESIDENT_STATUS_LABELS } from '@shared/lib/residents'

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

function Group({ icon: Icon, title, action, children }) {
  return (
    <div className="p-6">
      <header className="mb-4 flex min-h-6 items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary">
          {Icon ? <Icon size="sm" className="shrink-0 text-brand-400" /> : null}
          {title}
        </h3>
        {action}
      </header>
      {children}
    </div>
  )
}


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

  const address = [
    report.phase && `Phase ${report.phase}`,
    report.block && `Block ${report.block}`,
    report.lot && `Lot ${report.lot}`,
  ]
    .filter(Boolean)
    .join(' • ')

  const household = normalizeResidentStatus(contact?.verificationStatus ?? contact?.status)
  const reporterInitial = (report.reportedByName || '?').trim().charAt(0).toUpperCase() || '?'

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

        {/* ══ HEADER BANNER ══ what this is, and its quotable code.
            The severity pill, the status and the category moved down into
            "Incident" and the timestamps into "Reporter", where the
            reorganised card asks for them. They are NOT also printed here:
            this header sits 16px above that card, and a severity stated twice
            inside one viewport is the redundancy the rest of this panel has
            been spending changes to remove. */}
        <header className="shrink-0 border-b border-hairline px-4 pb-3 pt-3.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-base font-semibold leading-snug text-text-primary">{title}</h2>
              <p className="mt-1 font-mono text-caption font-semibold text-text-secondary">
                {ticketCode(report.id)}
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
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
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
                    {archived ? (
                      <StatusBadge tone="neutral" size="sm" icon={Archive}>
                        Archived
                      </StatusBadge>
                    ) : null}
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

            {/* ── 2. INCIDENT OVERVIEW & SEVERITY ───────────────────────── */}
            <Group icon={Radio} title="Incident">
              <p className="text-sm font-semibold text-text-primary">{categoryLabel(report.category)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <PriorityBadge severity={severity} size="sm" icon={SeverityIcon}>
                  {SEVERITY_LABELS[severity] ?? 'Medium'}
                </PriorityBadge>
                <StatusBadge status={report.status ?? 'Pending'} size="sm" />
              </div>
              <div className="mt-4">
                <StageReadout report={report} />
              </div>
              <MetaList className={`mt-4 ${META}`}>
                <MetaItem label="Assigned to">{report.assignedGuardName}</MetaItem>
              </MetaList>
            </Group>

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

            {/* ── 4. INCIDENT DESCRIPTION ───────────────────────────────── */}
            {report.description ? (
              <Group icon={AlignLeft} title="Description">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                  {report.description}
                </p>
              </Group>
            ) : null}

            {/* ── 5. ATTACHED EVIDENCE ──────────────────────────────────
                A grid, not a stage with a filmstrip. The shared modal gives
                evidence a large frame because it has a two-column body to
                spend it on. This rail is 416px wide, so one big frame would
                push every fact below the fold. */}
            <Group
              icon={Images}
              title="Evidence"
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
            </Group>
          </section>
        </div>

        {/* ── NO ACTION BAR, AND THAT IS THE POINT ────────────────────────
            This rail used to end in a pinned footer of four buttons: Call
            reporter, Directions, Copy coordinates, Archive. They are gone by
            request, and the panel is now a strictly read-only inspection view.

            The record reads better for it. A detail panel that also dispatches
            has to answer "what can I do here" on every line, and the two
            questions compete. What is left is one job, done plainly — what was
            reported, where, by whom, and what the evidence shows.

            The paragraph that used to say so inside the Dispatch group — that
            dispatch, escalation and resolution belong to the Guardhouse — was
            removed with the "Dispatched by" row. Nothing on the panel now
            states that the absence of controls is deliberate, so an
            administrator hunting for a Dispatch button has only this comment
            and the read-only stage readout to go on.

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
