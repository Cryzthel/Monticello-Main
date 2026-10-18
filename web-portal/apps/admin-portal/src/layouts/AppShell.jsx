import {
  LayoutDashboard,
  Map,
  Ticket,
  Siren,
  ClipboardList,
  Users,
  ShieldCheck,
  BarChart3,
  History,
  Megaphone,
  Settings,
} from '@shared/icons'
import { useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { Outlet } from 'react-router-dom'
import DashboardLayout from '@shared/layouts/DashboardLayout'
import {
  PageChromeProvider,
  ReportPageChrome,
  usePageChrome,
  usePersistentChrome,
} from '@shared/layouts/PageChrome'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { portalKey } from '@shared/config/portal'
import { ROUTES } from '@/config/portal'
import EarnWhileYouWait from '@/components/EarnWhileYouWait'

const NAV_GROUPS = [
  {
    label: 'Platform',
    items: [
      { to: ROUTES.dashboard, label: 'Overview', icon: LayoutDashboard },
      // `Map`, not `Flame`. The row leads to a map, and that is what the
      // glyph should say; a flame described the hazards ON it, which is a
      // different claim and one the page's own pins already make. Flame is
      // still the `fire` CATEGORY icon in theme/categoryIcons.js, so this
      // frees it to mean exactly one thing.
      { to: ROUTES.heatmap, label: 'Hazard map', icon: Map },
      { to: ROUTES.tickets, label: 'Incident tickets', icon: Ticket },
      { to: ROUTES.sos, label: 'Panic alerts (SOS)', icon: Siren },
      // Officer-filed logs, not the resident ticket queue — two different
      // inboxes over the same collection, so they are two nav rows.
      { to: ROUTES.reports, label: 'Reports', icon: ClipboardList },
      { to: ROUTES.metrics, label: 'System metrics', icon: BarChart3 },
    ],
  },
  {
    label: 'System',
    items: [
      { to: ROUTES.residents, label: 'Residents', icon: Users },
      { to: ROUTES.securityAccounts, label: 'Security accounts', icon: ShieldCheck },
      { to: ROUTES.announcements, label: 'Announcements', icon: Megaphone },
      { to: ROUTES.history, label: 'Audit history', icon: History },
    ],
  },
  {
    label: 'Administration',
    // `Settings` (the cog), not `SlidersHorizontal` (the faders). The faders
    // are the MAP FILTER control in IncidentMap and still are; using them
    // here too made one glyph mean both "filter this view" and "configure
    // the system".
    items: [{ to: ROUTES.settings, label: 'Settings', icon: Settings }],
  },
]

/**
 * The Admin console's one primary action, in the top bar on every page.
 * Broadcasting is the task an administrator starts most, and the only one
 * that reaches every resident; it opens the composer on the Announcements
 * page (see AnnouncementsManager's `?compose=1`).
 */

// Admin only, by decision: the Guardhouse is watched during live incidents,
// where a sponsored card would compete with a dispatch for a guard's eyes.
// Module-level so the sidebar receives the same function on every render.
function renderSponsorSlot({ collapsed }) {
  return <EarnWhileYouWait collapsed={collapsed} />
}

/** Everything the shell needs that does not come from the page. */
function useShellProps() {
  // Live count of residents awaiting verification, so a new mobile signup
  // raises a badge on the Residents nav item from any admin page — the
  // "notify me when someone registers" half of the workflow.
  const pendingResidentsQuery = useMemo(
    () => query(collection(db, 'residents'), where('verificationStatus', '==', 'pending')),
    [],
  )
  const { data: pendingResidents } = useLiveCollection(pendingResidentsQuery)

  return {
    navGroups: NAV_GROUPS,
    badgeCounts: { [ROUTES.residents]: pendingResidents.length },
    collapseKey: portalKey('sidebar-collapsed'),
    alertPath: ROUTES.tickets,
    // A notification opens the page it is about: the report in Tickets, the
    // SOS on the Hazard map, the bulletin in Announcements.
    notificationRoutes: {
      incident: `${ROUTES.tickets}?incident=`,
      panic: `${ROUTES.heatmap}?panic=`,
      announcement: ROUTES.announcements,
    },
    sidebarSlot: renderSponsorSlot,
  }
}

/**
 * The persistent shell — a layout ROUTE wrapping every signed-in page, so the
 * sidebar, header and their live listeners mount ONCE and survive navigation
 * (see shared/layouts/PageChrome.jsx for why, and how pages report into it).
 */
export function AppShellLayout() {
  const shell = useShellProps()
  const { page, value, slotProps } = usePersistentChrome()
  return (
    <PageChromeProvider value={value}>
      <DashboardLayout
        {...shell}
        title={page.title}
        subtitle={page.subtitle}
        scroll={page.scroll}
        bleed={page.bleed}
        inlineTitle={page.inlineTitle}
        stickyHeader={page.stickyHeader}
        {...slotProps}
      >
        <Outlet />
      </DashboardLayout>
    </PageChromeProvider>
  )
}

/**
 * What a page renders. Inside AppShellLayout it only reports its chrome; on
 * its own (no layout route above it) it builds the full layout as before.
 */
export default function AppShell(props) {
  const chrome = usePageChrome()
  if (chrome) return <ReportPageChrome chrome={chrome} {...props} />
  return <StandaloneShell {...props} />
}

function StandaloneShell(props) {
  const shell = useShellProps()
  return <DashboardLayout {...shell} {...props} />
}
