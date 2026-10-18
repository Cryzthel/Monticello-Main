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
