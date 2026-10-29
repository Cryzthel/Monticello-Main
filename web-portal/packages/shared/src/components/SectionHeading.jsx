/**
 * One section heading for both dashboards.
 *
 * Section titles were previously ad-hoc inline `<p>` tags with per-page sizes
 * and weights, so "Recent incidents" on the Admin overview and the headings
 * inside the analytics/feed panels sat at different type scales. Routing them
 * through one component makes the hierarchy — section title, optional
 * description, optional right-aligned action — a shared rule instead of a
 * per-page decision.
 *
 * `actionClassName` is the one escape hatch. A right-aligned control that is
 * comfortable beside the title on a desktop row usually wants to be a full-width
 * block on a phone (a segmented view switcher, say), and that is a decision only
 * the calling page can make — the default stays `shrink-0` for everyone else.
 */
export default function SectionHeading({
  title,
  description,
  action,
  className = '',
  actionClassName = '',
}) {
  return (
    // `items-end` aligns the action with the DESCRIPTION's baseline, which is
    // the right answer only while there is a description. Without one the title
    // is a single line and a taller control beside it would hang off its
    // bottom edge, so the row centres instead. Both portals have call sites of
    // each kind, which is why this is conditional rather than a new default.
    <div
      className={`flex shrink-0 flex-wrap ${description ? 'items-end' : 'items-center'} justify-between gap-x-4 gap-y-1 ${className}`}
    >
      {/* H3 in the type scale (28px Space Grotesk). These sit above panels
          ("System events", "Broadcast feed"), one rank under the page title's
          H2 (PageHeader) and above the Body/Small text inside the panel. */}
      <div className="min-w-0">
        <h2 className="type-h3 text-text-primary">{title}</h2>
        {description ? (
          <p className="mt-1 text-body leading-snug text-text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className={`shrink-0 ${actionClassName}`}>{action}</div> : null}
    </div>
  )
}
