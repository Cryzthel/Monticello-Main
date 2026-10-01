import { PlayCircle } from '@shared/icons'
import EvidenceImage from '@shared/components/EvidenceImage'

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
    new Intl.DateTimeFormat('en-GB', STAMP).formatToParts(new Date(at)).map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
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
 * `stamp` is `{ at, lat, lng, reference }`. The time and position are the
 * report's for resident evidence, and the stage's for the guard's own scene
 * photos. Nothing records when each photo was taken.
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
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/55 to-transparent px-1.5 pb-1 pt-5 text-left font-mono text-[9px] leading-[1.35] text-white/90"
            >
              <span className="block truncate">{forensicTimestamp(stamp.at)}</span>
              <span className="block truncate">{forensicCoordinates(stamp.lat, stamp.lng)}</span>
              <span className="block truncate font-semibold text-white">{stamp.reference}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
