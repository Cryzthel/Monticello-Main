import {
  Map as MapIcon,
  ActivitySquare,
  History,
  FilePlus2,
  Ticket,
  Siren,
  Settings,
} from '@shared/icons'
import DashboardLayout from '@shared/layouts/DashboardLayout'
import { useState } from 'react'
import { useAuth } from '@shared/auth/AuthContext'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { useDutyStatus } from '@/hooks/useDutyStatus'
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

/* THE TOP-BAR "FILE INCIDENT REPORT" BUTTON WAS HERE AND IS GONE.
 *
 * It was the third route to the same form on every screen: the sidebar's "File
 * a report" (above, same `FilePlus2` icon, same destination) and the Reports
 * page's own CTA are the other two. A primary action repeated in the chrome
 * next to a nav item that already does it reads as two different things until
 * you click one.
 *
 * ONE THING IS LOST, AND IT IS WORTH KNOWING: this button carried `?file=1`,
 * which opens the form directly. The sidebar link lands on the Reports page,
 * where the form is one more click away. Filing goes from one click to two.
 * If that costs a guard time at the gate, the fix is to point the SIDEBAR item
 * at `?file=1` rather than to bring this button back — ReportPage already
 * reads that param. */

/**
 * Signing out while on duty is the one exit this console cannot allow quietly.
 *
 * `guard_shifts` is what attributes every acknowledgement, dispatch and
 * resolution to a person. A guard who signs out mid-shift leaves that row open
 * with no `timeOut`, so the duty log shows a shift that never ended and the
 * recorded hours are wrong for as long as nobody notices. It is a data defect,
 * not a UX one, which is why it is intercepted rather than warned about.
 *
 * The gate does NOT clock them out for them. Clock-out writes an end time, a
 * duration and a GPS fix, and on some configurations a handover note — it is a
 * record the guard is making, not a side effect of closing a tab. So the gate
 * sends them to the control that does it properly and gets out of the way.
 */
function LogoutGate({ open, onCancel }) {
  return (
    <ConfirmDialog
      open={open}
      title="Clock out first"
      message="You must clock out to finalize your active duty session before logging out. Use Clock out on the duty panel — it records your end time, total hours and location."
      confirmLabel="Got it"
      cancelLabel="Stay signed in"
      tone="warning"
      onConfirm={onCancel}
      onCancel={onCancel}
    />
  )
}

export default function AppShell({ children, dutyLock = true, ...props }) {
  const { role } = useAuth()
  const telemetry = useGuardTelemetryState()
  const { onDuty } = useDutyStatus()
  const [logoutGate, setLogoutGate] = useState(false)

  return (
    <DashboardLayout
      roleLabel={ROLE_LABELS[role] ?? 'On duty'}
      navGroups={NAV_GROUPS}
      collapseKey={portalKey('sidebar-collapsed')}
      logoutMessage="Are you sure you want to log out of the Security Console?"
      logoutBlocked={onDuty}
      onBlockedLogout={() => setLogoutGate(true)}
      alertPath={ROUTES.history}
      historyPath={ROUTES.history}
      {...props}
    >
      <LogoutGate open={logoutGate} onCancel={() => setLogoutGate(false)} />

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
