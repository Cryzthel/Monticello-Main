import { useEffect, useState } from 'react'
import { Calendar, Camera, Check, CheckCircle2, Clock, Copy, ImageOff, MapPin, Maximize2 } from '@shared/icons'
import Lightbox from '@shared/components/Lightbox'
import EvidenceImage from '@shared/components/EvidenceImage'
import Pill from '@shared/components/Pill'
import { DetailCard, DetailTimeline } from '@shared/components/detail/DetailCard'
import { captureTimestamp } from '@shared/components/dispatch/EvidenceGrid'
import { buildMediaItems } from '@shared/lib/incidents'
import { toast } from '@shared/lib/toast'
import { elapsed, incidentAddress, incidentStatusHistory, stampOf } from '@shared/lib/incidentDetail'

/**
 * The incident cards both consoles draw a report with — lifted out of the
 * Admin ticket modal (IncidentDetailModal) so the Guardhouse's dispatch drawer
 * renders the SAME media viewer, GPS block and status history rather than a
 * look-alike that drifts (2026-10-19, by request).
 */

/**
 * STATUS HISTORY — every recorded stage as a filled node (amber for an
 * escalation or a sweep flag) with who and when beneath it, the gap since the
 * stage before, and — until resolved — a hollow "Awaiting resolution" node.
 */
export function IncidentStatusTimeline({ report, labels }) {
  const steps = incidentStatusHistory(report, labels)
  const resolved = steps.some((step) => step.key === 'resolved')
  const items = steps.map((step, index) => {
    const previous = steps[index - 1]
    return {
      key: step.key,
      label: step.label,
      detail: step.detail,
      tone: step.tone === 'warning' ? 'warning' : 'done',
      stamp: `${stampOf(step.date)}${previous ? ` · ${elapsed(previous.date.getTime(), step.date.getTime())}` : ''}`,
      dateTime: step.date.toISOString(),
    }
  })
  if (!resolved) {
    items.push({
      key: 'awaiting',
      label: 'Awaiting resolution',
      detail: report.dispatchedAt ? 'Officer on the call' : 'Pending officer dispatch',
      tone: 'pending',
    })
  }
  return <DetailTimeline items={items} />
}

/** The GPS block: mono coordinates on an inset well, with Copy. */
export function CoordinatesBlock({ lat, lng }) {
  const [copied, setCopied] = useState(false)
  const coordinates =
    typeof lat === 'number' && typeof lng === 'number' ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : ''

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(coordinates)
      setCopied(true)
    } catch {
      toast.error('Could not copy the coordinates', { description: 'Select them and copy by hand.' })
    }
  }

  return (
    <div className="border-l-2 border-hairline pl-3 pt-2">
      <span className="mb-1.5 block text-[11px] text-text-muted">GPS coordinates</span>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-base-950 px-3 py-2">
        <span className="select-all font-mono text-xs text-brand-500">{coordinates || 'No GPS fix'}</span>
        {coordinates ? (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Coordinates copied' : 'Copy coordinates'}
            className="inline-flex items-center gap-1 rounded text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {copied ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            <span className="text-[10px] font-medium uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * MEDIA EVIDENCE — one constrained viewer (h-64/h-80, or h-52 `compact` for a
 * side rail) with the capture caption, thumbnails under it, and the Lightbox.
 * `onLightboxChange(open)` tells the host when the Lightbox is up.
 */
/**
 * `title` and `children` let a host fold related content into the same card
 * (the Guardhouse drawer puts the resident's notes under the evidence).
 */
export function MediaEvidenceCard({ report, compact = false, onLightboxChange, title = 'Media evidence', children = null }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  // The host dialog stands down its own Escape while the Lightbox owns it.
  const lightboxOpen = lightboxIndex !== null
  useEffect(() => {
    onLightboxChange?.(lightboxOpen)
  }, [lightboxOpen, onLightboxChange])

  useEffect(() => {
    setActiveIndex(0)
    setLightboxIndex(null)
  }, [report?.id])

  const media = buildMediaItems(report)
  const active = media[Math.min(activeIndex, Math.max(media.length - 1, 0))]
  const address = incidentAddress(report)
  // "Captured", not "Reported": with evidence attached, the mobile app files
  // `reportedAt` as the OLDEST attachment's camera time.
  const capturedAt = captureTimestamp(report.reportedAt)
  const watermark = {
    name: report.reportedByName ?? 'Unknown resident',
    address,
    timestamp: report.reportedAt ? `Captured ${capturedAt}` : 'Timestamp unavailable',
  }

  return (
    <DetailCard
      aria-label={title}
      icon={Camera}
      title={title}
      compact={compact}
      bodyClassName={compact ? 'space-y-3' : 'space-y-4'}
      action={
        media.length ? (
          <Pill tone="success" icon={CheckCircle2}>
            {media.length} file{media.length === 1 ? '' : 's'} verified
          </Pill>
        ) : (
          <Pill tone="warning" icon={Clock}>
            {report.hasMedia ? 'Uploading' : 'No files'}
          </Pill>
        )
      }
    >
      <div
        className={`group relative flex w-full items-center justify-center overflow-hidden rounded-lg border border-hairline bg-zinc-900 ${
          compact ? 'h-52' : 'h-64 sm:h-80'
        }`}
      >
        {active?.type === 'video' ? (
          <video key={active.url} src={active.url} controls className="absolute inset-0 h-full w-full object-contain" />
        ) : active ? (
          <>
            <button
              type="button"
              onClick={() => setLightboxIndex(media.indexOf(active))}
              aria-label="Open evidence full screen"
              className="absolute inset-0 opacity-80 transition-opacity duration-300 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            >
              <EvidenceImage src={active.url} alt="Incident evidence" eager />
            </button>
            <button
              type="button"
              onClick={() => setLightboxIndex(media.indexOf(active))}
              aria-label="View full resolution"
              title="View full resolution"
              className="absolute right-3 top-3 rounded-lg border border-white/15 bg-black/60 p-2 text-white opacity-0 shadow-lg backdrop-blur-md transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Maximize2 size="sm" />
            </button>
            {/* Caption — white on the photo's own scrim in both themes. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 text-xs">
              <p className="flex items-center gap-2 text-zinc-300">
                <Calendar size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="font-mono">Captured: {capturedAt}</span>
              </p>
              <p className="mt-1 flex items-center gap-2 text-zinc-400">
                <MapPin size={14} className="shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {watermark.name} • {address}
                </span>
              </p>
            </div>
          </>
        ) : (
          <span className="flex flex-col items-center gap-2 text-sm text-zinc-400">
            <ImageOff size="lg" aria-hidden="true" />
            {report.hasMedia ? 'Media still uploading…' : 'No media attached'}
          </span>
        )}
      </div>

      {media.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {media.map((item, index) => (
            <button
              key={`${index}:${item.url}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Show evidence ${index + 1} of ${media.length}`}
              aria-current={item === active ? 'true' : undefined}
              className={`relative h-12 w-12 shrink-0 overflow-hidden rounded transition-[border-color,opacity] duration-150 ${
                item === active ? 'border-2 border-brand-500' : 'border border-hairline opacity-60 hover:opacity-100'
              }`}
            >
              {item.type === 'video' ? (
                <video src={item.url} className="h-full w-full object-cover" muted preload="metadata" />
              ) : (
                <EvidenceImage src={item.url} />
              )}
            </button>
          ))}
        </div>
      ) : null}

      {children}

      {lightboxIndex !== null ? (
        <Lightbox media={media} startIndex={lightboxIndex} watermark={watermark} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </DetailCard>
  )
}
