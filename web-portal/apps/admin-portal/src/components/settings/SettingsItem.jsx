/**
 * One setting: what it is on the left, the control on the right in a fixed
 * 400px track, so every control in every section lines up on one edge. Stacks
 * below `md`. `labelFor` ties the title to its control for screen readers and
 * click-to-focus.
 */
export default function SettingsItem({ title, description, labelFor, align = 'center', children }) {
  const Title = labelFor ? 'label' : 'h3'
  return (
    <div
      className={`grid grid-cols-1 gap-4 border-b border-hairline py-6 md:grid-cols-[minmax(0,1fr)_400px] md:gap-12 ${
        align === 'start' ? 'items-start' : 'items-center'
      }`}
    >
      <div className="min-w-0 md:pr-4">
        <Title htmlFor={labelFor} className="block text-sm font-medium text-text-primary">
          {title}
        </Title>
        {description ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
