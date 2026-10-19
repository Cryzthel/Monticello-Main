import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '@shared/lib/firebase'

/**
 * How long a successful sync covers this account. Settings asks on mount,
 * and its section cards remount on every sub-page, so without this each
 * click between Profile / Security / Notifications was a Cloud Function
 * call that could not have changed anything (2026-10-20).
 */
const SYNC_FRESH_MS = 10 * 60 * 1000
let lastSync = { uid: null, at: 0, pending: null }

/**
 * Asks the server to copy this account's Auth email and verified flag onto its
 * staff record (functions/accountSync.js). Never throws: a sync that misses
 * runs again on the next sign-in or focus of Settings.
 *
 * Deduplicated per account: a call inside SYNC_FRESH_MS of a successful one,
 * or while one is already in flight, reuses it. `force` skips that — pass it
 * when the address or its verification has actually changed.
 */
export function syncStaffEmail({ force = false } = {}) {
  const uid = auth.currentUser?.uid ?? null
  if (!force && uid && lastSync.uid === uid) {
    if (lastSync.pending) return lastSync.pending
    if (Date.now() - lastSync.at < SYNC_FRESH_MS) return Promise.resolve(null)
  }
  const call = httpsCallable(functions, 'syncStaffEmail')
  const pending = call({})
    .then((result) => {
      lastSync = { uid, at: Date.now(), pending: null }
      return result?.data ?? null
    })
    .catch((err) => {
      lastSync = { uid, at: 0, pending: null }
      console.warn('Staff email sync skipped', err?.code ?? err)
      return null
    })
  lastSync = { uid, at: lastSync.uid === uid ? lastSync.at : 0, pending }
  return pending
}

/**
 * Asks the server to record this account's own password change in the audit
 * trail (functions/accountSync.js recordPasswordChange). The server checks the
 * change itself, so this carries no arguments. Never throws.
 */
export function recordPasswordChange() {
  const call = httpsCallable(functions, 'recordPasswordChange')
  return call({})
    .then((result) => result?.data ?? null)
    .catch((err) => {
      console.warn('Password change not recorded', err?.code ?? err)
      return null
    })
}
