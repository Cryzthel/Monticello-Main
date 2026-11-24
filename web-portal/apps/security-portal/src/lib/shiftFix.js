import { currentFix } from '@/lib/routeOrigin'
import { getLastFix } from '@/lib/guardTelemetry'

/**
 * Where the officer was standing when they opened or closed a shift.
 *
 * ── WHY THIS IS NOT THE TELEMETRY WATCH ────────────────────────────────────
 * `useGuardTelemetry` already publishes this device's position continuously
 * while on duty, and that is a LIVE feed — it answers "where is unit 4 right
 * now" for the dispatch map and is overwritten by the next fix. A clock-in
 * coordinate is the opposite kind of fact: it is a timekeeping record, true
 * once, and it has to survive on the shift row an admin audits months later.
 * Reading the live feed at audit time would answer with wherever that guard
 * last stood, which is not where they clocked in.
 *
 * So the fix is captured here and written onto `guard_shifts`. It reuses the
 * two primitives that already exist rather than opening a third geolocation
 * path: `currentFix` for a fresh high-accuracy read, and the telemetry watch's
 * last known position as the fallback.
 *
 * ── A DENIED FIX MUST NEVER BLOCK A SHIFT ──────────────────────────────────
 * This resolves rather than throws. A guard who declined the permission
 * prompt, is inside a concrete guardhouse with no sky, or whose device simply
 * timed out still has to be able to clock in — a console that refuses to open
 * a shift without GPS is a console that stops the guardhouse working, and the
 * shift record matters more than the coordinate attached to it.
 *
 * The outcome is therefore recorded, not assumed: `{ fix, error }` where a
 * null `fix` carries the reason, so the panel can say "Location unavailable"
 * rather than quietly implying a verified position nobody captured.
 */
export async function captureShiftFix() {
  try {
    const { lngLat, accuracy, capturedAt } = await currentFix({ timeout: 8000, maximumAge: 15_000 })
    return {
      fix: {
        // Six decimals is ~0.1 m — far finer than any civilian GPS, and the
        // point at which storing more digits is storing noise.
        lat: round6(lngLat[1]),
        lng: round6(lngLat[0]),
        accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
        capturedAt: capturedAt ?? Date.now(),
        source: 'gps',
      },
      error: null,
    }
  } catch (err) {
    // The watch may already hold a recent position even when a cold
    // getCurrentPosition times out — on duty it has been running all shift.
    const last = getLastFix()
    if (last) {
      return {
        fix: {
          lat: round6(last.lat),
          lng: round6(last.lng),
          accuracy: Number.isFinite(last.accuracy) ? Math.round(last.accuracy) : null,
          capturedAt: last.capturedAt ?? Date.now(),
          source: 'last-known',
        },
        error: null,
      }
    }
    return { fix: null, error: describe(err) }
  }
}

const round6 = (n) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null)

function describe(err) {
  if (err?.code === 'location-denied') return 'Location access is blocked for this site.'
  if (err?.code === 'no-geolocation') return 'This browser has no location support.'
  return 'Could not get a position fix.'
}

/** "±12 m" — the accuracy radius, as a badge prints it. */
export function formatAccuracy(fix) {
  if (!fix) return null
  if (!Number.isFinite(fix.accuracy)) return 'position recorded'
  return `±${fix.accuracy} m`
}
