/**
 * The header row INSIDE a card, as one rule instead of per-page guesswork.
 *
 * ── WHY THIS IS A SEPARATE RANK FROM SectionHeading ─────────────────────────
 * SectionHeading sits ABOVE a panel and owns the section: 16px semibold over a
 * 14px muted description. A header inside a card is one level down — the card
 * is already the thing the section named — so it takes 14px semibold over a
 * 12px muted line. Two ranks, and which one applies is decided by where the
 * header sits, not by the page.
 *
 * Without this component that second rank was hand-written at each call site,
 * and it had already drifted: both surviving copies set the description in
 * `text-text-secondary` (slate-600) while SectionHeading's sits in
 * `text-text-muted` (slate-500). Slate-600 is the DARKER ink, so the smaller
 * supporting line was being inked more strongly than the larger one it
 * supports — the hierarchy inverted on the very line meant to recede. It is
 * exactly the drift SectionHeading's own docstring was written to end, and it
 * came back because there was no component to come back to.
 *
 * `action` is the right-hand control — a "View all" link, a filter, a count.
 * It is pinned to the header rather than the page so it reads as belonging to
 * the card's content.
 *
 * `icon` is an optional leading glyph in the standard 32px tile. It exists
 * because Admin › Settings was hand-rolling this whole header to get one — a
 * 16px semibold title over a 12px line, which is SectionHeading's rank applied
 * INSIDE a card, i.e. precisely the drift the note above describes, reached by
 * a different route. A page should not have to leave the component to add a
 * glyph, so the glyph came to the component.
 */
export default function CardHeader({ title, description, action, icon: Icon, className = '' }) {
  return (
    <div
      className={`flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3 ${className}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="icon-tile icon-tile-sm" aria-hidden="true">
            <Icon size="sm" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight text-text-primary">{title}</h3>
          {description ? (
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
