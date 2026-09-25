/**
 * The page's own header: what this page is, one quiet line about it, and the
 * controls that shape everything below it (a timeframe, a filter).
 *
 * Moved out of the top bar in the 2026-09-22 redesign. The bar now carries
 * what is the same on every page (search, the portal's primary action, theme,
 * alerts), and the page names itself in its own space, where the title can be
 * a real 24px heading instead of a label squeezed beside a search field.
 *
 * Sentence case, bold, slate-900; the subtitle is slate-500 at 14px. Actions
 * sit on the title's baseline row from `sm` up and wrap under it below.
 */
export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-balance text-2xl font-bold tracking-tight text-text-primary">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm leading-snug text-text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
