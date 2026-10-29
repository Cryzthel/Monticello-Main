/**
 * The page's own header: what this page is, one quiet line about it, and the
 * controls that shape everything below it (a timeframe, a filter).
 *
 * Moved out of the top bar in the 2026-09-22 redesign. The bar now carries
 * what is the same on every page (search, the portal's primary action, theme,
 * alerts), and the page names itself in its own space, where the title can be
 * a real heading instead of a label squeezed beside a search field.
 *
 * Sentence case, H2 (24px Space Grotesk); the subtitle is Body (14px). Actions
 * sit on the title's baseline row from `sm` up and wrap under it below.
 */
export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="type-h2 text-text-primary">{title}</h1>
        {subtitle ? <p className="mt-1 text-body leading-snug text-text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
