import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '@shared/auth/AuthContext'
import TimeZoneBoundary from '@shared/components/TimeZoneBoundary'
import ErrorBoundary from '@shared/components/ErrorBoundary'
import ToastProvider from '@shared/components/ToastProvider'
import SystemSettingsSync from '@shared/components/SystemSettingsSync'
import IdleSignOut from '@shared/components/IdleSignOut'
import { ALLOWED_ROLES, UNAUTHORIZED_MESSAGE } from '@/config/portal'
import AppRoutes from '@/app/AppRoutes'

/**
 * Admin Portal application root.
 *
 * AuthProvider is handed THIS app's allowlist and nothing else. That is the
 * session-isolation boundary: a credential resolving to any other role is
 * signed back out before this tree ever renders as authenticated, so no route
 * added here later can accidentally honour a session belonging to the other
 * console.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider allowedRoles={ALLOWED_ROLES} unauthorizedMessage={UNAUTHORIZED_MESSAGE}>
          {/* The notification preferences Settings edits, kept live. */}
          <SystemSettingsSync />
          {/* Settings › Security ‣ "Sign out when idle". Needs `logout` from
              AuthProvider and the policy from the sync above, and must outlive
              any one route. Renders nothing while the policy is off. Restored
              2026-10-18 — it had been unmounted, leaving the setting a no-op. */}
          <IdleSignOut />
          {/* Inside the router so a toast's quick action can navigate, and
              inside auth so the alert listener only ever attaches for a
              signed-in staff session. */}
          <ToastProvider>
            <TimeZoneBoundary>
              <AppRoutes />
            </TimeZoneBoundary>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
