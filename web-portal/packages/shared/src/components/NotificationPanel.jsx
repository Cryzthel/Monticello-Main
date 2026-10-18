import { ArrowRight, BellOff, Check, MapPin } from '@shared/icons'
import { clockTime } from '@shared/lib/notifications'
import { notificationIcon } from '@shared/theme/categoryIcons'

/**
 * The notification panel, minimalist (2026-10-17, second reference).
 *
 * Header (title, Mark all read) → All / Unread pills → day-grouped rows →
 * "View all activity". Rows are quiet: a 16px icon, title and time on one
 * line, the detail, the place. Nothing is a card until it is hovered.
 *
 * ── TOKENS, NOT THE REFERENCE'S ZINC HEXES ─────────────────────────────────
 * #09090b / #18181b / #121214 are this console's own dark surfaces already,
 * as `base-950` / `base-900` / `base-800`; using the tokens keeps light mode
 * working too. The unread dot is the brand emerald with its glow, not the
 * reference's blue, so the panel has one accent like the rest of the console.
 * SOS keeps red on its icon and its status phrase.
 *
 * ── TWO FILTERS ────────────────────────────────────────────────────────────
 * "Incidents" and "Announcements" are gone: every row now opens the page it
 * is about, so the feed itself is the router and kind filters added a choice
 * nobody needed to make.
 */

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
]

export function NotificationFilterTabs({ filter, counts, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Filter notifications"
      className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-hairline px-5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {FILTERS.map((tab) => {
        const selected = filter === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
              selected
                ? 'border-hairline bg-base-800 text-text-primary shadow-sm'
                : 'border-transparent text-text-secondary hover:bg-base-900 hover:text-text-primary'
            }`}
          >
            {tab.label}
            <span className={`font-normal tabular-nums ${selected ? 'text-text-secondary' : 'text-text-muted'}`}>
              {counts[tab.id] ?? 0}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * One notification. The whole row is the button: it marks the notification
 * read and opens what it is about in one press. A row with no destination is
 * still pressable — it just marks itself read.
 */
export function NotificationItem({ notification, unread, onOpen }) {
  const { title, detail, propertyLabel, at, kind } = notification
  const sos = kind === 'panic'
  const Icon = notificationIcon(notification)
  const unknownPlace = !propertyLabel || /unknown/i.test(propertyLabel)

  // "Name · Active emergency": the status phrase after the dot takes the SOS
  // red, so an emergency is legible in the line itself, not only the icon.
  const [lead, status] = sos && detail?.includes(' · ') ? detail.split(' · ') : [detail, null]

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(notification)}
        aria-label={`${unread ? 'Unread: ' : ''}${title}`}
        className="group relative -mx-2.5 flex w-[calc(100%+1.25rem)] gap-3 rounded-lg border border-transparent p-2.5 text-left transition-colors duration-200 hover:border-hairline hover:bg-base-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        {/* The dot is the ONLY unread mark, and it is removed — not dimmed —
            the moment the row is read. */}
        {unread ? (
          <span
            aria-hidden="true"
            className="absolute left-[3px] top-[18px] h-1.5 w-1.5 rounded-full bg-brand-500 shadow-[0_0_8px_color-mix(in_oklab,var(--color-brand-500)_60%,transparent)]"
          />
        ) : null}
        <span className={`ml-2 mt-0.5 shrink-0 ${sos ? 'text-danger' : 'text-text-secondary'}`}>
          {Icon ? <Icon size="sm" aria-hidden="true" /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-start justify-between gap-2">
            <span className={`truncate text-[13px] font-medium ${unread ? 'text-text-primary' : 'text-text-secondary'}`}>
              {title}
            </span>
            <span className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-text-muted">{clockTime(at)}</span>
          </span>
          {detail ? (
            <span className="truncate text-xs text-text-secondary">
              {lead}
              {status ? (
                <>
                  {' • '}
                  <span className="font-medium text-danger">{status}</span>
                </>
              ) : null}
            </span>
          ) : null}
          {propertyLabel ? (
            <span className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-medium ${unknownPlace ? 'text-text-muted/80' : 'text-text-muted'}`}>
              <MapPin size="sm" aria-hidden="true" className="shrink-0" />
              <span className="truncate">{propertyLabel}</span>
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

export function NotificationGroup({ section, isUnread, onOpen }) {
  return (
    <section className="space-y-1">
      <h3 className="pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">{section.label}</h3>
      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <NotificationItem key={item.id} notification={item} unread={isUnread(item)} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  )
}

export default function NotificationPanel({
  sections,
  counts,
  filter,
  onFilterChange,
  isUnread,
  onMarkAllRead,
  onOpen,
  onViewAll,
}) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">Notifications</h2>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={counts.unread === 0}
          className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-text-muted transition-colors duration-200 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default disabled:opacity-40 disabled:hover:text-text-muted"
        >
          <Check size="sm" aria-hidden="true" />
          Mark all read
        </button>
      </div>

      <NotificationFilterTabs filter={filter} counts={counts} onChange={onFilterChange} />

      {sections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-14 text-center">
          <BellOff size="lg" className="text-text-muted" />
          <p className="text-sm text-text-secondary">{filter === 'unread' ? "You're all caught up." : 'No activity yet.'}</p>
        </div>
      ) : (
        <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {sections.map((section) => (
            <NotificationGroup key={section.key} section={section} isUnread={isUnread} onOpen={onOpen} />
          ))}
        </div>
      )}

      <div className="shrink-0 border-t border-hairline px-5 py-3">
        <button
          type="button"
          onClick={onViewAll}
          className="flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium text-text-secondary transition-colors duration-200 hover:bg-base-900 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          View all activity
          <ArrowRight size="sm" aria-hidden="true" />
        </button>
      </div>
    </>
  )
}
