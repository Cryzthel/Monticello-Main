import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url))
// apps/security-portal -> apps -> the monorepo root.
const MONOREPO_ROOT = path.resolve(APP_ROOT, '../..')

/**
 * Guardhouse Portal — dev/build config.
 *
 * ── THE PORT IS THE SECURITY BOUNDARY ────────────────────────────────────────
 * An origin is scheme + host + PORT, so http://localhost:3001 and the other
 * console's port are different origins. Different origin means a separate
 * localStorage, sessionStorage, IndexedDB and cookie jar, enforced by the
 * browser rather than by our code. Two consoles running side by side cannot
 * read or evict each other's session tokens, and no bug in this repository can
 * make them able to.
 *
 * strictPort fails loudly instead of sliding to the next free port. A security
 * console that quietly landed on 3001 because the admin one was already
 * there would be indistinguishable from the admin console at exactly the
 * moment you are testing that the two are separate — and worse, it would then
 * SHARE that origin, silently undoing the isolation above.
 */
export default defineConfig({
  root: APP_ROOT,

  // Both apps read one .env.local at the monorepo root. The Firebase project
  // and Mapbox token are identical for the two consoles, and keeping a single
  // copy means credentials cannot be rotated in one app and forgotten in the
  // other. Portal identity deliberately does NOT come from there — see
  // `define` below.
  envDir: MONOREPO_ROOT,

  plugins: [react(), tailwindcss()],

  define: {
    /**
     * Portal identity, frozen into the bundle at build time.
     *
     * This is the ONE place either app declares which portal it is, and it is
     * read by packages/shared/src/config/portal.js, which throws if it is
     * missing. It is a `define` rather than an env var on purpose: env vars
     * are ambient and overridable — a stray VITE_PORTAL in a shell, a CI
     * secret, a copied .env — and portal identity that something outside the
     * repository can flip is not an identity. A literal substituted by this
     * config cannot be changed without editing this config.
     */
    __PORTAL__: JSON.stringify('security'),
  },

  resolve: {
    alias: {
      '@': path.resolve(APP_ROOT, 'src'),
      '@shared': path.resolve(MONOREPO_ROOT, 'packages/shared/src'),
      // The subdivision boundary GeoJSON lives at the REPO root, outside this
      // monorepo, because the Flutter app reads the very same file as a bundled
      // asset. One file, two platforms — which is the only way the boundary
      // drawn on the mobile map and the boundary drawn on the two dashboards
      // can be guaranteed identical rather than merely similar.
      '@geo': path.resolve(MONOREPO_ROOT, '../assets/geo'),
    },
  },

  server: {
    port: 3001,
    // Bind the IPv4 loopback explicitly. Vite's default host is `localhost`,
    // which Node resolves to ::1 alone on this machine — so the port listens
    // on IPv6 only, and anything that reaches it over IPv4 (a dev tunnel, a
    // proxy, curl 127.0.0.1) is refused and reports a 502 it cannot explain.
    // Still loopback, so this does not put the console on the LAN.
    host: '127.0.0.1',
    strictPort: true,
    // Optional custom hostname from the OS hosts file — see README. It must be
    // listed here because Vite rejects requests whose Host header it does not
    // recognise (DNS-rebinding protection), so a hosts-file entry on its own
    // yields a blank page and a "host not allowed" error rather than a clue.
    allowedHosts: ['security.local', '.devtunnels.ms'],
    fs: {
      // Required for the @shared and @geo aliases: the dev server refuses to
      // serve files outside its root unless the path is explicitly allowed,
      // and both of those resolve above apps/security-portal.
      allow: [MONOREPO_ROOT, path.resolve(MONOREPO_ROOT, '../assets')],
    },
  },

  preview: {
    port: 4301,
    strictPort: true,
    allowedHosts: ['security.local', '.devtunnels.ms'],
  },

  build: {
    outDir: path.resolve(APP_ROOT, 'dist'),
    emptyOutDir: true,
  },
})
