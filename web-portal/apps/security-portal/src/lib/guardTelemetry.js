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

// ── THE ROUTE, PUBLISHED ────────────────────────────────────────────────────
//
// The guard's console plots its own route and counts its own ETA down. Until
// now that lived entirely in one browser: an admin watching the same call on
// the Hazard Map could see WHERE the unit was and nothing about where it was
// going. Publishing the computed line is what makes the two canvases agree,
// and it is strictly cheaper than the alternative — the admin renders the
// polyline the guard already paid the Directions API for rather than asking
// for a second one that would differ by a refresh.

/** How many coordinates a published line may carry. */
const MAX_ROUTE_POINTS = 300

/**
 * The compact, publishable form of a plotted route.
 *
 * Coordinates are rounded to five decimals (~1 m) and thinned to at most
 * MAX_ROUTE_POINTS by even stride. A subdivision route is far below that, so
 * the cap is a guard against a pathological response rather than a routine
 * path — but a Firestore document is capped at 1 MB and a telemetry doc that
 * can be refused for size is a unit that vanishes off the dispatcher's map.
 *
 * `etaAt` is an absolute epoch, not a remaining duration. A countdown stored
 * as "412 seconds" is wrong the instant it is written and has no way to say
 * how stale it is; an arrival time stays meaningful on a reader's clock.
 */
export function summariseRoute(route, { incidentId, alertId = null, tone = 'live' } = {}) {
  const coords = route?.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return null

  const stride = Math.ceil(coords.length / MAX_ROUTE_POINTS)
  const thinned = stride > 1 ? coords.filter((_, i) => i % stride === 0 || i === coords.length - 1) : coords

  const r5 = (n) => Math.round(n * 1e5) / 1e5
  return {
    incidentId: incidentId ?? null,
    /**
     * The panic alert this route answers, when it is answering one.
     *
     * A separate field rather than reusing `incidentId`, because they are ids
     * in two different collections and nothing downstream could tell them
     * apart. `useGuardFleet` puts `incidentId` on the route feature it draws
     * on the Hazard Map; handing it a `panic_alerts` id under that name would
     * be a value that looks joinable and is not — the quiet kind of wrong
     * that survives until somebody writes the join.
     */
    alertId,
    tone,
    coordinates: thinned.map(([lng, lat]) => [r5(lng), r5(lat)]),
    distance: Number.isFinite(route.distance) ? Math.round(route.distance) : null,
    duration: Number.isFinite(route.duration) ? Math.round(route.duration) : null,
    etaAt: Number.isFinite(route.duration) ? Date.now() + Math.round(route.duration) * 1000 : null,
    plottedAt: Date.now(),
  }
}

/**
 * Merge the active route onto this unit's telemetry document.
 *
 * A MERGE, and separate from `publishTelemetry`, because the two change at
 * completely different rates: position heartbeats every 20 s while responding,
 * while a route is re-plotted only when the unit has actually moved enough to
 * invalidate it. Folding the geometry into the heartbeat would rewrite a few
 * hundred coordinates every twenty seconds to say nothing new.
 *
 * Never throws. A route that failed to publish is a worse map for the
 * dispatcher; a route that threw would be a broken console for the officer
 * actually driving to the call, and only one of those is an emergency.
 */
export async function publishRoute(uid, summary) {
  if (!uid) return
  try {
    await setDoc(
      doc(db, 'guard_telemetry', uid),
      { uid, route: summary ?? null, updatedAt: serverTimestamp() },
      { merge: true },
    )
  } catch (err) {
    console.warn('Route publish failed', err)
  }
}
