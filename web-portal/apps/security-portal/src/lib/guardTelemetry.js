import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'

/**
 * Live unit telemetry: where each on-duty officer's device is, and how much
 * battery it has left. One document per officer at `guard_telemetry/{uid}`,
 * read by the dispatch map to draw units and by the unit picker to rank them.
 *
 * ── WHEN A DEVICE SHARES ITS POSITION ───────────────────────────────────────
 *   off duty              never. Clocking out writes `position: null`.
 *   on duty, no call      every 30 s to 2 min, unless the officer has turned
 *                         idle sharing off in Settings. This is what puts
 *                         the green Available marker on the map.
 *   on an active call     high-precision GPS, every 4 to 20 s, from
 *                         Acknowledge & Respond until the call is resolved.
 *                         Not optional: the dispatcher's route and the
 *                         resident's ETA are drawn from it, and the officer
 *                         is told so on the button that starts it.
 *
 * ── THE WRITE BUDGET ────────────────────────────────────────────────────────
 * The project is on the Spark plan: 20,000 document writes a day across
 * everything. An idle officer writes at most once per 30 s, and only after
 * moving 25 m, with a heartbeat every 2 min. That is ~240 writes over an
 * eight-hour shift standing still. A responding officer writes at most every
 * 4 s after moving 5 m. A 20-minute response is about 300 writes. These
 * numbers are why the thresholds are not tighter.
 */
export const TELEMETRY_CADENCE = {
  idle: { minMs: 30_000, heartbeatMs: 120_000, moveM: 25 },
  active: { minMs: 4_000, heartbeatMs: 20_000, moveM: 5 },
}

/**
 * The last fix this device produced, shared with the forensic capture so an
 * audit entry written seconds after a telemetry write does not ask the GPS
 * for the same answer again. Module state on purpose: there is one device.
 */
let lastFix = null

/** `{ lat, lng, accuracy, heading, speed, capturedAt }` or null. */
export function getLastFix() {
  return lastFix
}

export function rememberFix(position) {
  const { coords, timestamp } = position
  lastFix = {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy * 10) / 10 : null,
    heading: Number.isFinite(coords.heading) ? Math.round(coords.heading) : null,
    speed: Number.isFinite(coords.speed) ? Math.round(coords.speed * 10) / 10 : null,
    capturedAt: timestamp || Date.now(),
  }
  return lastFix
}

/**
 * `navigator.getBattery()`, or null where the browser has none.
 *
 * Chromium browsers implement the Battery Status API. Firefox and Safari
 * removed it for fingerprinting reasons. A null here is the true answer for
 * those browsers: the officer's battery is unknown, not full.
 */
export async function readBattery() {
  try {
    const battery = await globalThis.navigator?.getBattery?.()
    if (!battery) return null
    return { level: Math.round(battery.level * 100) / 100, charging: Boolean(battery.charging) }
  } catch {
    return null
  }
}

/** What the device is, for the dispatcher and the audit log. Nothing identifying beyond the user agent. */
export function describeDevice() {
  const nav = globalThis.navigator ?? {}
  return {
    platform: nav.userAgentData?.platform || nav.platform || '',
    mobile: Boolean(nav.userAgentData?.mobile ?? /Mobi|Android/i.test(nav.userAgent ?? '')),
    userAgent: String(nav.userAgent ?? '').slice(0, 256),
    online: nav.onLine !== false,
    connection: nav.connection?.effectiveType ?? null,
  }
}

/**
 * Overwrite this officer's telemetry document.
 *
 * `setDoc` without merge, so the stored document is exactly this payload: the
 * rules accept a fixed set of keys, and a merge would carry a stale key from
 * an older build forward forever.
 */
export function publishTelemetry(uid, payload) {
  return setDoc(doc(db, 'guard_telemetry', uid), {
    uid,
    name: payload.name ?? '',
    badgeNumber: payload.badgeNumber ?? '',
    onDuty: Boolean(payload.onDuty),
    mode: payload.mode ?? 'off',
    activeIncidentId: payload.activeIncidentId ?? null,
    position: payload.position ?? null,
    battery: payload.battery ?? null,
    device: payload.device ?? describeDevice(),
    updatedAt: serverTimestamp(),
  })
}
