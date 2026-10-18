import {
  Map as MapIcon,
  ActivitySquare,
  History,
  FilePlus2,
  Ticket,
  Siren,
  Settings,
  Clock,
} from '@shared/icons'
import { Outlet } from 'react-router-dom'
import DashboardLayout from '@shared/layouts/DashboardLayout'
import {
  PageChromeProvider,
  ReportPageChrome,
  usePageChrome,
  usePersistentChrome,
} from '@shared/layouts/PageChrome'
import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'
import { STAFF_COLLECTION } from '@shared/auth/roles'
import { useAuth } from '@shared/auth/AuthContext'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { useDutyStatus } from '@/hooks/useDutyStatus'
import LocationAccessNotice from '@/components/LocationAccessNotice'
import LocationAccessToast from '@/components/LocationAccessToast'
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
      // "on the duty panel" named a panel that was removed on 2026-10-17;
      // Clock out lives in the page header now.
      message="Clock out before logging out, so your shift records its end time, total hours and location. Use Clock out at the top of the page."
      confirmLabel="Got it"
      tone="warning"
      icon={Clock}
      centered
      // One choice, so one button: both used to do the same thing.
      hideCancel
      onConfirm={onCancel}
      onCancel={onCancel}
    />
  )
}

/**
 * The signed-in officer's full name, for the sidebar's profile block.
 *
 * Read live from their own staff record (which every officer may read), not
 * from the Auth profile: an admin renaming an officer updates the record at
 * once, while `user.displayName` in this browser stays as it was at sign-in.
 * The Auth name is the fallback while the record loads.
 */
function useOfficerName() {
  const { user } = useAuth()
  const [name, setName] = useState({ uid: null, value: '' })

  useEffect(() => {
    if (!user?.uid) return undefined
    return onSnapshot(
      doc(db, STAFF_COLLECTION, user.uid),
      (snap) => setName({ uid: user.uid, value: String(snap.data()?.name ?? '').trim() }),
      () => {},
    )
  }, [user?.uid])

  const live = name.uid === user?.uid ? name.value : ''
  return live || user?.displayName || undefined
}

/**
 * The shell's frame: DashboardLayout plus the guardhouse's own furniture —
 * the logout gate, the location notices and the duty lock — around `children`.
 * Shared by the persistent layout route and the standalone fallback.
 */
function ShellFrame({ children, dutyLock = true, ...props }) {
  const officerName = useOfficerName()
  const telemetry = useGuardTelemetryState()
  const { onDuty } = useDutyStatus()
  const [logoutGate, setLogoutGate] = useState(false)

  return (
    <DashboardLayout
      profileName={officerName}
      navGroups={NAV_GROUPS}
      collapseKey={portalKey('sidebar-collapsed')}
      logoutMessage="Are you sure you want to log out of the Security Console?"
      logoutBlocked={onDuty}
      onBlockedLogout={() => setLogoutGate(true)}
      alertPath={ROUTES.history}
      // Reports and SOS both open on the dispatch map, which focuses them from
      // ?incident= / ?panic=. The guardhouse has no announcements page, so an
      // announcement just marks itself read.
      notificationRoutes={{
        incident: `${ROUTES.dashboard}?incident=`,
        panic: `${ROUTES.dashboard}?panic=`,
      }}
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
        {/* Renders nothing; raises the same fact as the banner into the toast
            stack, which is portalled above the map. The banner lives at the
            top of a full-height console and an officer driving to a call is
            looking at the bottom of their phone — see LocationAccessToast. */}
        <LocationAccessToast {...telemetry} />
        <div className="relative min-h-0 flex-1">
          {children}
          {dutyLock ? <DutyLockOverlay /> : null}
        </div>
      </div>
    </DashboardLayout>
  )
}

/**
 * The persistent shell — a layout ROUTE wrapping every signed-in page, so the
 * sidebar, header, duty state and their listeners mount ONCE and survive
 * navigation (see shared/layouts/PageChrome.jsx).
 */
export function AppShellLayout() {
  const { page, value, slotProps } = usePersistentChrome()
  return (
    <PageChromeProvider value={value}>
      <ShellFrame
        title={page.title}
        subtitle={page.subtitle}
        scroll={page.scroll}
        bleed={page.bleed}
        inlineTitle={page.inlineTitle}
        dutyLock={page.dutyLock}
        {...slotProps}
      >
        <Outlet />
      </ShellFrame>
    </PageChromeProvider>
  )
}

/**
 * What a page renders. Inside AppShellLayout it only reports its chrome
 * (including `dutyLock`); on its own it builds the full shell as before.
 */
export default function AppShell(props) {
  const chrome = usePageChrome()
  if (chrome) return <ReportPageChrome chrome={chrome} {...props} />
  return <ShellFrame {...props} />
}
