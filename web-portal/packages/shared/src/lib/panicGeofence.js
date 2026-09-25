import { containsPoint } from '@shared/lib/subdivisionBoundary'

/**
 * Whether an SOS was raised inside the registered subdivision boundary.
 *
 * ── THREE STATES, NOT TWO ───────────────────────────────────────────────────
 * `containsPoint` answers a boolean, and it returns `false` for a point with
 * no usable coordinates — which is correct for a geometry helper and wrong for
 * this question. An alert with no GPS fix is not outside the subdivision; it
 * is an alert we cannot place. Collapsing those two into "outside" would put a
 * red out-of-bounds flag on every SOS raised indoors, in a basement, or from a
 * phone with location off, and the flag would stop meaning anything within a
 * week of being switched on.
 *
 * So: `inside`, `outside`, `unknown`, and only `outside` is a claim.
 *
 * ── WHY THIS IS NOT IN panicStatus.js ───────────────────────────────────────
 * That file's header states it is pure and dependency-free so it can be
 * exercised directly — it is the code that decides whether a live emergency is
 * presented as closed. This needs the boundary polygon, so it lives beside it
 * rather than adding a data import to the module whose whole value is not
 * having one.
 */
export const GEOFENCE = Object.freeze({
  inside: 'inside',
  outside: 'outside',
  unknown: 'unknown',
})

/**
 * @param {{ lat?: number, lng?: number }} alert
 * @param {Array<[number, number]>} [ring] Override for testing.
 * @returns {'inside' | 'outside' | 'unknown'}
 */
export function geofenceState(alert, ring) {
  const lat = alert?.lat
  const lng = alert?.lng
  if (typeof lat !== 'number' || typeof lng !== 'number') return GEOFENCE.unknown
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return GEOFENCE.unknown
  // 0,0 is the Atlantic. It is what a zeroed struct looks like, not a place a
  // resident pressed a button, and it would otherwise read as a confident
  // "outside" 6,000km away.
  if (lat === 0 && lng === 0) return GEOFENCE.unknown

  return containsPoint({ lat, lng }, ring) ? GEOFENCE.inside : GEOFENCE.outside
}

/** True only when the alert can be placed AND falls outside the boundary. */
export function isOutsideBoundary(alert, ring) {
  return geofenceState(alert, ring) === GEOFENCE.outside
}

/**
 * How an operator should read the state, or `null` when there is nothing worth
 * saying. `inside` returns null on purpose: the overwhelming majority of
 * alerts are inside, and a badge that appears on all of them is chrome.
 */
export function describeGeofence(state) {
  if (state === GEOFENCE.outside) {
    return {
      tone: 'warning',
      label: 'Outside subdivision',
      detail: 'This SOS was raised beyond the registered boundary. Confirm the location before dispatching.',
    }
  }
  if (state === GEOFENCE.unknown) {
    return {
      tone: 'neutral',
      label: 'No location',
      detail: 'The alert arrived without a usable GPS fix, so it cannot be placed on the map.',
    }
  }
  return null
}
