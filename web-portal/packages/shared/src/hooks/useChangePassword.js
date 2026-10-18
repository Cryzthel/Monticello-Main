import { useCallback, useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { auth } from '@shared/lib/firebase'
import { reconcilePasswordResetFlags } from '@shared/lib/passwordFlags'
import { meetsPolicy, passwordReady } from '@shared/auth/passwordPolicy'
import { toast } from '@shared/lib/toast'

/**
 * Changing the signed-in account's own password — the state and the Firebase
 * calls, without any layout. The Guardhouse's ChangePasswordPanel and the
 * Admin's Security settings both render it.
 *
 *   • Re-authenticates first: Firebase refuses `updatePassword` on an old
 *     session, and the current password is what stops a passer-by at an
 *     unattended console from taking the account.
 *   • Nothing is persisted. `reset` clears every field; callers run it when
 *     the form is dismissed so no typed password outlives it.
 *   • `attempted` is set by a submit with the rules unmet, so the checklist
 *     can turn red and say why instead of the button sitting disabled.
 *   • A success clears the account's "Reset pending" flag on the server, and
 *     Firebase signs the account's other sessions out.
 */
export function useChangePassword({ onChanged } = {}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [attempted, setAttempted] = useState(false)
  const [done, setDone] = useState(false)

  const reset = useCallback(() => {
    setCurrent('')
    setNext('')
    setConfirmation('')
    setReveal(false)
    setError(null)
    setAttempted(false)
  }, [])

  const mismatch = confirmation.length > 0 && confirmation !== next
  const reused = next.length > 0 && next === current
  const ready = Boolean(current) && passwordReady(next, confirmation) && !reused
  const showRuleError = attempted && next.length > 0 && !meetsPolicy(next)

  async function submit(event) {
    event?.preventDefault?.()
    const user = auth.currentUser
    if (busy || !user?.email) return false
    setAttempted(true)
    if (!ready) return false
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current))
      await updatePassword(user, next)
      toast.success('Password updated', { description: 'Other devices signed in to this account were signed out.' })
      reconcilePasswordResetFlags()
      reset()
      setDone(true)
      onChanged?.()
      return true
    } catch (err) {
      setError(passwordErrorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    current,
    setCurrent,
    next,
    setNext,
    confirmation,
    setConfirmation,
    reveal,
    toggleReveal: () => setReveal((on) => !on),
    busy,
    error,
    done,
    mismatch,
    reused,
    ready,
    showRuleError,
    submit,
    reset,
  }
}

/**
 * Firebase's codes, in the words of the person reading them. Since email
 * enumeration protection is on, a wrong password is `invalid-credential`.
 */
export function passwordErrorMessage(err) {
  switch (err?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'That is not the current password for this account.'
    case 'auth/weak-password':
      return 'Firebase rejected the new password as too weak. Try a longer one.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/requires-recent-login':
      return 'This session is too old to change a password. Sign out, sign in again, and retry.'
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check the connection and try again.'
    default:
      return 'The password could not be changed. Try again.'
  }
}
