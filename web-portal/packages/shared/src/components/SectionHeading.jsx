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
    <div className={`flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-1 ${className}`}>
      {/* H2 in the type scale: text-base / semibold. These sit above panels
          ("System events", "Broadcast feed"), one level under the page
          title's text-2xl bold (PageHeader) and one above the text-sm body
          inside the panel, so the three ranks read as ranks without any of
          them shouting. The reference's section titles are this size. */}
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-tight tracking-tight text-text-primary">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-snug text-text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className={`shrink-0 ${actionClassName}`}>{action}</div> : null}
    </div>
  )
}
