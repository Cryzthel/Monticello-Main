/**
 * The facts about one record, as label/value pairs — and the section frame
 * that holds them.
 *
 * ── SIDE BY SIDE, SAME SIZE ────────────────────────────────────────────────
 * The label sits in `.meta-label` (14px, secondary ink) beside a 14px value in
 * primary ink. Equal sizes are deliberate: detail views used to set labels at
 * 10–12px over 14px values, so the word naming a fact was the hardest thing on
 * the card to read. See `.meta-label` in the shared stylesheet.
 *
 * Two columns rather than label-over-value because a stacked pair spends two
 * lines on every fact, and a record with eight of them does not fit a modal
 * column. The label column narrows below `sm` instead of stacking, so the list
 * keeps one scan line on a phone.
 *
 * An empty value renders as an em-dash rather than disappearing: an absent fact
 * ("not yet dispatched") is still a fact an auditor should see was checked.
 * Pass `hidden` to leave a row out entirely.
 */
export function MetaList({ className = '', children }) {
  return (
    <dl
      className={`grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] ${className}`}
    >
      {children}
    </dl>
  )
}

export function MetaItem({ label, children, mono = false, hidden = false }) {
  if (hidden) return null
  const empty = children == null || children === '' || children === false
  return (
    <>
      <dt className="meta-label">{label}</dt>
      <dd className={`min-w-0 break-words text-sm font-medium text-text-primary ${mono ? 'font-mono' : ''}`}>
        {empty ? <span className="text-text-muted">—</span> : children}
      </dd>
    </>
  )
}

/**
 * A titled inset panel for one group of facts. The same frame the incident
 * breakdown draws, so a detail view reads as one family of sections whichever
 * component produced them. The title is 14px semibold primary — never smaller
 * than the 14px labels inside it.
 */
export function MetaSection({
  icon: Icon,
  title,
  action,
  className = '',
  /**
   * Padding for the body, when 16px is not the right amount of room.
   *
   * A prop rather than a change to the default, because the four consumers do
   * not want the same number: the centred modals are 640px wide and read fine
   * at `p-4`, while the Hazard Map's 416px rail is a column of stacked cards
   * with nothing beside them, where the same 16px reads tight. Measured at the
   * rail's real width, `p-6` costs 75px of scroll and wraps nothing — the
   * coordinate row, the narrowest thing here, still holds one line.
   */
  bodyClassName = 'p-4',
  children,
}) {
  return (
    <section className={`rounded-xl border border-hairline bg-base-800 ${className}`}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-hairline px-4 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          {Icon ? <Icon size="sm" className="shrink-0 text-brand-400" /> : null}
          {title}
        </h3>
        {action}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}
