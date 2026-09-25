import { Map as MapIcon, ActivitySquare, History, FilePlus2, Ticket, Siren, Settings } from 'lucide-react'
import DashboardLayout from '@shared/layouts/DashboardLayout'
import { useAuth } from '@shared/auth/AuthContext'
import LocationAccessNotice from '@/components/LocationAccessNotice'
import { useGuardTelemetryState } from '@/components/GuardTelemetryProvider'
import { portalKey } from '@shared/config/portal'
import { ROUTES } from '@/config/portal'
import DutyLockOverlay from '@/components/DutyLockOverlay'

// Grouped on the same Platform/System split the Admin sidebar uses, so the two
// portals' navigation reads identically: live operational surfaces first, then
// the record-keeping ones.
//
// Incident Tickets and Response Metrics are two destinations, not one. They
// answer different questions — "what do I work on next" vs "how are we
// doing" — and are read at different moments, so folding the queue under the
// analytics page meant scrolling past charts to reach a live call.
const NAV_GROUPS = [
  {
    label: 'Operations',
    items: [
      { to: ROUTES.dashboard, label: 'Dispatch map', icon: MapIcon },
      { to: ROUTES.tickets, label: 'Incident tickets', icon: Ticket },
      { to: ROUTES.sos, label: 'Panic alerts (SOS)', icon: Siren },
      { to: ROUTES.report, label: 'File a report', icon: FilePlus2 },
    ],
  },
  {
    label: 'Records',
    items: [
      { to: ROUTES.history, label: 'Incident history', icon: History },
      { to: ROUTES.performance, label: 'Response metrics', icon: ActivitySquare },
      { to: ROUTES.settings, label: 'Settings', icon: Settings },
    ],
  },
]

const ROLE_LABELS = {
  super_admin: 'Super admin',
  security_head: 'Security head',
  security_officer: 'Security officer',
}

/**
 * The Guardhouse's one primary action, in the top bar on every page: filing a
 * report is the officer's own way to put a call on the map. Opens the form on
 * the report page (see ReportPage's `?file=1`).
 */
const PRIMARY_ACTION = {
  label: 'File incident report',
  to: `${ROUTES.report}?file=1`,
  icon: FilePlus2,
}

export default function AppShell({ children, dutyLock = true, ...props }) {
  const { role } = useAuth()
  const telemetry = useGuardTelemetryState()

  return (
    <DashboardLayout
      roleLabel={ROLE_LABELS[role] ?? 'On duty'}
      navGroups={NAV_GROUPS}
      collapseKey={portalKey('sidebar-collapsed')}
      alertPath={ROUTES.history}
      historyPath={ROUTES.history}
      primaryAction={PRIMARY_ACTION}
      {...props}
    >
      {/* ── THE DUTY LOCK ────────────────────────────────────────────────
          Mounted in the SHELL, not on each page, so a surface added later is
          locked by default rather than by somebody remembering to lock it.

          `dutyLock={false}` is for the two read-only records pages — Incident
          History and Response Metrics. Reading a past shift's numbers writes
          nothing and attributes nothing, and locking it would mean a guard
          could not check their own record without opening a shift they are
          not working.

          `relative` on the wrapper is what the overlay's `absolute inset-0`
          resolves against: it covers the page body and leaves the sidebar and
          top bar reachable, so Clock In and Sign Out are never behind the
          thing that is asking you to clock in. */}
      {/* A flex column so the notice takes the height it needs and the page
          below keeps the rest. The maps pin themselves with `h-full`, which
          resolves against this column — drop the column and a banner would
          push a full-height map past the bottom of the shell. */}
      <div className="flex h-full min-h-0 flex-col">
        <LocationAccessNotice {...telemetry} />
        <div className="relative min-h-0 flex-1">
          {children}
          {dutyLock ? <DutyLockOverlay /> : null}
        </div>
      </div>
    </DashboardLayout>
  )
}
