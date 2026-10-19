import { Routes, Route, Navigate } from 'react-router-dom'
import RequireAuth from '@shared/auth/RequireAuth'
import FirstPasswordGate from '@shared/auth/FirstPasswordGate'
import { AppShellLayout } from '@/layouts/AppShell'
import { useAuth } from '@shared/auth/AuthContext'
import { ROUTES } from '@/config/portal'

import LoginPage, { LoginHero } from '@/pages/LoginPage'
import ResetPasswordPage from '@shared/auth/ResetPasswordPage'
import DashboardPage from '@/pages/DashboardPage'
import TicketsPage from '@/pages/TicketsPage'
import PanicAlertsPage from '@/pages/PanicAlertsPage'
import ReportPage from '@/pages/ReportPage'
import HistoryPage from '@/pages/HistoryPage'
import PerformancePage from '@/pages/PerformancePage'
import SettingsPage from '@/pages/SettingsPage'
import SessionLoader from '@shared/components/LeafLoader'
import DownloadAppPage from '@shared/components/DownloadAppPage'

/**
 * Every route the Guardhouse Portal has.
 *
 * There is no portal picker at `/` and no `/admin/*` group. This bundle
 * contains the guardhouse console and nothing else — the admin portal is a
 * separate application on a separate origin.
 */

/**
 * Where an unmatched path goes. See the equivalent note in the admin app: a
 * signed-in guard who mistypes a URL gets their dashboard, not a login form,
 * because a login form reads as "you were signed out" to the person looking
 * at it — and during a shift that is an alarming thing to be told wrongly.
 */
function UnmatchedRoute() {
  const { isAuthenticated, initializing } = useAuth()

  // Not `null`. A blank screen while the session resolves is
  // indistinguishable from a page that failed to load, and this branch
  // is reached by anyone following a stale or mistyped link.
  if (initializing) return <SessionLoader />

  return <Navigate to={isAuthenticated ? ROUTES.home : ROUTES.login} replace />
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={ROUTES.home} replace />} />
      <Route path={ROUTES.login} element={<LoginPage />} />
      {/* Public: the Android app download, for residents and staff. */}
      <Route path="/download" element={<DownloadAppPage />} />
      {/* Public, and deliberately outside RequireAuth: the person opening it
          cannot sign in, which is why they were sent the link. */}
      <Route
        path={ROUTES.resetPassword}
        element={<ResetPasswordPage loginPath={ROUTES.login} illustration={<LoginHero />} />}
      />

      <Route element={<RequireAuth loginPath={ROUTES.login} />}>
        {/* A guard on a TEMPORARY password sets their own before any page of
            the console opens — see FirstPasswordGate. */}
        <Route element={<FirstPasswordGate illustration={<LoginHero />} />}>
        {/* The shell mounts ONCE for every page below — see AppShellLayout. */}
        <Route element={<AppShellLayout />}>
        <Route path={ROUTES.dashboard} element={<DashboardPage />} />
        <Route path={ROUTES.tickets} element={<TicketsPage />} />
        <Route path={ROUTES.sos} element={<PanicAlertsPage />} />
        <Route path={ROUTES.report} element={<ReportPage />} />
        <Route path={ROUTES.history} element={<HistoryPage />} />
        <Route path={ROUTES.performance} element={<PerformancePage />} />
        {/* The hub, and one route per category. `:category` rather than a
            route each, so adding a category is a line in CATEGORIES and not
            a line here as well — an unknown slug is redirected by the page. */}
        <Route path={ROUTES.settings} element={<SettingsPage />} />
        <Route path={`${ROUTES.settings}/:category`} element={<SettingsPage />} />
        </Route>
        </Route>
      </Route>

      <Route path="*" element={<UnmatchedRoute />} />
    </Routes>
  )
}
