import { useEffect, useRef, useState } from 'react'
import { Clock, ImageOff, MapPin, PlayCircle, ShieldCheck, ShieldQuestion, X } from '@shared/icons'
import PriorityBadge from '@shared/components/PriorityBadge'
import StatusBadge from '@shared/components/StatusBadge'
import Lightbox from '@shared/components/Lightbox'
import EvidenceImage from '@shared/components/EvidenceImage'
import IncidentBreakdown from '@shared/components/IncidentBreakdown'
import { buildMediaItems } from '@shared/lib/incidents'
import { formatCategory } from '@shared/lib/wpda'
import { incidentReference } from '@/lib/dispatch'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { formatDateTime } from '@shared/lib/dates'

/**
 * The Incident History review pop-up.
 *
 * ── WHY A MODAL HERE, WHEN THE DISPATCH PANEL IS A RAIL ───────────────────
 * The two look like the same problem and are not. The dispatch drawer refuses
 * to be a modal because the click that opens it is also the click that centres
 * a marker on a live map, and a centred dialog would cover the thing it just
 * centred (see DispatchDetailDrawer's header note).
 *
 * There is no map here. What sits behind this is a list, and covering a list
 * costs nothing — while the full width buys the four-across metadata grids in
 * IncidentBreakdown enough room to render as grids rather than as four stacked
 * pairs. A review is read, not worked: one report, whole, with the archive
 * waiting underneath.
 *
 * ── WHAT A REVIEW HAS TO CONTAIN ──────────────────────────────────────────
 * Everything the record holds, in the order a guard reconstructs an incident:
 *
 *   header       what this is — title, reference, priority, lifecycle state
 *   attachments  what it looked like, with the forensic watermark burned over
 *                the capture the way the mobile client burns it
 *   breakdown    classification and WPDA urgency, the resident's name and
 *                address, the response timeline, and the responder's notes
 *                (IncidentBreakdown — shared with the Admin audit sheet, so
 *                the two consoles review the same amount of the same report)
 *
 * ── READ-ONLY WITH RESPECT TO STATUS ──────────────────────────────────────
 * Nothing here advances a call. This is the archive; status is driven from the
 * Live Dispatch map and nowhere else. The status pill in the header is a pill,
 * not a control — `rounded-full`, no hover, no chevron.
 *
 * Notes ARE editable (IncidentBreakdown's NotesEditor). A responder's account
 * of what happened is written up after the fact, which is exactly what this
 * screen is for, and it changes no lifecycle state and messages nobody.
 */
export default function IncidentReviewModal({ report, onClose }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // Per-report view state. Carrying "photo 3 of 4" into the next report would
  // open it on an index its media list may not even have.
  useEffect(() => {
    setActiveIndex(0)
    setLightboxOpen(false)
  }, [report?.id])

  // Escape closes the review — unless the Lightbox owns it, so a guard leaving
  // a full-screen photo lands back on the report rather than being thrown out
  // of both at once. Same contract as the dispatch drawer.
  useEffect(() => {
    if (!report || lightboxOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [report, lightboxOpen, onClose])

  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(report), containerRef: panelRef })

  if (!report) return null

  const media = buildMediaItems(report)
  const active = media[activeIndex]
  // `hasMedia` is written at submit time; true with no URLs landed yet means
  // the uploads are still processing rather than genuinely missing.
  const stillUploading = report.hasMedia && media.length === 0

  const address =
    report.location ??
    [
      report.phase && `Phase ${report.phase}`,
      report.block && `Block ${report.block}`,
      report.lot && `Lot ${report.lot}`,
    ]
      .filter(Boolean)
      .join(' · ')

  const watermark = {
    name: report.reportedByName ?? 'Unknown resident',
    address: address || 'Location not recorded',
    timestamp: formatDateTime(report.reportedAt, 'Timestamp unavailable'),
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      {/* The scrim closes on click, which is the affordance a modal over a list
          is expected to have. It is a sibling rather than the dialog's parent
          so a click inside the panel cannot bubble out to it. */}
      <div className="dialog-scrim absolute inset-0 bg-scrim" onClick={onClose} role="presentation" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Incident ${incidentReference(report.id)}`}
        className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-hairline bg-base-900 shadow-modal dialog-panel"
      >
        {/* ══ HEADER ══
            `p-5` here and on the body, one gutter for the whole dialog — the
            card this replaced ran `px-5 py-4` on its header against `p-4` on
            its body, so the panel had two different left edges down its own
            length.

            Sentence case, and `font-bold` on the one line that is a TITLE.
            Everything else in the dialog is a label or a value; exactly one
            thing is the name of what you are reading, and it is the only
            thing set bold. */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge severity={report.severity}>{formatCategory(report.category)}</PriorityBadge>
              <StatusBadge status={report.status ?? 'Pending'} />
              <span className="font-mono text-caption font-medium text-text-muted">
                {incidentReference(report.id)}
              </span>
            </div>
            <h2 className="mt-2 truncate text-base font-semibold leading-snug text-text-primary">
              {report.title || formatCategory(report.category)}
            </h2>
            {/* The resident and the address, together, directly under the
                title. It is the pair a reviewer opens a historical report to
                confirm, and it was previously only legible burned into the
                corner of a photograph — which reports with no evidence do not
                have. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
              <span className="inline-flex items-center gap-1">
                <MapPin size="sm" className="shrink-0 text-brand-400" />
                {address || 'Location not recorded'}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size="sm" className="shrink-0 text-text-muted" />
                {watermark.timestamp}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report review"
            className="btn btn-icon-sm -mr-1 -mt-1 shrink-0 text-text-secondary hover:text-text-primary"
          >
            <X size="sm" />
          </button>
        </header>

        {/* ══ BODY — the only band that scrolls ══ */}
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {/* ── ATTACHMENTS ────────────────────────────────────────────────
              A `Section` in the same shape IncidentBreakdown draws its four
              in, so the evidence reads as the first of five blocks rather than
              as a black band the panel starts with.

              `shrink-0` is load-bearing, and the bug it fixes is invisible in
              the markup: `overflow-hidden` (which is what makes the rounded
              corners actually clip the black media band) sets this element's
              automatic minimum size to ZERO. As a flex item in the overflowing
              column below, it therefore had nothing stopping it from being
              shrunk away — it rendered at 1.6px, two hairline borders and no
              content, on every report long enough to scroll. The breakdown
              beside it survived only because it has no `overflow-hidden` and
              so kept `min-height: auto`. */}
          <section className="shrink-0 overflow-hidden rounded-xl border border-hairline bg-base-800">
            <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
              <h3 className="flex items-center gap-2 text-xs font-semibold tracking-normal text-text-secondary">
                <ImageOff size="sm" className="shrink-0 text-brand-400" />
                Attachments
              </h3>
              <span className="shrink-0 text-2xs text-text-muted">
                {`${media.length} file${media.length === 1 ? '' : 's'}`}
              </span>
            </header>

            {/* ── THE EMPTY CASE IS NOT A BLACK BAND ─────────────────────
                A report with no evidence used to get the full 20rem viewer
                anyway: 320px of black holding the words "No media attached",
                and a provenance watermark burned over nothing — "Awaiting
                evidence" above a name and address that the modal's own header
                already states two inches higher.

                Most resident reports carry no photo, so that was the COMMON
                case paying for the rare one, and it pushed the classification
                and timeline a full screen down. Empty gets one quiet line at
                its natural height; the viewer appears when there is something
                to look at. */}
            {active ? (
              <div className="bg-black">
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  aria-label="Open evidence full screen"
                  className="relative block h-[20rem] w-full"
                >
                  {active.type === 'video' ? (
                    <>
                      <video src={active.url} className="h-full w-full object-contain" muted />
                      <span className="absolute inset-0 flex items-center justify-center">
                        <PlayCircle size={40} className="text-white/90" />
                      </span>
                    </>
                  ) : (
                    <EvidenceImage src={active.url} alt="Incident evidence" fit="contain" eager />
                  )}

                  {/* Non-editable provenance burned over the capture, mirroring
                      the mobile client's watermark: who, when (server
                      timestamp), where.

                      Capsules, because both are values a reader reads, not
                      controls. And `ring-white`, not `ring-tint`: these sit on
                      a black gradient in BOTH themes, and tint is slate-900 in
                      light mode — a dark ring on a dark photo, i.e. no ring. */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent p-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-2xs font-semibold text-white/90 ring-1 ring-inset ring-white/20">
                      <ShieldCheck size="sm" className="text-success" />
                      Watermark verified
                    </span>
                    <span className="rounded-full bg-black/50 px-2.5 py-1 text-2xs font-medium text-white/80 ring-1 ring-inset ring-white/20">
                      {activeIndex + 1} / {media.length}
                    </span>
                  </div>

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 text-left">
                    <p className="text-sm font-semibold text-white">{watermark.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-white/80">
                      <MapPin size="sm" className="shrink-0" />
                      {watermark.address}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-white/60">
                      <Clock size="sm" className="shrink-0" />
                      {watermark.timestamp}
                    </p>
                  </div>
                </button>
              </div>
            ) : (
              <p className="flex items-center gap-2 p-4 text-sm text-text-muted">
                {stillUploading ? (
                  <ShieldQuestion size="sm" className="shrink-0 text-warning" />
                ) : (
                  <ImageOff size="sm" className="shrink-0" />
                )}
                {stillUploading
                  ? 'The resident attached media that is still uploading.'
                  : 'The resident attached no photos or video.'}
              </p>
            )}

            <div className="bg-black empty:hidden">
              {media.length > 1 ? (
                <div className="custom-scrollbar flex gap-2 overflow-x-auto border-t border-hairline bg-base-900 p-2">
                  {media.map((item, index) => (
                    <button
                      key={item.url}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      aria-label={`Show ${item.type} ${index + 1} of ${media.length}`}
                      className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors duration-150 ${
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
          </section>

          {/* ── THE FULL BREAKDOWN ─────────────────────────────────────────
              Shared with the Admin's audit sheet — see IncidentBreakdown. It
              carries the resident's address metadata and the timeline logs,
              which is why neither is duplicated above. */}
          <IncidentBreakdown report={report} mediaCount={media.length} />
        </div>
      </div>

      {lightboxOpen ? (
        <Lightbox
          media={media}
          startIndex={activeIndex}
          watermark={watermark}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </div>
  )
}
