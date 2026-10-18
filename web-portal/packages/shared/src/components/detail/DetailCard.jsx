/**
 * The building blocks of every record-detail modal in the consoles — the
 * Incident ticket details and the officer Report details render from these, so
 * the two cannot drift apart again (2026-10-19, by request: "the exact same
 * layout, typography hierarchy, border radii and glass styling").
 *
 *   <DetailCard icon={User} title="Reporter information">
 *     <DetailField label="Full name">Razel Roldan</DetailField>
 *   </DetailCard>
 *
 *   <DetailTimeline items={[{ key, label, detail, stamp, tone }]} />
 *
 * Card: rounded-xl, hairline border, base-900/40 glass, p-6. Title: mono,
 * uppercase, tracked, 14px icon, ruled underneath. Field: a 2px left rule, an
 * 11px label over 14px medium text. Timeline: small glowing nodes for what
 * happened (emerald, amber for a warning), hollow nodes for what is still owed.
 */

export function DetailCard({ icon: Icon, title, action = null, className = '', bodyClassName = 'space-y-5', children, ...rest }) {
  return (
    <section className={`min-w-0 rounded-xl border border-hairline bg-base-900/40 p-6 ${className}`} {...rest}>
      <div className="mb-5 flex items-center justify-between gap-3 border-b border-hairline pb-3">
        <h3 className="flex min-w-0 items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-text-muted">
          {Icon ? <Icon size={14} aria-hidden="true" className="shrink-0" /> : null}
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/**
 * One labelled value. `empty` prints the muted italic placeholder style;
 * `accent` swaps the rule colour (a priority, a key identifier).
 */
export function DetailField({ label, children, empty = false, mono = false, accent = '', className = '' }) {
  return (
    <div className={`min-w-0 border-l-2 pl-3 ${accent || 'border-hairline'} ${className}`}>
      <span className="mb-0.5 block text-[11px] text-text-muted">{label}</span>
      <div
        className={`break-words text-sm font-medium ${mono ? 'font-mono tracking-wide' : ''} ${
          empty ? 'italic text-text-muted' : 'text-text-primary'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

const NODE = {
  done: 'bg-success shadow-[0_0_8px_color-mix(in_oklab,var(--color-success)_60%,transparent)]',
  warning: 'bg-warning shadow-[0_0_8px_color-mix(in_oklab,var(--color-warning)_60%,transparent)]',
  pending: 'border-2 border-text-muted bg-base-900',
}
const LABEL = {
  done: 'font-bold text-success',
  warning: 'font-bold text-warning',
  pending: 'font-medium text-text-secondary',
}

/**
 * A vertical timeline. Each item: `{ key, label, detail?, stamp?, dateTime?,
 * tone: 'done' | 'warning' | 'pending' }`. `stamp` is the formatted time line
 * (mono); `dateTime` its machine-readable ISO for the <time> element.
 */
export function DetailTimeline({ items }) {
  return (
    <ol className="relative space-y-8 pl-6 before:absolute before:bottom-6 before:left-[4px] before:top-2 before:w-px before:bg-hairline">
      {items.map((item) => {
        const tone = NODE[item.tone] ? item.tone : 'done'
        return (
          <li key={item.key} className="relative">
            <span aria-hidden="true" className={`absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full ${NODE[tone]}`} />
            <p className={`text-sm ${LABEL[tone]}`}>{item.label}</p>
            {item.detail ? (
              <p className={`mt-0.5 truncate text-xs ${tone === 'pending' ? 'text-text-muted' : 'font-medium text-text-secondary'}`}>
                {item.detail}
              </p>
            ) : null}
            {item.stamp ? (
              <time dateTime={item.dateTime} className="mt-0.5 block font-mono text-[10px] text-text-muted">
                {item.stamp}
              </time>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
