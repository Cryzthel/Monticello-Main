import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@shared/auth/AuthContext'
import SessionLoader from '@shared/components/LeafLoader'

/**
 * The route guard, shared as a MECHANISM only.
 *
 * The policy — which roles this portal accepts — lives in each app's
 * src/config/portal.js and is enforced one level lower, in AuthProvider, which
 * refuses to hold a session for a role off the allowlist at all. By the time a
 * component asks `isAuthenticated`, "authenticated" already means
 * "authenticated FOR THIS PORTAL"; there is no second, weaker sense of the word
 * left in the app.
 *
 * So this guard has exactly one question to answer — is there a session? — and
 * that is the whole of it. It no longer inspects roles, and it no longer has a
 * cross-portal branch: the old version redirected a wrong-portal operator to
 * the other console's origin, which required every bundle to know the other's
 * URL and login path. Both of those are gone with the shared landing page.
 *
 * `state.from` preserves the deep link across the sign-in round trip, so an
 * operator who follows a link to a specific ticket lands on that ticket rather
 * than the dashboard.
 */
export default function RequireAuth({ loginPath }) {
  const { isAuthenticated, initializing } = useAuth()
  const location = useLocation()

  // Nothing is decided until the session resolves. Redirecting inside this
  // window is how a hard refresh on a deep link bounces to login and back.
  if (initializing) {
    // The resident app waits on a leaf; so does this. SessionLoader keeps the
    // words as well as the mark, so the state still reads with motion off.
    return <SessionLoader />
  }

  if (!isAuthenticated) {
    return <Navigate to={loginPath} state={{ from: location }} replace />
  }

  return <Outlet />
}
