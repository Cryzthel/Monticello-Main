/**
 * One chunk of Settings, ENCLOSED (2026-10-19): a glass card holding its own
 * heading and its rows. The Law of Common Region — settings that belong
 * together share a visible boundary — so Profile, Security, Notifications and
 * System read as four objects rather than one long list with eyebrows.
 *
 * Same surface as the record-detail cards (DetailCard): rounded, hairline
 * border, base-900/40 glass, so the console has one card language. Rows are
 * divided by hairlines inside the card. `id` is the anchor old
 * /settings/<slug> URLs scroll to.
 */
export default function SettingsSection({ id, icon: Icon, title, action, children }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-28 rounded-2xl border border-hairline bg-base-900/40 p-6 shadow-sm backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline pb-4">
        <h2
          id={`${id}-heading`}
          className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-text-muted"
        >
          {Icon ? <Icon size={14} aria-hidden="true" /> : null}
          {title}
        </h2>
        {action}
      </div>
      <div className="flex flex-col divide-y divide-hairline">{children}</div>
    </section>
  )
}
