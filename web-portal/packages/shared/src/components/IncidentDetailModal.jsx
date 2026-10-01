import { useEffect, useRef, useState } from 'react'
import {
  AlignLeft,
  FileText,
  ImageOff,
  MapPin,
  Phone,
  ShieldCheck,
  ShieldQuestion,
  User,
  X,
} from '@shared/icons'
import PriorityBadge from '@shared/components/PriorityBadge'
import Lightbox from '@shared/components/Lightbox'
import StatusBadge from '@shared/components/StatusBadge'
import EvidenceImage from '@shared/components/EvidenceImage'
import { MetaItem, MetaList, MetaSection } from '@shared/components/MetaList'
import { useReporterContact } from '@shared/hooks/useReporterContact'
import { buildMediaItems } from '@shared/lib/incidents'
// Only `formatCategory` now. `computePriorityScore`, `minutesWaiting` and
// `categoryWeightOf` were imported solely to render the WPDA readout this modal
// no longer shows — see the note in the detail column below. The scoring still
// runs server-side; this file just stopped narrating it.
import { formatCategory } from '@shared/lib/wpda'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useNow } from '@shared/hooks/useNow'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import {
  describeSlaBreach,
  isServerRecordedBreach,
  slaBreachState,
} from '@shared/lib/operationsTargets'

const URGENCY_LABELS = {
  critical: 'Critical priority',
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
}

/** Human-quotable code, derived from the document id — the same one IncidentsTable prints. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

const when = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Shared by both portals — the Admin ticket queue, the Admin Hazard Map and the
 * Guard triage queue open the exact same modal, so a resident's full profile,
 * evidence and status look identical no matter who is viewing them.
 *
 * ── THE DETAIL COLUMN IS A RECORD, NOT A SUMMARY ─────────────────────────
 * It used to show a priority badge, a resident card, the description, an
 * evidence count and the status — and nothing else. The ticket code, when the
 * report was filed (except inside the photo's watermark), where it was filed,
 * its coordinates, who was sent and when it was dispatched or closed were all
 * absent, so an administrator who clicked a pin on the Hazard Map to find out
 * about an incident had to leave the map to find out. Those facts now sit in
 * labelled groups built from the shared MetaList, with every label at the same
 * 14px as the value beside it.
 *
 * BOTTOM SHEET BELOW `sm`, CENTRED DIALOG ABOVE IT
 * ------------------------------------------------
 * As a centred dialog at every width this was unusable on a phone. The panel is
 * a fixed-height flex column whose body is a single-column grid: the evidence
 * pane claims its `min-h-[16rem]`, the detail column stacks underneath —
 * comfortably more than the remaining height — and the panel's own
 * `overflow-hidden` clipped it.
 *
 * So below `sm` it anchors to the bottom edge, takes 92dvh, and the GRID is the
 * scroll container rather than the detail column: one continuous scroll from
 * the photo through to the last fact, which is the gesture a sheet implies.
 * `dvh` not `vh` for the reason DashboardLayout gives — `vh` measures against
 * the retracted URL bar, so the last rows hide under the browser chrome.
 */
export default function IncidentDetailModal({ report, onClose }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const { contact, loading: contactLoading } = useReporterContact(report?.reporterUid)

  // Per-report view state, reset when the sheet is pointed at a different one.
  useEffect(() => {
    setActiveIndex(0)
    setLightboxIndex(null)
  }, [report?.id])

  /*
   * Escape closes the sheet. Previously the only way out was the × or a tap on
   * the backdrop — and on a phone the backdrop is a 16px margin at the top of
   * the screen, so in practice the × was the only exit. The Lightbox owns Escape
   * while it is open, so this defers to it rather than closing both at once and
   * dumping the user back to the list from a full-screen photo.
   */
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

  // Above the early return, because hooks cannot be called conditionally and
  // `report` is null whenever the modal is closed.
  const ackTargetMinutes = useSystemSettings((state) => state.values.incidents.ackTargetMinutes)
  const resolveTargetHours = useSystemSettings((state) => state.values.incidents.resolveTargetHours)
  const now = useNow()

  if (!report) return null

  const media = buildMediaItems(report)
  const active = media[activeIndex]
  const urgencyLabel = URGENCY_LABELS[report.severity] ?? URGENCY_LABELS.medium
  const slaTargets = { ackTargetMinutes, resolveTargetHours }
  const slaBreach = describeSlaBreach(slaBreachState(report, now, slaTargets), slaTargets)
  const serverRecorded = isServerRecordedBreach(report)
  const address = `Phase ${report.phase ?? '—'} • Block ${report.block ?? '—'} • Lot ${report.lot ?? '—'}`
  const coordinates =
    typeof report.lat === 'number' && typeof report.lng === 'number'
      ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`
      : ''

  const watermark = {
    name: report.reportedByName ?? 'Unknown resident',
    address,
    timestamp: report.reportedAt ? new Date(report.reportedAt).toLocaleString() : 'Timestamp unavailable',
  }

  const title = report.title || formatCategory(report.category)

  return (
    <div
      className="dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card dialog-panel flex max-h-[80dvh] w-full max-w-4xl flex-col overflow-hidden rounded-b-none bg-base-900 shadow-modal sm:h-full sm:max-h-[44rem] sm:rounded-b-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Grab handle — the affordance that says "this sheet dismisses",
            and a tap target for it. Sheets on both platforms have one. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-6 shrink-0 items-center justify-center pt-2 sm:hidden"
        >
          <span className="h-1 w-9 rounded-full bg-tint/25" />
        </button>

        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-primary">{title}</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-text-secondary">{ticketCode(report.id)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report details"
            className="btn btn-icon-sm min-h-11 min-w-11 shrink-0 text-text-secondary hover:text-text-primary sm:min-h-0 sm:min-w-0"
          >
            <X size="md" />
          </button>
        </div>

        {/*
          Below `lg` this is the scroll container for the whole sheet; from `lg`
          up it is the fixed two-column body and the right-hand column scrolls
          on its own. `overscroll-contain` stops a flick that reaches the end
          from chaining into the page behind the backdrop.

          FLEX COLUMN BELOW `lg`, NOT A ONE-COLUMN GRID. Measured: as a grid
          with a definite height, the two auto rows are fitted to the container
          rather than overflowing it — the detail column was handed 435px for
          940px of content and simply clipped, and because nothing overflowed,
          `scrollHeight === clientHeight` and the sheet would not scroll either.
          As a flex column with `shrink-0` children the rows keep their content
          height, the body's scrollHeight exceeds its client height, and the
          sheet scrolls. `flex-shrink` is ignored on grid items, so `shrink-0`
          costs nothing at `lg`.
        */}
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:grid lg:grid-cols-[1.3fr_1fr] lg:overflow-hidden">
          <div className="relative flex min-h-[14rem] shrink-0 flex-col bg-black sm:min-h-[16rem]">
            <button
              type="button"
              onClick={() => active && setLightboxIndex(activeIndex)}
              disabled={!active}
              className="relative flex-1 disabled:cursor-default"
            >
              {active ? (
                active.type === 'video' ? (
                  <video src={active.url} controls className="h-full w-full object-contain" />
                ) : (
                  <EvidenceImage src={active.url} alt="Incident evidence" fit="contain" eager />
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/70">
                  <ImageOff size="lg" />
                  {report.hasMedia ? 'Media still uploading…' : 'No media attached'}
                </div>
              )}

              {/* White, not `text-text-primary`: this caption sits on a black
                  gradient in both themes, and primary ink is near-black in
                  light mode. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 text-left">
                <p className="text-sm font-semibold text-white">{watermark.name}</p>
                <p className="text-xs text-white/80">{watermark.address}</p>
                <p className="text-xs text-white/60">{watermark.timestamp}</p>
              </div>
            </button>

            {media.length > 1 ? (
              <div className="custom-scrollbar flex shrink-0 gap-2 overflow-x-auto border-t border-hairline bg-base-900 p-2">
                {media.map((item, index) => (
                  <button
                    key={item.url}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-label={`Show evidence ${index + 1} of ${media.length}`}
                    className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-[border-color,opacity] duration-150 ${
                      index === activeIndex ? 'border-brand-500' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                  >
                    {item.type === 'video' ? (
                      <video src={item.url} className="h-full w-full object-cover" muted />
                    ) : (
                      <EvidenceImage src={item.url} />
                    )}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* `lg:overflow-y-auto` and `lg:min-h-0` only — below `lg` the parent
              column scrolls, and this must keep its full content height for it
              to have anything to scroll. */}
          <div className="custom-scrollbar flex shrink-0 flex-col gap-4 p-5 lg:min-h-0 lg:overflow-y-auto">
            {/* What the ticket IS, before any of its facts: category-and-urgency
                and status, side by side. Status is a badge, not a control —
                advancing a ticket happens on the row and bulk actions in
                IncidentsTable; this modal is an inspection view.

                The WPDA readout ("score 955.8", "category weight ×9") is not
                shown. Those are scoring INPUTS, meaningful only against other
                scores nobody is shown. The server still stamps `wpdaScore` on
                every write and ranked views read it; the "Priority" row below
                states the conclusion, which is the part an operator acts on. */}
            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge severity={report.severity}>{formatCategory(report.category)}</PriorityBadge>
              <StatusBadge status={report.status ?? 'Pending'} />
            </div>

            <MetaSection icon={FileText} title="Report details">
              <MetaList>
                <MetaItem label="Ticket" mono>{ticketCode(report.id)}</MetaItem>
                <MetaItem label="Category">{formatCategory(report.category)}</MetaItem>
                <MetaItem label="Priority">{urgencyLabel}</MetaItem>
                <MetaItem label="Reported">{when(report.reportedAt)}</MetaItem>
                <MetaItem label="Assigned to">{report.assignedGuardName}</MetaItem>
                <MetaItem label="Dispatched">{when(report.dispatchedAt)}</MetaItem>
                <MetaItem label="Resolved">{when(report.resolvedAt)}</MetaItem>
              </MetaList>
              {slaBreach ? (
                <p className="mt-2 text-2xs leading-relaxed text-text-muted">
                  {slaBreach}{' '}
                  {/* This is the one surface where the difference is worth
                      stating. The table shows a late report either way; here
                      someone may be reading back what the system recorded at
                      the time, and "this console worked it out just now" and
                      "the server logged it" are different kinds of evidence. */}
                  {serverRecorded
                    ? 'Recorded against the report by the scheduled sweep.'
                    : 'Derived from this report\u2019s timestamps; the scheduled sweep has not recorded it.'}
                </p>
              ) : null}
            </MetaSection>

            <MetaSection
              icon={User}
              title="Resident"
              action={
                contact?.phone ? (
                  <a href={`tel:${contact.phone}`} className="btn btn-sm btn-outline">
                    <Phone size="sm" />
                    Call
                  </a>
                ) : null
              }
            >
              <MetaList>
                <MetaItem label="Name">{report.reportedByName}</MetaItem>
                <MetaItem label="Address">{address}</MetaItem>
                <MetaItem label="Phone">
                  {contactLoading ? <span className="text-text-muted">Looking up…</span> : contact?.phone}
                </MetaItem>
              </MetaList>
            </MetaSection>

            <MetaSection icon={MapPin} title="Location">
              <MetaList>
                <MetaItem label="Reported at">{report.location}</MetaItem>
                <MetaItem label="Coordinates" mono>{coordinates}</MetaItem>
              </MetaList>
            </MetaSection>

            {report.description ? (
              <MetaSection icon={AlignLeft} title="Description">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                  {report.description}
                </p>
              </MetaSection>
            ) : null}

            <MetaSection icon={ShieldCheck} title="Evidence">
              <MetaList>
                <MetaItem label="Files">{`${media.length} file${media.length === 1 ? '' : 's'}`}</MetaItem>
                <MetaItem label="Verification">
                  <span className="inline-flex items-center gap-1.5">
                    {media.length > 0 ? (
                      <>
                        <ShieldCheck size="sm" className="text-success" />
                        Verified
                      </>
                    ) : (
                      <>
                        <ShieldQuestion size="sm" className="text-warning" />
                        Pending
                      </>
                    )}
                  </span>
                </MetaItem>
              </MetaList>
            </MetaSection>
          </div>
        </div>
      </div>

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
