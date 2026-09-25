import {
  LayoutDashboard,
  Flame,
  Ticket,
  Siren,
  ClipboardList,
  Users,
  ShieldCheck,
  BarChart3,
  History,
  Megaphone,
  SlidersHorizontal,
} from 'lucide-react'
import { useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import DashboardLayout from '@shared/layouts/DashboardLayout'
import { useAuth } from '@shared/auth/AuthContext'
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
      { to: ROUTES.heatmap, label: 'Hazard map', icon: Flame },
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
    items: [{ to: ROUTES.settings, label: 'Settings', icon: SlidersHorizontal }],
  },
]

// Granular role -> the label shown in the sidebar footer, mirroring
// SecurityShell. "Admin" was a static string here, so a super_admin and an
// hoa_admin were indistinguishable in the one place the portal states who you
// are signed in as.
const ROLE_LABELS = {
  super_admin: 'Super admin',
  hoa_admin: 'HOA admin',
}

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

export default function AppShell(props) {
  // Live count of residents awaiting verification, so a new mobile signup
  // raises a badge on the Residents nav item from any admin page — the
  // "notify me when someone registers" half of the workflow.
  const pendingResidentsQuery = useMemo(
    () => query(collection(db, 'residents'), where('verificationStatus', '==', 'pending')),
    [],
  )
  const { data: pendingResidents } = useLiveCollection(pendingResidentsQuery)
  const { role } = useAuth()


  return (
    <DashboardLayout
      roleLabel={ROLE_LABELS[role] ?? 'Admin'}
      navGroups={NAV_GROUPS}
      badgeCounts={{ [ROUTES.residents]: pendingResidents.length }}
      collapseKey={portalKey('sidebar-collapsed')}
      alertPath={ROUTES.tickets}
      sidebarSlot={renderSponsorSlot}
      {...props}
    />
  )
}
