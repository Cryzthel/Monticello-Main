/**
 * The sponsor feed behind the sidebar's "Earn while you wait" slot.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────
 * Kickbacks.ai sells one sponsored status line inside AI coding agents' wait
 * states and pays the developer whose screen showed it. As of September 2026
 * it ships only a VS Code extension and a CLI: there is no web SDK, embed
 * script or publisher API a browser app can call. So nothing in this file
 * talks to Kickbacks, and nothing pretends to.
 *
 * What it defines instead is OUR contract — a small JSON feed that a backend
 * we run (a Cloud Function, say) can serve once a real sponsor arrangement
 * exists, with Kickbacks or anyone else. The portal only ever reads that feed:
 *
 *   GET  {VITE_SPONSOR_FEED_URL}?context=<wait label>
 *        200 → { id, advertiser, text, href }        204 → nothing to show
 *   POST {VITE_SPONSOR_FEED_URL}/impressions   { id, context, dwellMs }
 *
 * No user, role, email or incident data leaves the browser — only which kind
 * of wait is on screen, which is all a placement needs. Requests go out
 * without credentials.
 *
 * OFF BY DEFAULT. With VITE_SPONSOR_FEED_URL unset, `getSponsorFeed()` returns
 * null and the slot renders nothing: no request, no empty card.
 */

/**
 * Continuous on-screen time before an impression is reported — ten seconds,
 * the dwell Kickbacks itself counts an impression at.
 */
export const DWELL_MS = 10_000

export function getSponsorFeed() {
  const url = import.meta.env.VITE_SPONSOR_FEED_URL?.trim()
  return url ? createHttpFeed(url.replace(/\/+$/, '')) : null
}

/**
 * A placement the slot is willing to render. Anything malformed, or linking
 * anywhere but https, is dropped rather than shown: this card sits inside a
 * staff console, and a link it cannot vouch for does not belong there.
 */
export function isPlacement(value) {
  return Boolean(
    value &&
      typeof value.id === 'string' &&
      typeof value.text === 'string' &&
      typeof value.advertiser === 'string' &&
      typeof value.href === 'string' &&
      value.href.startsWith('https://'),
  )
}

function createHttpFeed(base) {
  return {
    async fetchPlacement({ context, signal }) {
      const response = await fetch(`${base}?context=${encodeURIComponent(context)}`, {
        signal,
        credentials: 'omit',
      })
      if (response.status === 204 || !response.ok) return null
      const body = await response.json()
      return isPlacement(body) ? body : null
    },

    reportImpression({ id, context, dwellMs }) {
      // `keepalive` so an impression earned in the last second before the
      // operator navigates away still lands.
      fetch(`${base}/impressions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, context, dwellMs }),
        credentials: 'omit',
        keepalive: true,
      }).catch(() => {})
    },
  }
}
