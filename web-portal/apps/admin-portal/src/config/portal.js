/**
 * Admin Portal — access policy and route table.
 *
 * This file is the admin console's half of a boundary that used to be one
 * shared matrix. The guardhouse app has its own copy of this shape, and the two
 * are deliberately NOT a common module: "which roles may enter" and "where do
 * they land" are policies that belong to the portal enforcing them. One shared
 * table is a single edit that can widen access to an app the editor was not
 * thinking about.
 *
 * Nothing here names the guardhouse portal — no origin, no login path, no role
 * list. The admin bundle cannot link to it, redirect to it, or reason about it,
 * which is the property that makes the two apps independent rather than merely
 * separately served.
 */

/**
 * Roles this portal will hold a session for.
 *
 * Consumed by AuthProvider, which signs out anything not on this list BEFORE
 * the app reports itself authenticated — so this is an authentication-time
 * allowlist, not a display filter.
 *
 * Mirrors firestore.rules#isAdminStaff and functions/index.js#requireStaff.
 * Those are the enforcement; this list only decides whether the console will
 * keep a session, and a browser is never the authority on that.
 */
export const ALLOWED_ROLES = ['super_admin', 'hoa_admin']

/** Shown when a credential resolves to a role that is not on the list above. */
export const UNAUTHORIZED_MESSAGE = 'This account is not authorized for the Admin Portal.'

/**
 * Routes, without a `/admin` prefix.
 *
 * The prefix was how one bundle told two portals apart when they shared an
 * origin. They no longer share one — this app IS the admin portal, served from
 * its own port — so `/dashboard` said "admin" twice and invited the
 * assumption that a `/security/...` path might also mean something here. It
 * does not: those routes are not registered in this app at all.
 */
export const ROUTES = {
  login: '/login',
  /**
   * Where Firebase's password-reset email lands. PUBLIC, like `login` — the
   * whole point is that it is reachable by someone who cannot sign in.
   *
   * Reaching it needs one setting in the Firebase console: Authentication →
   * Templates → Password reset → Customize action URL → this path on this
   * portal's domain. Without it Firebase's own hosted page handles the code and
   * this route is simply never visited; nothing breaks, it just does not look
   * like the product. See ResetPasswordPage.
   */
  resetPassword: '/reset-password',
  home: '/dashboard',
  dashboard: '/dashboard',
  heatmap: '/heatmap',
  tickets: '/tickets',
  sos: '/sos',
  reports: '/reports',
  residents: '/residents',
  securityAccounts: '/security-accounts',
  metrics: '/metrics',
  announcements: '/announcements',
  history: '/history',
  settings: '/settings',
}
