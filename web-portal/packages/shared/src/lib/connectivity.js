import { onValue, ref } from 'firebase/database'
import { rtdb } from '@shared/lib/firebase'

/**
 * Is this console actually connected right now? For copy that would otherwise
 * GUESS — "saved on this device, it will sync later" must only ever be said
 * to someone who is offline.
 *
 * ── WHY NOT A TIMER (2026-10-19) ───────────────────────────────────────────
 * useStageAction called any write the server took more than 2.5s to confirm
 * "saved on this device", and dispatchers on a perfectly good connection were
 * told they were offline. A slow acknowledgement is not an outage: the
 * channel reconnecting after an idle tab, or the rules' document reads on a
 * dispatch batch, can take that long online.
 *
 * Two signals, and offline needs only one of them:
 *   • `navigator.onLine` — false means no network at all (it cannot see a
 *     captive portal or a dead uplink, so true is not proof);
 *   • the Realtime Database's `.info/connected` — a live socket to Firebase,
 *     the same one officer presence (lib/presence.js) already holds open, so
 *     watching it costs no new connection. Unknown until its first answer,
 *     and when the database is not configured.
 */
let connected = null
let watching = false
let watchStartedAt = 0
let everConnected = false
const listeners = new Set()
let lastNotified = null

/** Tell subscribers when the answer to `isOffline()` flips. */
function notify() {
  const offline = isOffline()
  if (offline === lastNotified) return
  lastNotified = offline
  listeners.forEach((fn) => fn(offline))
}

/**
 * `.info/connected` reports false the instant it is subscribed, before the
 * socket has had a chance to open. On a console that had not opened the
 * database yet that was a "you are offline" for the first second of a good
 * connection, so an opening false counts as unknown for this long.
 */
const CONNECT_GRACE_MS = 5000

function watch() {
  if (watching || !rtdb) return
  watching = true
  watchStartedAt = Date.now()
  try {
    onValue(
      ref(rtdb, '.info/connected'),
      (snap) => {
        const up = snap.val() === true
        if (up) everConnected = true
        connected = up || everConnected || Date.now() - watchStartedAt > CONNECT_GRACE_MS ? up : null
        notify()
      },
      () => {
        connected = null
        notify()
      },
    )
  } catch {
    connected = null
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', notify)
    window.addEventListener('offline', notify)
  }
}

/**
 * Calls `fn(offline)` whenever the answer flips, for UI that must react to
 * the signal rather than read it at press time. Returns an unsubscribe.
 */
export function subscribeConnectivity(fn) {
  watch()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Starts watching; call early (module load of a caller) so the answer is ready. */
export function primeConnectivity() {
  watch()
}

/** True only when there is positive evidence the console is offline. */
export function isOffline() {
  watch()
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return connected === false
}
