import { X, Check, AlertTriangle, Info, ArrowRight, MapPin } from 'lucide-react'
import StatusBadge from '@shared/components/StatusBadge'
import { clockTime, relativeTime } from '@shared/lib/notifications'
import { notificationIcon } from '@shared/theme/categoryIcons'

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
  const glyph = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center rounded-full border-2 bg-transparent ${ring}`}
    >
      {/* Inherits the global 1.75 stroke from <LucideProvider> in main.jsx.
          This comment claimed a "deliberate override of the global 1.5
          stroke", and both halves were wrong: the provider is 1.75, and there
          is no override here — `glyph` sets a size and nothing else. Left as a
          note rather than deleted because the underlying observation still
          holds: these sit at 12-14px inside a 2px ring, so if the global
          weight ever drops, this is a place to check. */}
      <Icon className={glyph} />
    </span>
  )
}

/**
 * One notification card.
 *
 * -- THE GRID IS THE DESIGN ------------------------------------------------
 * Three columns, declared once and identical on every row:
 *
 *     [ 1.75rem glyph ][ minmax(0,1fr) content ][ auto timestamp ]
 *
 * Everything else follows from that. Because the glyph column has a FIXED
 * width rather than being a flex item sized by its own content, every card's
 * text starts at exactly the same x — and because the timestamp is its own
 * grid column rather than a floated span inside the paragraph, the times line
 * up as a readable right-hand column down the whole feed. The previous card
 * was a flex row with the time inlined above the text, so neither edge was
 * shared between two rows and the panel read as a stack of paragraphs.
 *
 * -- READING ORDER ---------------------------------------------------------
 * Badges, then headline, then supporting detail, then place, then the action.
 * A reader scanning for one category never has to read a sentence to find it,
 * and the one interactive element sits at the end of the card where it cannot
 * be hit on the way to reading it.
 *
 * `unread` is a faint brand wash plus a 6px dot at the glyph's shoulder. The
 * wash marks where new becomes seen down the list; the dot is the cue that
 * survives for a reader who cannot tell a pale green wash from white.
 */
export default function NotificationRow({ notification, unread = false, onSelect }) {
  const interactive = Boolean(onSelect)
  const {
    tone,
    categoryLabel,
    categoryTone,
    priority,
    title,
    detail,
    propertyLabel,
    at,
    actionLabel,
  } = notification

  return (
    <li>
      <div
        className={`grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 rounded-lg py-3 pl-3 pr-3.5 transition-colors duration-150 ${
          unread ? 'bg-brand-50' : 'hover:bg-tint/[0.04]'
        }`}
      >
        {/* Column 1 — tone. Spans nothing: it anchors the first row and the
            rest of the card hangs off column 2, which is what keeps the
            headline and the detail on one left edge. */}
        <div className="relative pt-px">
          <ToneGlyph tone={tone} />
          {unread ? (
            <span
              aria-hidden="true"
              className="absolute -left-2 top-3 h-1.5 w-1.5 rounded-full bg-brand-500"
            />
          ) : null}
        </div>

        {/* Column 2, row 1 — classification. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusBadge tone={categoryTone} icon={notificationIcon(notification)}>
            {categoryLabel}
          </StatusBadge>
          {/* Severity only where it changes what someone does. A `medium`
              badge on every second row is a column of noise, and `low` is not
              a thing anyone is being asked to act on. */}
          {priority === 'critical' || priority === 'high' ? (
            <StatusBadge severity={priority} />
          ) : null}
        </div>

        {/* Column 3, row 1 — the timestamp column. `tabular-nums` is what puts
            the digits on a shared vertical rhythm, and it was already here; the
            mono FACE sitting on top of it was doing nothing but looking
            technical, which this codebase rules out. `text-right` so it is the
            panel's right edge that aligns, not the start of a variable-length
            word. */}
        <div className="text-right">
          <p className="text-caption leading-none tabular-nums text-text-secondary">
            {clockTime(at)}
          </p>
          <p className="mt-1 whitespace-nowrap text-2xs leading-none text-text-muted">
            {relativeTime(at)}
          </p>
        </div>

        {/* Everything below spans columns 2-3: the glyph column stays empty so
            the body of the card reads as one block against a single gutter. */}
        <div className="col-start-2 col-end-4 min-w-0">
          <p className="text-label font-semibold leading-snug text-text-primary">{title}</p>
          {detail ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-text-secondary">
              {detail}
            </p>
          ) : null}
          {propertyLabel ? (
            <p className="mt-1.5 flex min-w-0">
              <StatusBadge tone="neutral" size="sm" icon={MapPin} className="max-w-full">
                <span className="truncate">{propertyLabel}</span>
              </StatusBadge>
            </p>
          ) : null}
        </div>

        {interactive ? (
          <div className="col-start-2 col-end-4">
            {/* An explicit link trigger rather than a click target covering the
                whole card. A card that is entirely clickable cannot be read
                without the pointer implying an action, and it gives a keyboard
                user one enormous tab stop whose behaviour is unstated. This is
                a real button with a real label. */}
            <button
              type="button"
              onClick={onSelect}
              className="-ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-caption font-semibold text-brand-400 transition-colors hover:text-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            >
              {actionLabel ?? 'View details'}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        ) : null}
      </div>
    </li>
  )
}
