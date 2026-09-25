/**
 * Guardhouse (Security) Portal — access policy and route table.
 *
 * The admin console has its own copy of this shape, and the two are
 * deliberately NOT a common module: "which roles may enter" and "where do they
 * land" are policies belonging to the portal that enforces them. One shared
 * table is a single edit that can widen access to an app the editor was not
 * thinking about.
 *
 * Nothing here names the admin portal — no origin, no login path, no role list.
 * The guardhouse bundle cannot link to it, redirect to it, or reason about it.
 */

/**
 * Roles this portal will hold a session for.
 *
 * Consumed by AuthProvider, which signs out anything not on this list BEFORE
 * the app reports itself authenticated — an authentication-time allowlist, not
 * a display filter.
 *
 * Mirrors firestore.rules#isSecurityStaff and
 * functions/index.js#SECURITY_STAFF_ROLES. Those are the enforcement; this list
 * only decides whether the console will keep a session.
 */
export const ALLOWED_ROLES = ['super_admin', 'security_head', 'security_officer']

/** Shown when a credential resolves to a role that is not on the list above. */
export const UNAUTHORIZED_MESSAGE = 'This account is not authorized for the Guardhouse Portal.'

/**
 * Routes, without a `/security` prefix — this app IS the guardhouse portal,
 * served from its own port, so the prefix said it twice. See the equivalent
 * note in the admin app for the full reasoning.
 */
export const ROUTES = {
  login: '/login',
  home: '/dashboard',
  dashboard: '/dashboard',
  tickets: '/tickets',
  sos: '/sos',
  report: '/report',
  history: '/history',
  performance: '/performance',
  settings: '/settings',
}
