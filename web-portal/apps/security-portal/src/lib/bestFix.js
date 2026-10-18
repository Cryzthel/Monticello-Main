// A RELATIVE path, not the `@shared` alias: this module is a pure rule and is
// tested under bare node, which resolves neither Vite alias. Keeping the one
// import resolvable is what lets the rule be tested at all.
import { PRECISE_FIX_M } from '../../../../packages/shared/src/lib/geolocation.js'

/**
 * Of the two positions this console has for its own officer, which one is
 * actually better.
 *
 * ── THE LAPTOP-AND-PHONE CASE, WHICH IS THE WHOLE POINT ────────────────────
 * A guard on shift often has both: the dispatch console open on a laptop, and
 * the mobile app in their pocket. Both are signed in as the same officer, so
 * both publish to the same `guard_telemetry/{uid}` document — and they are not
 * equally good at knowing where they are. The phone has a GPS chip. The laptop
 * has a list of visible Wi-Fi access points, and on a desktop with the radio
 * off it has an IP address.
 *
 * Until now the local reading always won when the viewer was the assigned
 * officer. That was right against the failure it was written for — a browser
 * learning its own position by writing it to a server and reading it back —
 * and wrong in this one: it made the laptop prefer its own ±600 m guess over
 * the ±8 m fix the officer's own phone had just published. Two devices, same
 * person, and the console picked the worse sensor because it happened to be
 * the local one.
 *
 * So the rule is no longer "local wins"; it is "the better fix wins, and local
 * breaks the tie". That is what makes a desktop console agree with the phone
 * in the officer's pocket rather than arguing with it.
 *
 * ── WHY NOT JUST ALWAYS TAKE THE PUBLISHED ONE ─────────────────────────────
 * Because on the phone itself the published position IS the local one, one
 * Firestore round trip later and up to a telemetry interval staler. Preferring
 * it unconditionally would reintroduce the exact latency and failure surface
 * the local path exists to avoid, on the device that needs it most.
 */

/**
 * How much better a remote fix has to be before it displaces the local one.
 *
 * A margin rather than a straight comparison, because the two readings are
 * noisy and arrive at different times: ±21 m against ±19 m is the same
 * position described twice, and a console that switched sources on that
 * difference would flip back and forth every few seconds, dragging the marker
 * and re-plotting the route each time. 2x is wide enough that only a genuine
 * difference in SENSOR crosses it.
 */
const BETTER_BY = 2

/**
 * A remote fix older than this is not preferred however precise it claims to
 * be. Accuracy describes where the device was when it looked; it says nothing
 * about whether the officer is still there.
 *
 * 150 s, not 60 s (2026-10-17): it must outlast the SLOWEST publish cadence
 * of the other device. An idle, stationary phone writes only on its 120 s
 * heartbeat (TELEMETRY_CADENCE.idle), so at 60 s its fix looked abandoned
 * between heartbeats and the laptop took the stream back and overwrote it —
 * the document flapped between sensors every two minutes. A phone that is
 * MOVING writes every 4-30 s, so this window only matters while it is still.
 */
const MAX_REMOTE_AGE_MS = 150_000

const radius = (fix) => (Number.isFinite(fix?.accuracy) ? fix.accuracy : Infinity)
const has = (fix) => Number.isFinite(fix?.lat) && Number.isFinite(fix?.lng)

/**
 * @param {object} local     This device's own fix, or null.
 * @param {object} published The officer's telemetry position, or null.
 * @param {number} [now]
 * @returns {object|null} Whichever should be treated as this officer's position.
 */
export function pickBestFix(local, published, now = Date.now()) {
  if (!has(local)) return has(published) ? published : null
  if (!has(published)) return local

  // A remote fix is only worth considering while it is recent. `capturedAt` is
  // when the DEVICE took the reading, not when the document was written, which
  // is the honest clock for this.
  const capturedAt = published.capturedAt
  const age = Number.isFinite(capturedAt) ? now - capturedAt : Infinity
  if (age > MAX_REMOTE_AGE_MS) return local

  // The local reading is already a GPS-grade fix. Nothing is gained by
  // reaching across the network for a different one. PRECISE_FIX_M (30 m),
  // not the 100 m "usable at all" line: a laptop on good Wi-Fi reports 30-100 m
  // and used to keep its own estimate against the officer's ±8 m phone.
  if (radius(local) <= PRECISE_FIX_M) return local

  return radius(published) * BETTER_BY <= radius(local) ? published : local
}

/**
 * Should THIS device stop publishing the officer's position, because another
 * of their devices is publishing a better one?
 *
 * ── THE OVERWRITE THIS EXISTS FOR ──────────────────────────────────────────
 * Both devices write the same `guard_telemetry/{uid}` document, and each write
 * replaces it whole. So the laptop's ±122 m Wi-Fi estimate, published every
 * few seconds, kept replacing the phone's ±8 m GPS fix — the document
 * alternated between sensors, and every dispatcher's map jumped with it.
 * pickBestFix fixed what THIS console draws; nothing stopped it un-fixing what
 * everyone else reads.
 *
 * Yield when the document's position came from a DIFFERENT device, is fresh,
 * and is a genuinely better sensor (BETTER_BY) than ours or ours is missing.
 * The yield ends by itself: a phone put away stops refreshing, its fix ages
 * past MAX_REMOTE_AGE_MS, and this device takes the stream back.
 *
 * @param {object|null} remote  `{ position, deviceId }` from the live document.
 * @param {object|null} local   This device's latest fix.
 * @param {string} myDeviceId
 */
export function shouldDeferPublish(remote, local, myDeviceId, now = Date.now()) {
  const position = remote?.position
  if (!has(position) || !remote?.deviceId || remote.deviceId === myDeviceId) return false
  const capturedAt = position.capturedAt
  const age = Number.isFinite(capturedAt) ? now - capturedAt : Infinity
  if (age > MAX_REMOTE_AGE_MS) return false
  if (!has(local)) return true
  if (radius(local) <= PRECISE_FIX_M) return false
  return radius(position) * BETTER_BY <= radius(local)
}

/**
 * How good a fix is, for the accuracy badge.
 *
 *   precise   ≤ PRECISE_FIX_M — a GPS chip
 *   coarse    anything wider — Wi-Fi, cell or IP estimation
 *   unknown   no stated radius, or no fix
 */
export function fixQuality(fix) {
  if (!has(fix)) return { tier: 'unknown', accuracy: null }
  const accuracy = Number.isFinite(fix.accuracy) ? Math.round(fix.accuracy) : null
  if (accuracy == null) return { tier: 'unknown', accuracy: null }
  return { tier: accuracy <= PRECISE_FIX_M ? 'precise' : 'coarse', accuracy }
}

export { BETTER_BY, MAX_REMOTE_AGE_MS }
