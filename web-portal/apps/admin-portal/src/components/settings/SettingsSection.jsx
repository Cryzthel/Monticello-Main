/**
 * One chunk of Settings: a small uppercase eyebrow with its icon, then rows
 * divided by hairlines. `id` is the anchor old /settings/<slug> URLs scroll to.
 */
export default function SettingsSection({ id, icon: Icon, title, action, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2
          id={`${id}-heading`}
          className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-text-muted"
        >
          {Icon ? <Icon size={14} aria-hidden="true" /> : null}
          {title}
        </h2>
        {action}
      </div>
      <div className="flex flex-col border-t border-hairline">{children}</div>
    </section>
  )
}
