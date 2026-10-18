import { X, Check, AlertTriangle, Info, ArrowRight, MapPin } from '@shared/icons'
import StatusBadge from '@shared/components/StatusBadge'
import { clockTime, relativeTime } from '@shared/lib/notifications'
import { notificationIcon } from '@shared/theme/categoryIcons'
import { formatInZone } from '@shared/lib/dates'

// Read in the portal time zone at render, not frozen at import.
const FULL_STAMP = { dateStyle: 'full', timeStyle: 'short' }

// Circular outline glyphs, one per tone — the feed's leading indicator.
// Outline rather than filled: four solid dots in a vertical list read as a
// status column and compete with the text, whereas rings sit behind it.
const TONE_GLYPH = {
  error: { icon: X, ring: 'border-danger/50 text-danger' },
  success: { icon: Check, ring: 'border-success/50 text-success' },
  warning: { icon: AlertTriangle, ring: 'border-warning/50 text-warning' },
  info: { icon: Info, ring: 'border-info/50 text-info' },
}

export function ToneGlyph({ tone, size = 'md' }) {
  const { icon: Icon, ring } = TONE_GLYPH[tone] ?? TONE_GLYPH.info
  const box = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'
  const glyph = 'sm'
  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center rounded-full border-2 bg-transparent ${ring}`}
    >
      {/* Both boxes take a 16px glyph. The scale's 14px step went with the
          move to Material Symbols (see shared/icons/tokens.js), and 16 still
          clears the 2px ring inside the smaller 24px box. There is no house
          stroke weight to tune here any more either: these are filled shapes,
          and their weight is the set's own wght=400. */}
      <Icon size={glyph} />
    </span>
  )
}

/**
 * One notification card, after the reference panel (2026-10-17).
 *
 * Reading order: unread dot and icon tile on the left; badges, then the time
 * opposite them; the headline; the detail; the place; the one action, last,
 * where it cannot be hit on the way to reading the card. The action is a real
 * button rather than the whole card being clickable, so a keyboard user gets
 * a labelled stop and the card can be read without the pointer implying one.
 */
export default function NotificationRow({ notification, unread = false, onSelect }) {
  const interactive = Boolean(onSelect)
  const {
    categoryLabel,
    categoryTone,
    priority,
    title,
    detail,
    propertyLabel,
    at,
    actionLabel,
  } = notification

  const sos = notification.kind === 'panic'
  const Icon = notificationIcon(notification)
  const valid = at instanceof Date && !Number.isNaN(at.getTime())

  /*
   * ── THE CARD (2026-10-17, after the reference panel) ─────────────────────
   * A card on the list's darker well rather than a row on the panel: a left
   * column holding the unread dot over a tinted icon tile, then badges with
   * the time opposite, the headline, the detail, the place, and the action.
   *
   * One accent: the brand emerald, on the tile, the dot and the link. The
   * reference's indigo tiles are gone. SOS is the exception and keeps a red
   * card, tile and link, because an emergency must not look like a report.
   */
  const surface = sos
    ? 'border-danger/30 bg-danger/[0.07] hover:border-danger/55'
    : 'border-hairline bg-base-900 hover:border-tint/25'
  const tile = sos
    ? 'border-danger/35 bg-danger/15 text-danger'
    : 'border-brand-500/25 bg-brand-500/10 text-brand-400'
  const link = sos ? 'text-danger hover:text-danger/80' : 'text-brand-400 hover:text-brand-300'

  return (
    <li>
      <div className={`rounded-xl border p-4 transition-colors duration-200 ${surface}`}>
        <div className="flex items-start gap-4">
          <div className="flex shrink-0 flex-col items-center gap-2.5 pt-1">
            {/* The unread dot keeps its column when read, so cards do not
                shift sideways as they are marked read. */}
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${unread ? 'bg-brand-500' : 'bg-transparent'}`}
            />
            <span className={`flex h-10 w-10 items-center justify-center rounded-lg border ${tile}`}>
              {Icon ? <Icon size="md" aria-hidden="true" /> : null}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <StatusBadge tone={categoryTone} icon={Icon}>
                  {categoryLabel}
                </StatusBadge>
                {/* Severity only where it changes what someone does. */}
                {priority === 'critical' || priority === 'high' ? <StatusBadge severity={priority} /> : null}
              </div>
              <time
                dateTime={valid ? at.toISOString() : undefined}
                title={valid ? formatInZone(at, FULL_STAMP) : undefined}
                className="flex shrink-0 flex-col items-end text-right"
              >
                <span className="text-sm font-medium tabular-nums text-text-primary">{clockTime(at)}</span>
                <span className="mt-0.5 whitespace-nowrap text-xs text-text-muted">{relativeTime(at)}</span>
              </time>
            </div>

            <h4 className={`text-base font-semibold leading-snug ${sos ? 'text-danger' : 'text-text-primary'}`}>{title}</h4>
            {detail ? <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{detail}</p> : null}

            {propertyLabel ? (
              <p className="mt-3 flex min-w-0">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline bg-base-850 px-3 py-1 text-xs font-semibold text-text-secondary">
                  <MapPin size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
                  <span className="truncate">{propertyLabel}</span>
                </span>
              </p>
            ) : null}

            {interactive ? (
              <button
                type="button"
                onClick={onSelect}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${link}`}
              >
                {actionLabel ?? 'View details'}
                <ArrowRight size="sm" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  )
}
