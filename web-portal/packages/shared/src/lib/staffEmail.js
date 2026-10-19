import { httpsCallable } from 'firebase/functions'
import { functions } from '@shared/lib/firebase'

/**
 * Asks the server to copy this account's Auth email and verified flag onto its
 * staff record (functions/accountSync.js). Never throws: a sync that misses
 * runs again on the next sign-in or focus of Settings.
 */
export function syncStaffEmail() {
  const call = httpsCallable(functions, 'syncStaffEmail')
  return call({})
    .then((result) => result?.data ?? null)
    .catch((err) => {
      console.warn('Staff email sync skipped', err?.code ?? err)
      return null
    })
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
