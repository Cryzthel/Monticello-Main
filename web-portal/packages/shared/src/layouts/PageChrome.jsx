import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * ── ONE SHELL, MOUNTED ONCE ────────────────────────────────────────────────
 * Every page used to render its own <AppShell>, so clicking a nav link tore
 * down the whole sidebar and header and built new ones (2026-10-18). Each
 * rebuild restarted the shell's live listeners — the Residents badge vanished
 * and popped back, the bell count reset — and replayed first-frame state,
 * which is the jitter seen when switching pages.
 *
 * Now each portal has a layout ROUTE (its AppShellLayout) that mounts the
 * DashboardLayout once, with <Outlet /> as the page. A page still writes
 * `<AppShell title=… scroll={false} topBarSlot={…}>`; inside the layout route
 * that AppShell no longer builds a layout. It REPORTS its chrome:
 *
 *   • primitives (title, subtitle, scroll, bleed, inlineTitle, dutyLock, and
 *     whether it has each slot) go up through `setPage`, from a layout
 *     effect — before paint, so a title never flashes stale;
 *   • elements (topBarSlot, headerActions, primaryAction) are PORTALLED into
 *     placeholders the layout renders only while the page says it has one.
 *     Passing elements up as state would loop: an element is a new object on
 *     every render, so the page and the layout would re-render each other
 *     forever.
 *
 * Outside a layout route (no provider), AppShell keeps building its own
 * layout, so nothing that renders one directly breaks.
 */

const PageChromeContext = createContext(null)

/** The chrome the CURRENT page asked for; what the persistent layout renders. */
export const DEFAULT_PAGE_CHROME = {
  title: undefined,
  subtitle: undefined,
  scroll: true,
  bleed: false,
  inlineTitle: false,
  stickyHeader: false,
  dutyLock: true,
  hasTopBar: false,
  hasHeaderActions: false,
  hasPrimaryAction: false,
}

/**
 * State and slot targets for a persistent layout. Returns:
 *   page        — the current page's chrome (DEFAULT_PAGE_CHROME shape)
 *   provider    — wrap the layout in this
 *   slotProps   — spread onto DashboardLayout: topBarSlot / headerActions /
 *                 primaryAction placeholders, present only when the page has one
 */
export function usePersistentChrome() {
  const [page, setPage] = useState(DEFAULT_PAGE_CHROME)
  const [topBar, setTopBar] = useState(null)
  const [headerActions, setHeaderActions] = useState(null)
  const [primaryAction, setPrimaryAction] = useState(null)

  const value = useMemo(
    () => ({ setPage, nodes: { topBar, headerActions, primaryAction } }),
    [topBar, headerActions, primaryAction],
  )

  const slotProps = {
    topBarSlot: page.hasTopBar ? <span ref={setTopBar} className="contents" /> : undefined,
    headerActions: page.hasHeaderActions ? <span ref={setHeaderActions} className="contents" /> : undefined,
    primaryAction: page.hasPrimaryAction ? <span ref={setPrimaryAction} className="contents" /> : undefined,
  }

  return { page, value, slotProps }
}

export function PageChromeProvider({ value, children }) {
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>
}

/** The persistent layout's channel, or null when AppShell must build its own. */
export function usePageChrome() {
  return useContext(PageChromeContext)
}

/**
 * What a page's AppShell renders inside a persistent layout: it reports its
 * chrome and portals its header elements into the layout's slots.
 */
export function ReportPageChrome({
  chrome,
  title,
  subtitle,
  scroll = true,
  bleed = false,
  inlineTitle = false,
  stickyHeader = false,
  dutyLock = true,
  topBarSlot,
  headerActions,
  primaryAction,
  children,
}) {
  const hasTopBar = Boolean(topBarSlot)
  const hasHeaderActions = Boolean(headerActions)
  const hasPrimaryAction = Boolean(primaryAction)
  const { setPage, nodes } = chrome

  useLayoutEffect(() => {
    setPage({ title, subtitle, scroll, bleed, inlineTitle, stickyHeader, dutyLock, hasTopBar, hasHeaderActions, hasPrimaryAction })
  }, [setPage, title, subtitle, scroll, bleed, inlineTitle, stickyHeader, dutyLock, hasTopBar, hasHeaderActions, hasPrimaryAction])

  // On leaving, hand back a neutral chrome; the next page's layout effect
  // replaces it in the same commit, before paint.
  useLayoutEffect(() => () => setPage(DEFAULT_PAGE_CHROME), [setPage])

  return (
    <>
      {hasTopBar && nodes.topBar ? createPortal(topBarSlot, nodes.topBar) : null}
      {hasHeaderActions && nodes.headerActions ? createPortal(headerActions, nodes.headerActions) : null}
      {hasPrimaryAction && nodes.primaryAction ? createPortal(primaryAction, nodes.primaryAction) : null}
      {children}
    </>
  )
}
