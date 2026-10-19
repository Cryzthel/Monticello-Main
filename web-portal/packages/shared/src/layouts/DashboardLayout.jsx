import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@shared/auth/AuthContext'
import CollapsibleSidebar from '@shared/layouts/CollapsibleSidebar'
import TopHeader from '@shared/layouts/TopHeader'
import CommandPalette from '@shared/components/CommandPalette'
import PageHeader from '@shared/components/PageHeader'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { LogOut } from '@shared/icons'
import { useIncidentAlerts } from '@shared/hooks/useIncidentAlerts'

/**
 * The dashboard layout shell — the single surface behind both AdminShell and
 * SecurityShell. Sidebar, top bar, command palette, toast alert listener and
 * collapse persistence all live here exactly once, so "the two portals look
 * consistent" is a structural guarantee (same component, different config)
 * rather than two hand-copied layouts that can quietly drift apart.
 *
 * MAIN CONTENT ADJUSTMENT
 * -----------------------
 * The content column is a flex sibling of the sidebar with `flex-1 min-w-0`,
 * so it reclaims the freed space as the rail animates — no width calculation,
 * no margin-left keyed to the collapsed state, and nothing to keep in sync if
 * the rail's dimensions ever change. `min-w-0` is what stops a wide child
 * (a data table, the Mapbox canvas) from refusing to shrink and pushing the
 * layout horizontally instead.
 *
 * SCROLLING, AND WHY `scroll={false}` IS DESKTOP-ONLY
 * --------------------------------------------------
 * `scroll={false}` means "this page manages its own scroll regions" — the
 * tickets queue, the reports table and the dispatch map each pin a full-height
 * chrome and scroll only their inner list. That contract holds on a desktop
 * viewport, where there is room for the chrome AND a usable list.
 *
 * On a phone there is not. Header, section heading, filter bar and bulk-action
 * bar together exceed a 667px viewport before a single row is drawn, so
 * `overflow-hidden` here clipped the rest of the page with no way to reach it —
 * the page read as frozen, because nothing on it could be scrolled to. Below
 * `lg` the shell therefore ALWAYS scrolls, and pages relax their own `h-full`
 * pins to `lg:h-full` so their content stacks and flows into it.
 *
 * `bleed` IS THE ONE EXCEPTION, AND ONLY BECAUSE THE PAGE IS ONE ELEMENT
 * ---------------------------------------------------------------------
 * The rule above exists because a phone cannot show chrome AND a usable list,
 * so anything pinned to the viewport hid content nobody could scroll to. A map
 * page has no such content: the dispatch and hazard pages render the map and
 * nothing else — their drawers and modals are overlays. There is nothing to
 * scroll to, so pinning the map to the viewport hides nothing, and the thing
 * being pinned is the one element on the page you actually want as large as
 * the screen allows.
 *
 * So `bleed` drops this column's padding below `lg` and the page pins its own
 * `h-full`. Do NOT reach for it on a page that stacks anything under the map;
 * that is the case the rule above is protecting, and it would be frozen again.
 *
 * `100dvh` rather than `100vh`: mobile Safari and Chrome measure `vh` against
 * the viewport with the URL bar retracted, so an `h-screen` shell is taller
 * than the visible area on first paint and its last rows sit under the browser
 * chrome — the same "content is cut off" symptom by a different route.
 */
export default function DashboardLayout({
  navGroups,
  /** Optional `{ [navPath]: count }` — renders a live badge on that nav item. */
  badgeCounts,
  collapseKey,
  /** Route a real-time incident toast's "Inspect report" action opens. */
  alertPath,
  // Where each notification kind opens; see NotificationBell / notificationHref.
  notificationRoutes,
  /** Route the notification panel's History control opens. */
  historyPath,
  title,
  subtitle,
  /** Controls that shape the page below them (a timeframe), set opposite the page title. */
  headerActions,
  /**
   * The portal's one near-black CTA in the top bar: `{ label, to, icon }`.
   * Set by each portal's AppShell, so it is the same on every page.
   */
  primaryAction,
  /**
   * Full-height pages (the maps) put their title in the top bar instead of a
   * page header, so the header's height is not taken from the map.
   */
  inlineTitle = false,
  /**
   * Pins the page header (title, subtitle, actions) to the top of the scroll
   * column on a blurred band â€” for long forms whose Save lives in the header.
   */
  stickyHeader = false,
  topBarSlot,
  /** Optional render prop, `({ collapsed }) => node`, mounted in the sidebar between the nav and the account footer. */
  sidebarSlot,
  children,
  scroll = true,
  /** Full-bleed content below `lg` — see the note above before using it. */
  bleed = false,
  /** Copy for the sign-out confirmation. Portals name their own console. */
  logoutMessage = 'You will be signed out of this console.',
  /**
   * A portal-owned gate on signing out.
   *
   * The guardhouse needs one: a guard who signs out mid-shift leaves the
   * `guard_shifts` row open forever, so the duty log records a shift that
   * never ended. The admin console has nothing equivalent, which is why this
   * is a prop rather than logic in here — the shared layout has no idea what
   * "on duty" means and should not learn.
   *
   * When `logoutBlocked` is true the sign-out control calls
   * `onBlockedLogout()` and this layout's own confirmation never opens; the
   * portal is then responsible for the whole interaction, including actually
   * signing out once its gate is satisfied.
   */
  logoutBlocked = false,
  onBlockedLogout,
  /**
   * The full name shown over the email in the sidebar's profile block.
   * Omit it (Admin) and the block shows the email alone.
   */
  profileName,
}) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapseKey) === '1')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  // Live incident alert SOUNDS for whichever portal is mounted; the rows
  // themselves are in the notification bell's feed.
  useIncidentAlerts()

  useEffect(() => {
    localStorage.setItem(collapseKey, collapsed ? '1' : '0')
  }, [collapsed, collapseKey])

  useEffect(() => {
    function handleKeydown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [])

  /*
   * Two ways the drawer could be left open with nothing on screen to close it,
   * both of which leave a full-viewport backdrop swallowing every tap:
   *
   *   1. Navigation that did not come from a drawer nav row — a toast's
   *      "Inspect report" action, the command palette, the browser's own back
   *      button. `onNavigate` closes the drawer for nav rows and nothing else,
   *      so none of those three were covered.
   *   2. A rotate or resize past `lg`, where the wrapper is `lg:hidden`. The
   *      backdrop stops painting but `drawerOpen` stays true, so rotating back
   *      to portrait re-mounts a drawer the user never asked for.
   *
   * Closing on both means the open state can never outlive the UI that shows it.
   */
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    // The same 1024px boundary as the `lg:hidden` wrapper above, expressed once
    // so the two cannot drift. This is belt-and-braces rather than the load
    // bearing guard: above `lg` the wrapper is already `display: none`, so a
    // stale-open drawer cannot swallow clicks — what this prevents is the
    // drawer springing back unasked when the device rotates to portrait again.
    const desktop = window.matchMedia('(min-width: 1024px)')
    const sync = (event) => {
      if (event.matches) setDrawerOpen(false)
    }
    sync(desktop)
    desktop.addEventListener('change', sync)
    return () => desktop.removeEventListener('change', sync)
  }, [])

  const sidebarProps = {
    navGroups,
    badgeCounts,
    onLogout: () => {
      if (logoutBlocked) onBlockedLogout?.()
      else setConfirmingLogout(true)
    },
    sidebarSlot,
    profile: user?.email ? { name: profileName, email: user.email } : null,
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-base-950 text-text-primary">
      {/* The rail has no toggle of its own any more — TopHeader owns it, so
          the control stays put whatever the sidebar is doing. */}
      <CollapsibleSidebar {...sidebarProps} collapsed={collapsed} />

      {/* Mobile drawer — below lg the rail is hidden, and without this the
          portals would be unnavigable on a tablet or phone. Same component,
          permanently expanded, so the two can't drift. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-scrim"
          />
          <CollapsibleSidebar
            {...sidebarProps}
            variant="drawer"
            onClose={() => setDrawerOpen(false)}
            onNavigate={() => setDrawerOpen(false)}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader
          title={title}
          inlineTitle={inlineTitle}
          primaryAction={primaryAction}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((prev) => !prev)}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          alertPath={alertPath}
          historyPath={historyPath}
          notificationRoutes={notificationRoutes}
          topBarSlot={topBarSlot}
        />

        {/*
          `overscroll-contain` stops a flick that reaches the end of this
          column from chaining into the document behind it, which on iOS is
          what produces the rubber-band-then-nothing-responds feel.
        */}
        {/*
          A MEASURE. Uncapped, this ran to whatever the display gave it: at
          1920px a card reached 1616px and a table row 1566px, while the top
          bar's own search stopped at max-w-xl (576px) — so the two halves of
          the page disagreed about how wide the page was, which read as the bar
          being mis-sized rather than the content being wide.
          100rem engages only above ~1856px, so no laptop layout moves.
        */}
        <main
          className={`custom-scrollbar mx-auto flex w-full min-w-0 max-w-[100rem] flex-1 flex-col overflow-y-auto overscroll-contain ${
            bleed ? 'p-0 lg:p-6 lg:pb-12' : 'p-4 pb-10 sm:p-6 sm:pb-12'
          } ${scroll ? '' : 'lg:overflow-hidden'}`}
        >
          {!inlineTitle && title ? (
            <PageHeader
              className={
                stickyHeader
                  ? // From `md` only: on a phone the wrapped title and actions
                    // would pin a third of the screen. `-top-6`: sticky sticks
                    // inside main's padding, so the band is pulled up over it
                    // to sit flush, and the negative margins span it edge to edge.
                    'mb-6 shrink-0 md:sticky md:-top-6 md:z-20 md:-mx-6 md:-mt-6 md:mb-8 md:border-b md:border-hairline md:bg-base-950/80 md:px-6 md:py-4 md:backdrop-blur-xl'
                  : 'mb-6 shrink-0'
              }
              title={title}
              subtitle={subtitle}
              actions={headerActions}
            />
          ) : null}
          {/*
            The page's own box, and the two modes are NOT the same box.

            `scroll={false}` — the page owns its scrolling. `flex-1` fills what
            the header leaves so a page that sizes itself `h-full` (the maps,
            the ticket queues) still fills the column, and `min-h-0` lets its
            inner regions scroll instead of pushing the column taller.

            `scroll` (the default) — the SHELL scrolls, and those same two
            classes were a bug. `min-h-0` lets a flex item shrink below its own
            content, so this box stayed at the viewport's height while the page
            inside it grew past it: measured at 1280x800, the box was 584px tall
            around 1224px of content. Everything attached to the box — main's
            `pb-12`, a margin, even an explicit spacer element — therefore
            landed at the 584px mark, in the MIDDLE of the overflow, and the
            last card ended flush against the viewport at scroll end. Dropping
            both classes gives the box its automatic minimum size back; it now
            grows with the page, and the bottom padding has something to sit
            under. Measured after: 48px of clearance at the end of the scroll.
          */}
          {/* Keyed by path, so each route fades in (`.page-enter`, 180 ms,
              opacity only). A query or hash change on the same page does not
              replay it. */}
          <div key={location.pathname} className={`page-enter ${scroll ? '' : 'min-h-0 flex-1'}`}>
            {children}
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navGroups={navGroups}
        onNavigate={navigate}
      />

      {/* Sign out asks first.
          The control sits at the bottom of the rail, directly under "Settings",
          and it is the only item there that cannot be undone by clicking back.
          On the guardhouse console that matters more than on the admin one: a
          mis-click mid-shift drops a guard out of a console that is watching
          for an SOS, and getting back in costs a sign-in on a shared machine.

          `tone="warning"`, deliberately not `danger`. ConfirmDialog has three
          tones and falls back to `danger` for anything it does not recognise,
          so an invented value here would silently render a red dialog with a
          TRASH icon over the word "Log out". Signing out destroys nothing; it
          is simply not reversible in place, which is what warning is for. */}
      <ConfirmDialog
        open={confirmingLogout}
        title="Log out?"
        message={logoutMessage}
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        tone="danger"
        icon={LogOut}
        centered
        onConfirm={logout}
        onCancel={() => setConfirmingLogout(false)}
      />
    </div>
  )
}
