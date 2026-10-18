import { Routes, Route, Navigate } from 'react-router-dom'
import RequireAuth from '@shared/auth/RequireAuth'
import { AppShellLayout } from '@/layouts/AppShell'
import { useAuth } from '@shared/auth/AuthContext'
import { ROUTES } from '@/config/portal'

import LoginPage, { LoginHero } from '@/pages/LoginPage'
import ResetPasswordPage from '@shared/auth/ResetPasswordPage'
import DashboardPage from '@/pages/DashboardPage'
import HeatmapPage from '@/pages/HeatmapPage'
import TicketsPage from '@/pages/TicketsPage'
import PanicAlertsPage from '@/pages/PanicAlertsPage'
import SecurityReportsPage from '@/pages/SecurityReportsPage'
import ResidentsPage from '@/pages/ResidentsPage'
import SecurityAccountsPage from '@/pages/SecurityAccountsPage'
import MetricsPage from '@/pages/MetricsPage'
import AnnouncementsPage from '@/pages/AnnouncementsPage'
import HistoryPage from '@/pages/HistoryPage'
import SettingsPage from '@/pages/SettingsPage'
import SessionLoader from '@shared/components/LeafLoader'

/**
 * Every route the Admin Portal has.
 *
 * There is no portal picker at `/` any more and no `/security/*` group. This
 * bundle contains the admin console and nothing else — the guardhouse is a
 * separate application on a separate origin, and the only way to reach it is
 * to go there directly.
 */

/**
 * Where an unmatched path goes.
 *
 * ── WHY THIS IS NOT JUST `<Navigate to={ROUTES.login}>` ──────────────────────
 * It was, and that is the bug behind "clicking Panic Alerts logs me out".
 *
 * Sending every unmatched URL to the login path meant any admin URL that
 * failed to match a registered route — a new page whose route had not been
 * added yet, a typo, a stale bookmark — took a signed-in administrator to the
 * sign-in screen. Nothing had signed them out; their session was untouched.
 * But a console that answers a nav click with a login form has, from the
 * operator's side, ended their session, and the only available reading is that
 * the app threw them out.
 *
 * That failure mode is worse than the missing route it reports, because it
 * hides it: the person reports a logout bug and nobody looks at routing.
 *
 * An authenticated operator now lands on the dashboard — a navigation miss,
 * which is what it actually is. Only a genuinely unauthenticated visitor is
 * sent to a login screen.
 */
function UnmatchedRoute() {
  const { isAuthenticated, initializing } = useAuth()

  // Nothing is decided until the session resolves. Redirecting during this
  // window is how a hard refresh on a deep link bounces to login and back.
  // Not `null`. A blank screen while the session resolves is
  // indistinguishable from a page that failed to load, and this branch
  // is reached by anyone following a stale or mistyped link.
  if (initializing) return <SessionLoader />

  return <Navigate to={isAuthenticated ? ROUTES.home : ROUTES.login} replace />
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* `/` is the console's front door now that the shared gateway is gone.
          Signed in, it is the dashboard; signed out, RequireAuth sends it to
          login and remembers where it came from. */}
      <Route path="/" element={<Navigate to={ROUTES.home} replace />} />
      <Route path={ROUTES.login} element={<LoginPage />} />
      {/* Public, and deliberately outside RequireAuth: the person opening it
          cannot sign in, which is why they were sent the link. */}
      <Route
        path={ROUTES.resetPassword}
        element={<ResetPasswordPage loginPath={ROUTES.login} illustration={<LoginHero />} />}
      />

      <Route element={<RequireAuth loginPath={ROUTES.login} />}>
        {/* The shell mounts ONCE for every page below, so navigating swaps
            only the page — see AppShellLayout. */}
        <Route element={<AppShellLayout />}>
        <Route path={ROUTES.dashboard} element={<DashboardPage />} />
        <Route path={ROUTES.heatmap} element={<HeatmapPage />} />
        <Route path={ROUTES.tickets} element={<TicketsPage />} />
        <Route path={ROUTES.sos} element={<PanicAlertsPage />} />
        <Route path={ROUTES.reports} element={<SecurityReportsPage />} />
        <Route path={ROUTES.residents} element={<ResidentsPage />} />
        <Route path={ROUTES.securityAccounts} element={<SecurityAccountsPage />} />
        <Route path={ROUTES.metrics} element={<MetricsPage />} />
        <Route path={ROUTES.announcements} element={<AnnouncementsPage />} />
        <Route path={ROUTES.history} element={<HistoryPage />} />
        {/* A SPLAT, not two routes. The hub and every category are one
            matched element, so React Router re-renders rather than
            remounting as you move between them — which is what keeps the
            settings draft alive. Two routes would unmount the page on the
            way to the next category and discard an unsaved edit. */}
        <Route path={`${ROUTES.settings}/*`} element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<UnmatchedRoute />} />
    </Routes>
  )
}
