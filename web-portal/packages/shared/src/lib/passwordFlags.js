import { httpsCallable } from 'firebase/functions'
import { functions } from '@shared/lib/firebase'

/**
 * Ask the server to clear "Reset pending" on accounts whose officer has since
 * set their own password (functions/securityProvisioning.js,
 * reconcilePasswordResetFlags).
 *
 * The server decides from Firebase Auth's own record of the last password
 * change, so callers only say WHEN to check, never WHAT the answer is:
 *   • a Super Admin opening Security Accounts — the flagged accounts on screen;
 *   • anyone after changing their password, or on sign-in — themselves.
 *
 * Fire-and-forget and silent on failure. The badge is cleared through the
 * accounts page's live listener when the write lands; if the function is not
 * deployed yet the badge simply stays as it was, which is the state before
 * this existed — not an error worth a toast.
 *
 * @param {string[]} [uids]  Super Admin only: which accounts to check.
 */
export function reconcilePasswordResetFlags(uids) {
  const call = httpsCallable(functions, 'reconcilePasswordResetFlags')
  return call(uids?.length ? { uids } : {})
    .then((result) => result?.data?.cleared ?? [])
    .catch((err) => {
      console.warn('Reset-pending reconcile skipped', err?.code ?? err)
      return []
    })
}
