import { RouteError } from '@/lib/directions'

/**
 * Positions for the dispatch console: this device's GPS fix, and the
 * configured guardhouse.
 *
 * ── WHERE ROUTES START NOW ────────────────────────────────────────────────
 * A response route used to start wherever the device that pressed Acknowledge
 * & Respond happened to be, read once. It now starts at the assigned unit's
 * LIVE position from guard telemetry (see useDispatchRoute), which follows the
 * officer as they move. This module is left with two jobs:
 *
 *   currentFix         one fix from this device, for the arrival check and
 *                      the audit log (lib/forensics.js)
 *   GUARDHOUSE_LNGLAT  where a unit with no position is assumed to be leaving
 *                      from, flagged as such on the route badge
 */

/**
 * Metres. A phone outdoors reports 5-20 m and indoors up to ~65 m; Wi-Fi and
 * IP positioning report 100 m and far worse. 100 m keeps every real GPS fix
 * and rejects the inferred ones — at subdivision scale, 100 m is already a
 * block away.
 */
export const GPS_ACCURACY_LIMIT_M = 100

/**
 * `"lng,lat"` → `[lng, lat]`, or null.
 *
 * Longitude FIRST, matching GeoJSON and every other coordinate in this
 * codebase. That is the opposite of what a map app's "copy coordinates" gives
 * you, so a swapped pair for this estate (latitude ~10.76, longitude ~122.5)
 * fails the latitude range check and is reported rather than silently plotted
 * in the ocean.
 */
export function parseLngLat(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const parts = raw.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null
  const [lng, lat] = parts
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
  return [lng, lat]
}

/**
 * The guardhouse's position, from `VITE_GUARDHOUSE_LNGLAT` — or null.
 *
 * Configuration, not a constant, because nothing in this repository records
 * where the guardhouse actually is. The boundary GeoJSON is a perimeter with
 * no gate on it, and a coordinate guessed from the map would be the kind of
 * invented position a dispatch console must not contain.
 */
function readGuardhouse() {
  const raw = import.meta.env.VITE_GUARDHOUSE_LNGLAT
  const parsed = parseLngLat(raw)
  if (raw && !parsed) {
    console.warn('VITE_GUARDHOUSE_LNGLAT must be "lng,lat" (longitude first). Ignoring it:', raw)
  }
  return parsed
}

export const GUARDHOUSE_LNGLAT = readGuardhouse()

/** One position fix from this device: `{ lngLat, accuracy }`. */
export function currentFix({
  geolocation = globalThis.navigator?.geolocation,
  timeout = 8000,
  maximumAge = 15_000,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(new RouteError('no-geolocation', 'This browser has no location support.'))
      return
    }
    geolocation.getCurrentPosition(
      ({ coords, timestamp }) =>
        resolve({ lngLat: [coords.longitude, coords.latitude], accuracy: coords.accuracy, capturedAt: timestamp }),
      (err) =>
        reject(
          err?.code === 1
            ? new RouteError('location-denied', 'Location access is blocked for this site.')
            : new RouteError('no-fix', 'Could not get a position fix.'),
        ),
      // A fix up to 15 s old is still where a unit that has just pressed a
      // button is standing, and accepting it saves a cold GPS start. The
      // arrival check passes 0: "I have arrived" must be measured from where
      // the guard is now, not from where they were a street ago.
      { enableHighAccuracy: true, timeout, maximumAge },
    )
  })
}
