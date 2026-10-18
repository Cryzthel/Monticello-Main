import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'
import { portalKey } from '@shared/config/portal'

/** sessionStorage key for the message a forced sign-out leaves for the login screen. */
const END_REASON_KEY = portalKey('session-end-reason')

/** How long a logout waits for offline-queued writes to reach the server. */
const PENDING_WRITES_GRACE_MS = 4000

/**
 * Wipe everything a signed-in session left on this device, then load the
 * login page fresh.
 *
 * ── WHY A HARD RELOAD ──────────────────────────────────────────────────────
 * The SOS channel, the incident alert cards, toasts and every module-level
 * store sit ABOVE the routes, so they stayed mounted — with their data — on
 * the login screen after logout (2026-10-18). Unsubscribing each one by hand
 * is a list that is wrong the day someone adds a provider. Reloading the
 * document tears down every listener and every byte of in-memory state at
 * once, by construction.
 *
 * ── THE DISK CACHE ─────────────────────────────────────────────────────────
 * The Guardhouse runs Firestore with a persistent IndexedDB cache (offline
 * dispatch), so incidents and panic alerts stayed on a shared guardhouse PC
 * after logout. It is cleared here. Offline-QUEUED writes (a stage pressed
 * with no signal) get a few seconds to reach the server first; past that the
 * cache is cleared anyway, because confidential data at rest on a shared
 * machine is the larger risk. Logging out while on duty is already blocked
 * (clock out first), which makes a queued write at logout rare.
 *
 * `clearIndexedDbPersistence` refuses while ANOTHER tab still has the cache
 * open; every tab runs this on the same sign-out, so the last one to get here
 * clears it. The admin console uses a memory cache, so there it is a no-op.
 *
 * Kept on purpose: device preferences in localStorage (theme, sidebar width,
 * siren mute, guard display prefs) — none of them is data about anyone.
 */
export async function purgeSessionData() {
  try {
    await Promise.race([
      waitForPendingWrites(db),
      new Promise((resolve) => setTimeout(resolve, PENDING_WRITES_GRACE_MS)),
    ])
  } catch {
    /* nothing to wait for */
  }
  try {
    await terminate(db)
  } catch {
    /* already terminated */
  }
  try {
    await clearIndexedDbPersistence(db)
  } catch (err) {
    if (err?.code !== 'failed-precondition') console.warn('Could not clear the offline cache', err?.code ?? err)
  }
  try {
    sessionStorage.clear()
  } catch {
    /* storage blocked */
  }
}

/**
 * Purge, then replace the page with the login screen (no back-button return).
 *
 * `reason` — set when the session was ended FOR the user (an admin suspended
 * the account) — is written after the purge, so it is the one thing that
 * survives it, and the login screen reads it back once.
 */
export async function endSessionAndReload(loginPath = '/login', reason = '') {
  await purgeSessionData()
  if (reason) {
    try {
      sessionStorage.setItem(END_REASON_KEY, reason)
    } catch {
      /* storage blocked: the login screen simply shows no reason */
    }
  }
  window.location.replace(loginPath)
}

let endReason = null

/**
 * The reason left by endSessionAndReload, removed from storage on first read
 * and remembered for this page load — so StrictMode's double-run of a state
 * initializer gets the same answer twice rather than the message, then ''.
 */
export function takeSessionEndReason() {
  if (endReason !== null) return endReason
  try {
    endReason = sessionStorage.getItem(END_REASON_KEY) ?? ''
    if (endReason) sessionStorage.removeItem(END_REASON_KEY)
  } catch {
    endReason = ''
  }
  return endReason
}
