import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '@shared/auth/AuthContext'
import ErrorBoundary from '@shared/components/ErrorBoundary'
import ToastProvider from '@shared/components/ToastProvider'
import SystemSettingsSync from '@shared/components/SystemSettingsSync'
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
          {/* Inside the router so a toast's quick action can navigate, and
              inside auth so the alert listener only ever attaches for a
              signed-in staff session. */}
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
