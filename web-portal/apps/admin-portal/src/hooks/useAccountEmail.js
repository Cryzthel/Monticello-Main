import { useCallback, useEffect, useRef, useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '@shared/lib/firebase'
import { syncStaffEmail } from '@shared/lib/staffEmail'
import { toast } from '@shared/lib/toast'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const EMAIL_CODE_LENGTH = 6
const RESEND_COOLDOWN_S = 60

/**
 * The signed-in administrator's sign-in email, and the OTP-verified change.
 *
 * ── NOTHING CHANGES UNTIL THE CODE IS TYPED BACK (2026-10-19) ──────────────
 * This used Firebase's `verifyBeforeUpdateEmail`, which switches the account
 * the moment a link is opened — from any inbox, in any browser, with no
 * record of who asked. That is how the primary admin address was moved to a
 * test inbox. The change now runs on two callables (functions/emailChange.js):
 *
 *   request()  re-authenticates with the current password (and refreshes the
 *              ID token, whose `auth_time` the server checks), then asks the
 *              server to mail a 6-digit code to the NEW address;
 *   confirm()  sends the code back. Only then does the server change Auth,
 *              sync the staff record, log `staff.email.changed` to Audit
 *              History and notify the OLD address.
 *
 * ── THE BADGE IS READ FROM FIREBASE AUTH, LIVE ─────────────────────────────
 * Auth pushes nothing when an address is verified elsewhere, so the user
 * record is reloaded whenever this window regains focus (and every 20 s while
 * it is unverified); a change is mirrored to the staff record by the server.
 */
export function useAccountEmail() {
  const user = auth.currentUser
  const [identity, setIdentity] = useState(() => ({
    email: user?.email ?? '',
    verified: Boolean(user?.emailVerified),
  }))
  const identityRef = useRef(identity)
  const [nextEmail, setNextEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sendingVerification, setSendingVerification] = useState(false)

  const adopt = useCallback((current) => {
    const next = { email: current.email ?? '', verified: Boolean(current.emailVerified) }
    const prev = identityRef.current
    if (prev.email !== next.email || prev.verified !== next.verified) {
      identityRef.current = next
      setIdentity(next)
      syncStaffEmail()
    }
  }, [])

  const refresh = useCallback(async () => {
    const current = auth.currentUser
    if (!current) return
    try {
      await current.reload()
    } catch {
      return
    }
    adopt(current)
  }, [adopt])

  // Once per visit, so a staff record left stale before this existed catches up.
  useEffect(() => {
    syncStaffEmail()
  }, [])

  useEffect(() => {
    const onFocus = () => {
      refresh()
    }
    window.addEventListener('focus', onFocus)
    const timer = !identity.verified ? setInterval(onFocus, 20_000) : null
    return () => {
      window.removeEventListener('focus', onFocus)
      if (timer) clearInterval(timer)
    }
  }, [refresh, identity.verified])

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const trimmed = nextEmail.trim().toLowerCase()
  const invalid = trimmed.length > 0 && !EMAIL_RE.test(trimmed)
  const same = trimmed.length > 0 && trimmed === identity.email.toLowerCase()
  const ready = EMAIL_RE.test(trimmed) && !same && Boolean(password)
  const codeReady = code.length === EMAIL_CODE_LENGTH

  function cancel() {
    setNextEmail('')
    setPassword('')
    setCode('')
    setSentTo('')
    setError('')
  }

  async function callRequest(address) {
    const send = httpsCallable(functions, 'requestEmailChange')
    const result = await send({ newEmail: address })
    setSentTo(result?.data?.sentTo ?? address)
    setCooldown(RESEND_COOLDOWN_S)
  }

  /** Step 1: password, then a code to the new address. True when sent. */
  async function request() {
    const current = auth.currentUser
    if (busy || !ready || !current?.email) return false
    setBusy(true)
    setError('')
    try {
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password))
      // A fresh token carries the new `auth_time` the server checks.
      await current.getIdToken(true)
      await callRequest(trimmed)
      setPassword('')
      return true
    } catch (err) {
      setError(emailErrorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    if (busy || cooldown > 0 || !sentTo) return
    setBusy(true)
    setError('')
    try {
      await callRequest(sentTo)
      setCode('')
      toast.success('A new code is on its way', { description: `Sent to ${sentTo}.` })
    } catch (err) {
      setError(emailErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** Step 2: the code. True once the server has committed the change. */
  // `entered`: OtpInput's onComplete hands the code over in the same tick as
  // onChange, before `code` state has caught up.
  async function confirm(entered) {
    const otp = typeof entered === 'string' ? entered : code
    const current = auth.currentUser
    if (busy || otp.length !== EMAIL_CODE_LENGTH || !current) return false
    setBusy(true)
    setError('')
    try {
      const check = httpsCallable(functions, 'confirmEmailChange')
      const result = await check({ otp })
      await current.reload()
      await current.getIdToken(true)
      adopt(current)
      toast.success('Sign-in email changed', {
        description: `Use ${result?.data?.email ?? sentTo} the next time you sign in.`,
      })
      cancel()
      return true
    } catch (err) {
      setError(emailErrorMessage(err))
      if (err?.details?.reason === 'wrong-code') setCode('')
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

  return {
    available: Boolean(user),
    email: identity.email,
    verified: identity.verified,
    nextEmail,
    setNextEmail: (value) => {
      setNextEmail(value)
      if (error) setError('')
    },
    password,
    setPassword: (value) => {
      setPassword(value)
      if (error) setError('')
    },
    code,
    setCode: (value) => {
      setCode(value)
      if (error) setError('')
    },
    sentTo,
    cooldown,
    invalid,
    same,
    ready,
    codeReady,
    busy,
    error,
    request,
    resend,
    confirm,
    cancel,
    sendVerification,
    sendingVerification,
  }
}

function emailErrorMessage(err) {
  switch (err?.details?.reason) {
    case 'invalid-email':
      return 'Enter a valid email address.'
    case 'same-email':
      return 'That is already your sign-in email.'
    case 'email-in-use':
      return 'That address already belongs to another account.'
    case 'reauth-required':
      return 'For your security, confirm your password again: close this and start over.'
    case 'mail-failed':
      return 'We could not send the code email just now. Try again in a few minutes.'
    case 'wrong-code':
      return 'That code is not right. Check the latest email and try again.'
    case 'locked':
      return 'Too many wrong codes. Wait 30 minutes, then request a new code.'
    case 'expired':
      return 'That code has expired. Send a new one.'
    case 'no-request':
      return 'That code has already been used or replaced. Send a new one.'
    default:
      break
  }
  switch (err?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'That is not the current password for this account.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/network-request-failed':
    case 'functions/unavailable':
      return 'Could not reach the server. Check the connection and try again.'
    case 'functions/not-found':
    case 'functions/internal':
      return 'Email changes are unavailable right now. Try again later.'
    case 'functions/permission-denied':
      return 'This account is not allowed to change its email here.'
    default:
      return 'That did not go through. Try again.'
  }
}
