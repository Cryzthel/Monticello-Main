import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  verifyBeforeUpdateEmail,
} from 'firebase/auth'
import { portalKey } from '@shared/config/portal'
import { auth } from '@shared/lib/firebase'
import { syncStaffEmail } from '@shared/lib/staffEmail'
import { toast } from '@shared/lib/toast'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Remembers a sent change link across a reload — this browser only. */
const PENDING_KEY = portalKey('pending-email-change')

function readPending() {
  try {
    return localStorage.getItem(PENDING_KEY) || ''
  } catch {
    return ''
  }
}
function writePending(value) {
  try {
    if (value) localStorage.setItem(PENDING_KEY, value)
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    /* storage blocked: the pending note just won't survive a reload */
  }
}

/**
 * The signed-in administrator's sign-in email: its verified state, and the
 * verify-first change flow.
 *
 * ── CHANGING IT IS VERIFY-FIRST ─────────────────────────────────────────────
 * `verifyBeforeUpdateEmail` mails a link to the NEW address and changes
 * nothing until it is opened, so a typo or a stranger's address can never take
 * over the account's sign-in. The current password is asked for first:
 * Firebase requires a recent sign-in, and it stops a passer-by at an open
 * console from redirecting the account. Once the link is opened Firebase signs
 * out every session on the old address, and the next sign-in copies the new
 * address onto the staff record (functions/accountSync.js).
 *
 * ── THE BADGE IS READ FROM FIREBASE AUTH, LIVE ─────────────────────────────
 * Auth pushes nothing when an address is verified in another tab or on a
 * phone, so the user record is reloaded whenever this window regains focus
 * and every 20 s while something is pending; a change is mirrored to the staff
 * record by the same server sync.
 */
export function useAccountEmail() {
  const user = auth.currentUser
  const [identity, setIdentity] = useState(() => ({
    email: user?.email ?? '',
    verified: Boolean(user?.emailVerified),
  }))
  const identityRef = useRef(identity)
  const [pending, setPending] = useState(readPending)
  const [nextEmail, setNextEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sendingVerification, setSendingVerification] = useState(false)

  const refresh = useCallback(async () => {
    const current = auth.currentUser
    if (!current) return
    try {
      await current.reload()
    } catch {
      // An email change revokes this session; the auth listener signs it out.
      return
    }
    const next = { email: current.email ?? '', verified: Boolean(current.emailVerified) }
    const prev = identityRef.current
    if (prev.email !== next.email || prev.verified !== next.verified) {
      identityRef.current = next
      setIdentity(next)
      syncStaffEmail()
    }
    if (pending && next.email.toLowerCase() === pending.toLowerCase()) {
      writePending('')
      setPending('')
    }
  }, [pending])

  // Once per visit, so a staff record left stale before this existed catches up.
  useEffect(() => {
    syncStaffEmail()
  }, [])

  useEffect(() => {
    const onFocus = () => {
      refresh()
    }
    window.addEventListener('focus', onFocus)
    const timer = pending || !identity.verified ? setInterval(onFocus, 20_000) : null
    return () => {
      window.removeEventListener('focus', onFocus)
      if (timer) clearInterval(timer)
    }
  }, [refresh, pending, identity.verified])

  const trimmed = nextEmail.trim().toLowerCase()
  const invalid = trimmed.length > 0 && !EMAIL_RE.test(trimmed)
  const same = trimmed.length > 0 && trimmed === identity.email.toLowerCase()
  const ready = EMAIL_RE.test(trimmed) && !same && Boolean(password)

  function cancel() {
    setNextEmail('')
    setPassword('')
    setError('')
  }

  async function submit() {
    const current = auth.currentUser
    if (busy || !ready || !current?.email) return false
    setBusy(true)
    setError('')
    try {
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password))
      await verifyBeforeUpdateEmail(current, trimmed, { url: `${window.location.origin}/login` })
      writePending(trimmed)
      setPending(trimmed)
      toast.success('Confirmation link sent', { description: `Open the link sent to ${trimmed} to finish the change.` })
      cancel()
      return true
    } catch (err) {
      setError(emailErrorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function sendVerification() {
    const current = auth.currentUser
    if (!current || sendingVerification) return
    setSendingVerification(true)
    try {
      await sendEmailVerification(current, { url: `${window.location.origin}/settings#profile` })
      toast.success('Verification email sent', { description: `Open the link sent to ${identity.email}.` })
    } catch (err) {
      toast.error('Could not send the verification email', { description: emailErrorMessage(err) })
    } finally {
      setSendingVerification(false)
    }
  }

  function dismissPending() {
    writePending('')
    setPending('')
  }

  return {
    available: Boolean(user),
    email: identity.email,
    verified: identity.verified,
    pending,
    dismissPending,
    nextEmail,
    setNextEmail,
    password,
    setPassword,
    invalid,
    same,
    ready,
    busy,
    error,
    submit,
    cancel,
    sendVerification,
    sendingVerification,
  }
}

function emailErrorMessage(err) {
  switch (err?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'That is not the current password for this account.'
    case 'auth/email-already-in-use':
      return 'That address already belongs to another account.'
    case 'auth/invalid-email':
    case 'auth/invalid-new-email':
      return 'Enter a valid email address.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/requires-recent-login':
      return 'This session is too old. Sign out, sign in again, and retry.'
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check the connection and try again.'
    case 'auth/unauthorized-continue-uri':
      return "This console's address is not an authorised domain in Firebase Authentication yet."
    case 'auth/operation-not-allowed':
      return 'Email changes are turned off for this project in Firebase Authentication.'
    default:
      return 'That did not go through. Try again.'
  }
}
