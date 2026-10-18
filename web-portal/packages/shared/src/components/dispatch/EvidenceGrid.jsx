import { PlayCircle } from '@shared/icons'
import EvidenceImage from '@shared/components/EvidenceImage'
import { PORTAL_TIME_ZONE, formatDateTime } from '@shared/lib/dates'

const STAMP = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}

/** "2026-09-22 10:16:04" — sortable, unambiguous, the same in every locale. */
export function forensicTimestamp(at) {
  if (!at) return 'time not recorded'
  const parts = Object.fromEntries(
    // In the organisation's time zone (Settings › System), like every other
    // stamp — read at call time, so a changed setting applies at once.
    new Intl.DateTimeFormat('en-GB', { ...STAMP, timeZone: PORTAL_TIME_ZONE })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/**
 * "Oct 16, 2026, 10:14 PM" — the stamp a person reads off a thumbnail.
 *
 * forensicTimestamp stays the export and watermark format; this is the one
 * drawn ON the tile, where the job is to be read at a glance at 200px wide.
 */
export function captureTimestamp(at) {
  if (!at) return 'Time not recorded'
  const date = new Date(at)
  // formatDateTime is this exact shape, pinned to the organisation's zone.
  return Number.isNaN(date.getTime()) ? 'Time not recorded' : formatDateTime(date)
}

export function forensicCoordinates(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number'
    ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    : 'GPS not recorded'
}

/**
 * A thumbnail grid, each tile stamped with the three facts that tie
 * the picture to the call: when, where and which incident.
 *
 * ── THE STAMP IS AN OVERLAY, NOT BURNT IN ──────────────────────────────────
 * The files in Storage are left exactly as uploaded. Re-encoding evidence to
 * draw on it would change the file, and an unaltered original is what a
 * forensic record needs. The stamp is drawn over it here and in the
 * full-screen viewer, so a screenshot of either carries it.
 *
 * `stamp` is `{ at, lat, lng, reference, label }`. The time and position are
 * the report's for resident evidence, and the stage's for the guard's own
 * scene photos. Nothing records each photo separately — but for resident
 * evidence the mobile app sets `reportedAt` to the OLDEST attachment's camera
 * time (report_incident_screen.dart), so "Captured" is true of it. `label`
 * defaults to that; a resolution grid passes "Resolved", because its time is
 * the stage's, not the shutter's.
 *
 * ── ONE GRID, BOTH CONSOLES ────────────────────────────────────────────────
 * Shared after the Admin inspection rail was found drawing its own: a
 * `grid-cols-3` of square tiles with no stamp on them at all. The same photo
 * therefore carried its time, position and incident reference when an officer
 * opened it and carried none of them when an administrator did — and the
 * administrator is the one who exports the record. Two up with the stamp, in
 * both, or the stamp is not a forensic property of the evidence but a
 * property of which console you happened to open it in.
 *
 * Thumbnails load lazily and decode off the main thread. The resident app
 * already compresses uploads to 1920 px, so there is no separate thumbnail
 * file to fetch. The grid shows the compressed original, scaled down.
 */
export default function EvidenceGrid({ media, stamp, onOpen, emptyText }) {
  if (!media.length) return <p className="text-sm text-text-muted">{emptyText}</p>

  return (
    // Two up, not three: at three a 416px rail leaves ~115px per tile, and the
    // stamp's 19-character timestamp no longer fits on one line of 9px mono.
    // A forensic stamp that truncates is a stamp that cannot be read.
    <ul className="grid grid-cols-2 gap-2">
      {media.map((item, index) => (
        <li key={item.url}>
          <button
            type="button"
            onClick={() => onOpen(index)}
            aria-label={`Open ${item.type} ${index + 1} of ${media.length}`}
            className="group relative block aspect-[4/3] w-full overflow-hidden rounded-lg border border-slate-200 transition-colors duration-150 hover:border-brand-500/60"
          >
            {item.type === 'video' ? (
              <>
                <video src={item.url} className="h-full w-full object-cover" muted preload="metadata" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <PlayCircle size="lg" className="text-white" aria-hidden="true" />
                </span>
              </>
            ) : (
              <EvidenceImage src={item.url} alt="" />
            )}
            {/* ── THE STAMP HAD TO BE READABLE TO BE A STAMP ─────────────────
                It was three lines of 9px mono at 90% white over an 80% scrim
                that only started 20px up — on a bright photo the timestamp,
                the one line anyone reads, sat on half-transparent sky. Now the
                time leads at 12px semibold in words ("Oct 16, 2026, 10:14 PM"),
                over a scrim that is near-opaque where the text sits and fades
                out above it, and the forensic detail drops to a quieter
                second line. The machine-sortable form is unchanged where it
                is exported: the watermark and the PDF.

                `via-70%` plus `pt-14` keep all three lines in the scrim's
                darker lower half; at the default 50% midpoint the label sat on
                ~40% black, under 3:1 against a bright sky. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 via-70% to-transparent px-2 pb-1.5 pt-10 text-left [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
            >
              <span className="block text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-white">
                {stamp.label ?? 'Captured'}
              </span>
              <span className="mt-1 block truncate text-xs font-semibold leading-tight tabular-nums text-white">
                {captureTimestamp(stamp.at)}
              </span>
              <span className="mt-0.5 flex min-w-0 items-baseline justify-between gap-2 font-mono text-[9.5px] leading-tight text-white/80">
                <span className="truncate">{forensicCoordinates(stamp.lat, stamp.lng)}</span>
                <span className="shrink-0 font-semibold text-white/90">{stamp.reference}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
