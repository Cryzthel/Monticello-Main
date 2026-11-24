import { Timestamp } from 'firebase/firestore'
import { currentFix } from '@/lib/routeOrigin'
import { describeDevice, getLastFix, readBattery } from '@/lib/guardTelemetry'

/**
 * The evidence attached to every dispatch-workflow write: who, on what device,
 * with how much battery, standing where, and when their device said it was.
 *
 * Stored on the write's `status_log` entry. firestore.rules requires the
 * entry, and requires these fields on it, so a stage that was changed but not
 * recorded cannot exist.
 *
 * ── NOTHING HERE MAY BLOCK THE ACTION FOR LONG ─────────────────────────────
 * The action is the point. A guard pressing "I have arrived" must not wait
 * eight seconds for a GPS fix they could not get indoors. So every probe has a
 * timeout, a failed probe is recorded as null with the reason, and the write
 * goes ahead. The log then shows what was and was not known.
 */

/** A fix the telemetry stream already has, if it is recent enough to reuse. */
const REUSE_FIX_MS = 30_000

function toGeolocation(fix) {
  if (!fix) return null
  return {
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy ?? null,
    capturedAt: fix.capturedAt ?? null,
  }
}

/**
 * Where this device is.
 *
 * `fresh` asks the GPS for a new fix with no cache, which is what the arrival
 * check needs. Otherwise a fix from the telemetry stream up to 30 s old is
 * reused. Resolves `{ fix, error }` and never rejects: `error` is the reason
 * code when there is no fix ('location-denied', 'no-fix', 'no-geolocation').
 */
export async function locateDevice({ fresh = false, timeout = 4000 } = {}) {
  const cached = getLastFix()
  if (!fresh && cached && Date.now() - cached.capturedAt < REUSE_FIX_MS) {
    return { fix: cached, error: null }
  }
  try {
    const fix = await currentFix({ timeout, maximumAge: fresh ? 0 : 15_000 })
    return {
      fix: {
        lat: fix.lngLat[1],
        lng: fix.lngLat[0],
        accuracy: Number.isFinite(fix.accuracy) ? Math.round(fix.accuracy * 10) / 10 : null,
        capturedAt: fix.capturedAt ?? Date.now(),
      },
      error: null,
    }
  } catch (err) {
    // A stale fix beats none for an audit entry. The entry keeps its
    // `capturedAt`, so how stale it was is on the record.
    return { fix: fresh ? null : cached, error: err?.code ?? 'no-fix' }
  }
}

/**
 * Everything the audit entry needs, in the field names the rules expect.
 * Pass `fix` when the caller has just measured one (the arrival check) so the
 * entry records exactly the fix the decision was made on.
 */
export async function captureForensics({ fresh = false, timeout, fix: knownFix } = {}) {
  const clientAt = Timestamp.now()
  const [located, battery] = await Promise.all([
    knownFix !== undefined ? Promise.resolve({ fix: knownFix, error: knownFix ? null : 'no-fix' }) : locateDevice({ fresh, timeout }),
    readBattery(),
  ])
  const device = describeDevice()
  return {
    clientAt,
    queuedOffline: !device.online,
    geolocation: toGeolocation(located.fix),
    batteryLevel: battery?.level ?? null,
    charging: battery ? battery.charging : null,
    deviceTelemetry: { ...device, locationError: located.error },
  }
}
