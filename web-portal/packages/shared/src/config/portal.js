/**
 * Portal identity — the single source of truth for "which portal is this
 * bundle?".
 *
 * ── WHY THIS IS A BUILD-TIME CONSTANT ────────────────────────────────────────
 * It used to be resolved at runtime: a `VITE_PORTAL` pin if one was set,
 * otherwise the first path segment of `window.location.pathname`, otherwise
 * `null` for the shared landing page. All three of those are gone.
 *
 * Runtime resolution meant portal identity was a property of the URL, and the
 * URL is attacker-controllable. A document served by the admin origin that
 * happened to sit on a `/security/...` path resolved as the SECURITY portal,
 * which in turn chose the Firebase app name that owns the auth session (see
 * lib/firebase.js). Identity that can be changed by editing the address bar is
 * not an isolation boundary.
 *
 * `__PORTAL__` is injected by each app's own vite.config.js via `define`, so
 * it is substituted into the bundle as a literal at build time. It cannot be
 * overridden by an env var, a query string, or a path — the admin bundle is
 * the admin portal, permanently, and there is no code path that says otherwise.
 *
 * The throw below is deliberate and load-bearing: an app that fails to inject
 * the constant fails at import, loudly, instead of silently falling back to a
 * shared default and quietly merging the two portals' sessions again.
 */

/* global __PORTAL__ */

const PORTALS = ['admin', 'security']

export const PORTAL = typeof __PORTAL__ === 'string' ? __PORTAL__ : null

if (!PORTALS.includes(PORTAL)) {
  throw new Error(
    `[portal] __PORTAL__ must be one of ${PORTALS.join(' | ')}, received ${JSON.stringify(PORTAL)}. ` +
      'It is injected by the app\'s vite.config.js `define` block — check that the app was built ' +
      'from apps/admin-portal or apps/security-portal and not from the repository root.',
  )
}

/**
 * Namespaced browser-storage key: `mv:admin:notifications-last-seen`.
 *
 * Separate ports already give each portal its own origin, and therefore its own
 * localStorage, so in the current deployment this prefix is belt-and-braces.
 * It stays because the cost is one string concat and the failure it prevents —
 * two consoles silently overwriting each other's read-state after someone puts
 * both behind one hostname on different paths — is invisible until it is a
 * support ticket.
 *
 * NOT for device-level preferences that carry no session identity: the theme
 * deliberately stays on a shared, un-namespaced key. On separate origins each
 * console remembers the choice independently anyway; the un-namespaced key is
 * what keeps them agreeing if the two are ever co-hosted. See
 * theme/ThemeProvider.jsx.
 */
export function portalKey(name) {
  return `mv:${PORTAL}:${name}`
}
