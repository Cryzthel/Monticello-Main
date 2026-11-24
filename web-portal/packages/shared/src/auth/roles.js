/**
 * Staff role vocabulary, shared by both portals.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────
 * This file used to also export ADMIN_PORTAL_ROLES, SECURITY_PORTAL_ROLES,
 * `canAccessPortal(role, portal)` and `defaultPortalForRole(role)` — the full
 * cross-portal access matrix, shipped in both bundles.
 *
 * That matrix is now split: each app declares ONLY its own allowlist, in its
 * own `src/config/portal.js`. The admin bundle therefore contains no statement
 * about which roles the guardhouse accepts, and vice versa.
 *
 * The point is not that role names are secret — they are not. It is that
 * "which roles may enter portal X" is a policy belonging to portal X, and one
 * shared copy is a single place where a careless edit silently widens access to
 * an app the editor was not thinking about. Two separate allowlists cannot be
 * widened by accident together.
 *
 * `defaultPortalForRole` is gone outright: it existed to bounce a
 * wrong-portal operator to "their" portal, which is a cross-portal redirect,
 * which is exactly what the decoupling removes.
 *
 * Mirrors functions/index.js (requireStaff, SECURITY_STAFF_ROLES) and
 * firestore.rules (isAdminStaff/isSecurityStaff) — keep all three in sync.
 * This is the client-side copy, and it is a convenience, never the enforcement:
 * the server rules are the enforcement.
 */

/** Firestore collection holding one document per staff account, keyed by uid. */
export const STAFF_COLLECTION = 'staff_accounts'

/** The only `status` value that may hold a session in any portal. */
export const APPROVED_STATUS = 'approved'

/** Every role the system knows about, for display and validation. */
export const ROLE_LABELS = {
  super_admin: 'Super admin',
  hoa_admin: 'HOA admin',
  security_head: 'Security head',
  security_officer: 'Security officer',
}
