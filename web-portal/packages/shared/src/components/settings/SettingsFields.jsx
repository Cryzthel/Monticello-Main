/**
 * The two settings primitives still in use: a titled card (`SettingsGroup`)
 * holding hairline-divided rows (`SettingRow`). The Guardhouse Settings page
 * and the shared ChangePasswordPanel draw with them.
 *
 * PRUNED 2026-10-19: the Admin Settings page moved to its own components
 * (apps/admin-portal/src/components/settings), which left the field
 * controls that used to live here — switch, number, choice, text, textarea,
 * volume, hotline and rule-list editors — the 'tiles' variant, and the
 * auto-save commit context with no caller. They were removed rather than kept
 * as unused alternatives to the components that replaced them.
 */

/**
 * The shared row: a 14px medium label over a 12px secondary line, with
 * `control` right-aligned on the first line and `children` beneath. The rule
 * between rows is the group's `divide-y`, so a row never doubles it.
 */
export function SettingRow({ id, title, description, control, children }) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium leading-snug text-text-primary">
            {title}
          </label>
          {description ? (
            <p id={`${id}-description`} className="mt-1 max-w-prose text-xs leading-relaxed text-text-secondary">
              {description}
            </p>
          ) : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function SettingsGroup({ title, description, icon: Icon, action, className = '', children }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-hairline bg-base-900/80 backdrop-blur-xl ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-6 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-500">
            {Icon ? <Icon size="sm" aria-hidden="true" /> : null}
            {title}
          </h2>
          {description ? <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="divide-y divide-divider">{children}</div>
    </section>
  )
}
