/**
 * One setting: what it is on the left, the control on the right, so every
 * control in a card lines up on one edge. Side by side from `lg` (the control
 * track caps at 400px and may shrink), stacked below it, where a fixed 400px
 * track beside the label would crowd a narrow content area. Rows sit inside a
 * SettingsSection card, which draws the hairlines between them. `labelFor`
 * ties the title to its control for screen readers and click-to-focus.
 */
export default function SettingsItem({ title, description, labelFor, align = 'center', children }) {
  const Title = labelFor ? 'label' : 'h3'
  return (
    <div
      className={`grid grid-cols-1 gap-4 py-5 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:gap-10 ${
        align === 'start' ? 'items-start' : 'items-center'
      }`}
    >
      <div className="min-w-0 lg:pr-4">
        <Title htmlFor={labelFor} className="block text-sm font-medium text-text-primary">
          {title}
        </Title>
        {description ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
