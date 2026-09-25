import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '@shared/auth/AuthContext'
import ErrorBoundary from '@shared/components/ErrorBoundary'
import ToastProvider from '@shared/components/ToastProvider'
import SystemSettingsSync from '@shared/components/SystemSettingsSync'
import PanicAlertProvider from '@/components/PanicAlertProvider'
import DispatchWatchdog from '@/components/DispatchWatchdog'
import { GuardTelemetryProvider } from '@/components/GuardTelemetryProvider'
import { ALLOWED_ROLES, UNAUTHORIZED_MESSAGE } from '@/config/portal'
import AppRoutes from '@/app/AppRoutes'

/**
 * Guardhouse Portal application root.
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
          {/* The organisation's SOS siren switch (Admin › Settings), kept live
              so a change reaches this console without a reload. */}
          <SystemSettingsSync />
          {/* Inside the router so a toast's quick action can navigate, and
              inside auth so the alert listener only ever attaches for a
              signed-in staff session. */}
          <ToastProvider>
            {/* The SOS channel wraps the routes rather than sitting inside
                any one of them, which is what makes it survive navigation:
                the subscription and the siren are mounted by the provider,
                so switching tabs never unmounts the thing listening for an
                emergency.

                It is inside AuthProvider so it can READ the session, not
                because that gates it — AuthProvider renders its children
                signed in or not. The provider gates its own query on
                `isAuthenticated`; see the note there. */}
            <PanicAlertProvider>
              {/* Dispatch alarms (new assignment, the 90-second
                  acknowledgement watchdog, escalations) and this officer's
                  unit telemetry. Above the routes for the same reason as the
                  SOS channel: they must run on every page. */}
              <GuardTelemetryProvider>
                <DispatchWatchdog />
                <AppRoutes />
              </GuardTelemetryProvider>
            </PanicAlertProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
