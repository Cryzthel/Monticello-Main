import { Link, useLocation } from 'react-router-dom'
import { Menu, PanelLeftClose, PanelLeftOpen, Search } from '@shared/icons'
import NotificationBell from '@shared/components/NotificationBell'
import ThemeToggle from '@shared/components/ThemeToggle'

/**
 * The top bar: the same on every page of a portal.
 *
 *   [≡] [⇤] [ Search pages…               ⌘K ]      [slot] [+ Primary] [☾] [🔔]
 *
 * ── WHAT MOVED OUT, AND WHY (2026-09-22 redesign) ──────────────────────────
 * The page title used to live here, which left the search as a button that
 * hid itself on desktop and put the title, the search and the page's own
 * controls in competition for one row. The title now heads the page itself
 * (see PageHeader), and this bar carries only what does not change between
 * pages:
 *
 *   search          a full-width field on the left. It is a BUTTON styled as a
 *                   field: typing goes to the command palette, which already
 *                   owns search for both portals. A real <input> here would
 *                   have to duplicate that or hand focus over on the first
 *                   keystroke, and both read as a bug.
 *   primary action  the portal's one near-black CTA (Create announcement,
 *                   File incident report), on the right where the eye ends.
 *   theme and bell  unchanged.
 *
 * `inlineTitle` is for the full-height map pages. Every pixel of a page
 * header there would be taken from the map, so the title rides in this bar
 * instead, compact, before the search.
 *
 * Sits on the canvas colour, not on white: the bar is chrome, and the white
 * surfaces below are the work.
 */
export default function TopHeader({
  title,
  inlineTitle = false,
  collapsed,
  onToggleCollapse,
  onOpenDrawer,
  onOpenPalette,
  alertPath,
  historyPath,
  topBarSlot,
  primaryAction,
}) {
  const PrimaryIcon = primaryAction?.icon
  // Not on the page it leads to: that page carries the same action in its own
  // header, and two identical buttons on one screen is one too many.
  const { pathname } = useLocation()
  const showPrimary = primaryAction && primaryAction.to.split('?')[0] !== pathname
  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-base-950 px-4 py-3 sm:h-16 sm:flex-nowrap sm:px-6 sm:py-0">
      <button
        type="button"
        onClick={onOpenDrawer}
        className="icon-btn icon-btn-sm icon-btn-plain shrink-0 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size="sm" />
      </button>

      {/* Visible on every rail state, so the control that restores a
          collapsed rail is never the thing the collapse hid. */}
      {onToggleCollapse ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="icon-btn icon-btn-sm icon-btn-plain hidden shrink-0 lg:inline-flex"
        >
          {collapsed ? (
            <PanelLeftOpen size="md" />
          ) : (
            <PanelLeftClose size="md" />
          )}
        </button>
      ) : null}

      {inlineTitle && title ? (
        <h1 className="hidden shrink-0 truncate text-base font-semibold text-text-primary md:block">{title}</h1>
      ) : null}

      {/* Full width up to a readable measure; an icon button below `sm`,
          where a field would leave no room for the controls on the right. */}
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search pages"
        aria-keyshortcuts="Meta+K Control+K"
        // An oblong, matching the SearchField every filter bar below now uses —
        // this is the one search affordance a reader meets first, so it cannot
        // be the one that still looks like a box. `pl-4 pr-2` rather than an
        // even `px-4`: the ⌘K cap needs less room inside the curve than the
        // leading glyph does, and an even padding left it crowding the right
        // edge. `shadow-none` drops the 1px lift a flat oblong does not want.
        className="hidden h-10 min-w-0 max-w-xl flex-1 items-center gap-2.5 rounded-full border border-slate-200 bg-base-900 pl-4 pr-2 text-left text-sm text-text-muted transition-[border-color,color] duration-150 hover:border-slate-300 hover:text-text-secondary sm:flex"
      >
        <Search size="sm" className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Search pages…</span>
        <kbd className="shrink-0 rounded-full border border-hairline bg-slate-50 px-2 py-0.5 font-sans text-2xs text-text-muted">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search pages"
        className="icon-btn icon-btn-sm icon-btn-plain shrink-0 sm:hidden"
      >
        <Search size="sm" />
      </button>

      {/* Wraps under the search on a phone, where the duty controls, the
          action and the two icon buttons cannot share one row with it. */}
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
        {topBarSlot}
        {showPrimary ? (
          <Link
            to={primaryAction.to}
            aria-label={primaryAction.label}
            className="btn btn-brand h-10 px-3 sm:px-4"
          >
            {PrimaryIcon ? <PrimaryIcon size="sm" aria-hidden="true" /> : null}
            {/* `sm:inline`, not `xl:inline`. Hidden below xl, the briefed
                "dark CTA on the right" rendered as a bare icon button on every
                laptop narrower than 1280px. The crowding this guarded against
                is already handled by the `showPrimary` route suppression
                above. */}
            <span className="hidden sm:inline">{primaryAction.label}</span>
          </Link>
        ) : null}
        <ThemeToggle />
        <NotificationBell detailPath={alertPath} historyPath={historyPath} />
      </div>
    </header>
  )
}
