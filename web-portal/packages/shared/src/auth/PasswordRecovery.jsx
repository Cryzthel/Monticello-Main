import { useCallback, useEffect, useState } from 'react'
import { confirmPasswordReset } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { CheckCircle2, ShieldCheck } from '@shared/icons'

import { auth } from '@shared/lib/firebase'
import { PORTAL } from '@shared/config/portal'
import AuthAlert from '@shared/auth/AuthAlert'
import BackToSignIn from '@shared/auth/BackToSignIn'
import CtaLabel from '@shared/auth/CtaLabel'
import FloatingField from '@shared/auth/FloatingField'
import NewPasswordFields from '@shared/auth/NewPasswordFields'
import { passwordReady } from '@shared/auth/passwordPolicy'
import OtpInput from '@shared/auth/OtpInput'
import { CTA } from '@shared/auth/authStyles'

/**
 * Password recovery, all four steps, in place of the sign-in form.
 *
 *   email  ──►  4-digit code  ──►  new password  ──►  done
 *
 * ── ONE CHANNEL: THE CODE ────────────────────────────────────────────────────
 * The code path runs on two Cloud Functions, `sendPasswordOtp` and
 * `verifyPasswordOtp`, shared with the mobile app. There is no second channel.
 *
 * This used to fall back to `sendPasswordResetEmail` — a link mail — whenever
 * the functions could not run, which is every call while the project's
 * billing is off. Mobile dropped the same fallback on 2026-10-16 by the
 * owner's decision, and the two clients now behave identically: when the
 * backend is down, step 1 says so under the field ("Password reset is
 * unavailable right now…", mobile's words) instead of quietly switching to a
 * different flow with a different email in it. Re-adding the link reverses
 * that decision on one client only.
 *
 * `verifyPasswordOtp` hands back a Firebase reset link, and only its `oobCode`
 * is used, by `confirmPasswordReset` — the same credential the emailed link
 * carries, so `/reset-password` still works for links issued elsewhere (the
 * staff-invite mail, the Firebase console).
 *
 * ── WHY IN PLACE RATHER THAN A DIALOG ────────────────────────────────────────
 * The brief calls it a modal. It replaces the form instead: a sign-in screen
 * has one job at a time, the two-factor step already establishes that pattern
 * on this exact surface, and a dialog would add a scrim, a focus trap and a
 * dismiss affordance to a flow whose every step already has an explicit way
 * back.
 */

/**
 * Seconds before the code can be sent again. 60, the function's own cooldown
 * and mobile's: this was 45, so for fifteen seconds the web offered a resend
 * the backend was certain to refuse as rate-limited.
 */
const RESEND_COOLDOWN = 60

/**
 * Who a STAFF member turns to when recovery itself is broken.
 *
 * Mobile's copy says "contact the HOA office", and for a resident that is
 * right. These consoles are the HOA office: an administrator told to contact
 * the HOA office is being told to contact themselves, and a guard's office is
 * the admin office. So the sentence is mobile's, and only its last clause is
 * per console.
 */
const SUPPORT = PORTAL === 'security' ? 'the admin office' : 'system administration'

const UNAVAILABLE = `Password reset is unavailable right now. Try again later, or contact ${SUPPORT}.`

/**
 * Digits in a reset code. Must equal OTP_LENGTH in functions/index.js and
 * kOtpLength in the mobile app — the function rejects any other length.
 */
const RESET_CODE_LENGTH = 4

/** The function's answer for an address with no account (see sendPasswordOtp). */
const isNotRegistered = (err) => err?.details?.reason === 'not-registered'

/**
 * Callable failures that mean "the backend did not run", as opposed to "the
 * backend said no". These, and only these, are reported as UNAVAILABLE.
 *
 * `internal` is what a function that cannot start returns — exactly what a
 * billing-disabled project produces. `unavailable` and `deadline-exceeded` are
 * transport failures. `not-found` means the function is not deployed at all.
 */
const BACKEND_DOWN = new Set([
  'functions/internal',
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/not-found',
  'internal',
  'unavailable',
  'deadline-exceeded',
  'not-found',
])

/** The reset credential lives in the link the callable hands back. */
function oobCodeFrom(resetLink) {
  try {
    return new URL(resetLink).searchParams.get('oobCode')
  } catch {
    return null
  }
}

/**
 * Each step's title and instruction, left-aligned, in the sign-in heading's
 * face. While recovery is open the shell's centred "Welcome back" greeting is
 * hidden (see `data-auth-recovery` in LoginSplitLayout), so this IS the page
 * heading — the same arrangement as mobile's Forgot Password screen, whose
 * title and body are both `TextAlign.start`.
 */
function StepHeading({ title, children }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-extrabold leading-[1.15] tracking-[-0.025em] text-text-primary">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{children}</p>
    </div>
  )
}

export default function PasswordRecovery({ initialEmail = '', onClose }) {
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [oobCode, setOobCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reveal, setReveal] = useState(false)

  const [error, setError] = useState('')
  // Whether `error` is about the ADDRESS (not registered, malformed) and so
  // belongs on the field, or about the SYSTEM (mail could not be sent, rate
  // limit, backend down) and belongs in the alert under it. A red field says
  // "fix what you typed"; when the fault is the server's, that sends someone
  // retyping a correct address.
  const [errorOnField, setErrorOnField] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // Ticks only while there is something to count. Re-armed by each send.
  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const requestCode = useCallback(async (address) => {
    const send = httpsCallable(getFunctions(auth.app, 'us-central1'), 'sendPasswordOtp')
    await send({ email: address })
  }, [])

  async function handleEmailSubmit(event) {
    event.preventDefault()
    const address = email.trim()
    if (!address || busy) return

    setError('')
    setNotice('')
    setBusy(true)
    try {
      await requestCode(address)
      setCode('')
      setCooldown(RESEND_COOLDOWN)
      setStep('code')
    } catch (err) {
      const fault = describeSendError(err)
      setError(fault.message)
      setErrorOnField(fault.field)
    } finally {
      setBusy(false)
    }
  }

  async function handleResend() {
    if (cooldown > 0 || busy) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await requestCode(email.trim())
      setCooldown(RESEND_COOLDOWN)
      setNotice('A new code is on its way.')
    } catch (err) {
      setError(describeSendError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const verify = useCallback(
    async (value) => {
      const digits = String(value).replace(/\D/g, '')
      if (digits.length !== RESET_CODE_LENGTH || busy) return

      setError('')
      setBusy(true)
      try {
        const check = httpsCallable(getFunctions(auth.app, 'us-central1'), 'verifyPasswordOtp')
        const result = await check({ email: email.trim(), otp: digits })
        const next = oobCodeFrom(result?.data?.resetLink ?? '')
        if (!next) throw new Error('missing-oob')
        setOobCode(next)
        setStep('password')
      } catch (err) {
        setCode('')
        setError(describeVerifyError(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, email],
  )

  async function handlePasswordSubmit(event) {
    event.preventDefault()
    if (!passwordReady(password, confirmation) || busy) return

    setError('')
    setBusy(true)
    try {
      await confirmPasswordReset(auth, oobCode, password)
      setStep('done')
    } catch (err) {
      setError(describeResetError(err))
    } finally {
      setBusy(false)
    }
  }

  // `data-auth-recovery` on every step's root is what LoginSplitLayout reads to
  // hide its centred greeting — see StepHeading.

  // ── Step 1 ────────────────────────────────────────────────────────────────
  if (step === 'email') {
    return (
      <form
        data-auth-recovery
        className="step-enter flex flex-col gap-6"
        onSubmit={handleEmailSubmit}
        noValidate
      >
        <StepHeading title="Reset password">
          Enter your email and we will send a {RESET_CODE_LENGTH}-digit code to reset your
          password.
        </StepHeading>

        <FloatingField
          id="recovery-email"
          label="Email address"
          type="email"
          required
          autoComplete="email"
          autoFocus
          filled={Boolean(email)}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            // An error about the previous address is wrong the instant it is
            // edited; leaving it up makes the correction feel rejected before
            // it has been submitted.
            // Cleared on the first keystroke, whichever kind it was: the red
            // edge goes the moment the address changes, not on resubmit.
            if (error) setError('')
          }}
          placeholder="Enter your email address"
          error={errorOnField ? error : ''}
        />

        <AuthAlert tone="error">{errorOnField ? '' : error}</AuthAlert>

        <div className="flex flex-col gap-3">
          <button type="submit" disabled={busy || !email.trim()} className={CTA}>
            <CtaLabel busy={busy} label="Send code" busyLabel="Sending…" />
          </button>
          <BackToSignIn onClick={onClose} disabled={busy} />
        </div>
      </form>
    )
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <div data-auth-recovery className="step-enter flex flex-col gap-6">
        <StepHeading title="Enter code">
          We sent a {RESET_CODE_LENGTH}-digit code to{' '}
          <span className="font-medium text-text-primary">{email.trim()}</span>. It expires in 10
          minutes.
        </StepHeading>

        <OtpInput
          id="recovery-otp"
          length={RESET_CODE_LENGTH}
          value={code}
          invalid={Boolean(error)}
          disabled={busy}
          autoFocus
          onChange={(next) => {
            setCode(next)
            if (error) setError('')
          }}
          // The code is the whole form, and it is only good for a few minutes.
          onComplete={verify}
        />

        <AuthAlert tone="error">{error}</AuthAlert>
        {notice && !error ? <AuthAlert tone="success">{notice}</AuthAlert> : null}

        {/* `aria-live` so reaching zero is announced rather than silently
            becoming pressable for someone not watching the number. */}
        <p className="text-xs font-medium text-text-secondary" aria-live="polite">
          {cooldown > 0 ? (
            `Resend code in ${cooldown}s`
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="font-semibold text-brand-400 underline decoration-brand-400/30 underline-offset-2 transition-colors hover:decoration-brand-400 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Resend code'}
            </button>
          )}
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => verify(code)}
            disabled={busy || code.replace(/\D/g, '').length !== RESET_CODE_LENGTH}
            className={CTA}
          >
            <CtaLabel busy={busy} label="Verify code" busyLabel="Verifying…" />
          </button>
          <BackToSignIn onClick={onClose} disabled={busy} />
        </div>
      </div>
    )
  }

  // ── Step 3 ────────────────────────────────────────────────────────────────
  if (step === 'password') {
    return (
      <form
        data-auth-recovery
        className="step-enter flex flex-col gap-6"
        onSubmit={handlePasswordSubmit}
        noValidate
      >
        <div className="flex flex-col gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/10 text-brand-400">
            <ShieldCheck size="md" />
          </span>
          <StepHeading title="New password">
            Create a strong new password for{' '}
            <span className="font-medium text-text-primary">{email.trim()}</span>.
          </StepHeading>
        </div>

        <NewPasswordFields
          password={password}
          confirmation={confirmation}
          reveal={reveal}
          disabled={busy}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
          onToggleReveal={() => setReveal((prev) => !prev)}
        />

        <AuthAlert tone="error">{error}</AuthAlert>

        <div className="flex flex-col gap-3">
          <button
            type="submit"
            disabled={busy || !passwordReady(password, confirmation)}
            className={CTA}
          >
            <CtaLabel busy={busy} label="Set new password" busyLabel="Setting password…" />
          </button>
          <BackToSignIn onClick={onClose} disabled={busy} />
        </div>
      </form>
    )
  }

  // ── Step 4 ────────────────────────────────────────────────────────────────
  return (
    <div data-auth-recovery className="step-enter flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/10 text-brand-400">
          <CheckCircle2 size="md" />
        </span>
        <StepHeading title="Password updated">
          Sign in with your new password. Any other device signed in to this account will need it
          too.
        </StepHeading>
      </div>

      <button type="button" onClick={onClose} className={CTA}>
        Return to sign in
      </button>
    </div>
  )
}

/* ── Error copy ─────────────────────────────────────────────────────────────
   Written here rather than passed through from the SDK: a callable's own
   message is either the backend's (fine, but phrased for a different client)
   or a bare "internal", and neither belongs in front of someone who cannot get
   into their account. */

/**
 * `{ message, field }`. `field` is true only when the ADDRESS is the problem,
 * which is what decides whether the email field turns red (see errorOnField).
 */
function describeSendError(err) {
  const onField = (message) => ({ message, field: true })
  const system = (message) => ({ message, field: false })

  // Before the code switch: the function sends this as failed-precondition,
  // which would otherwise fall through to the generic message.
  if (isNotRegistered(err)) return onField('This email address is not registered.')
  // The function ran and the address is fine, but the mail provider refused —
  // on 2026-10-16 Gmail rejected the SMTP login. Checked BEFORE BACKEND_DOWN:
  // it arrives as `internal`, and calling it "unavailable" sent the diagnosis
  // looking for a billing or deploy problem that was not there.
  if (err?.details?.reason === 'mail-failed') {
    return system(
      `We could not send the code email just now. Try again in a few minutes, or contact ${SUPPORT}.`,
    )
  }
  // The function never ran. There is no other channel to fall back to.
  if (BACKEND_DOWN.has(err?.code)) return system(UNAVAILABLE)
  switch (err?.code) {
    case 'functions/invalid-argument':
    case 'auth/invalid-email':
      return onField('That does not look like an email address.')
    case 'functions/resource-exhausted':
      return system('Too many requests for this address. Wait a few minutes and try again.')
    case 'auth/too-many-requests':
      return system('Too many attempts from this device. Wait a few minutes and try again.')
    case 'auth/network-request-failed':
      return system('Could not reach the server. Check your connection and try again.')
    default:
      return system('Could not send a code. Try again, or contact system administration.')
  }
}

function describeVerifyError(err) {
  switch (err?.code) {
    case 'functions/permission-denied':
      return 'Incorrect code. Check the digits and try again.'
    case 'functions/deadline-exceeded':
      return 'That code has expired. Send a new one.'
    case 'functions/failed-precondition':
      return 'That code has already been used. Send a new one.'
    case 'functions/resource-exhausted':
      return 'Too many incorrect attempts. Send a new code.'
    case 'functions/not-found':
      return 'No active code for this address. Send a new one.'
    case 'functions/invalid-argument':
      return `Enter all ${RESET_CODE_LENGTH} digits.`
    // Not BACKEND_DOWN wholesale: from verifyPasswordOtp, `not-found` and
    // `deadline-exceeded` are answers about the CODE, handled above.
    case 'functions/internal':
    case 'functions/unavailable':
      return UNAVAILABLE
    default:
      return 'Could not verify that code. Try again, or send a new one.'
  }
}

function describeResetError(err) {
  switch (err?.code) {
    case 'auth/weak-password':
      return 'That password was rejected as too weak. Try a longer one.'
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'That verification has expired. Start again from your email address.'
    default:
      return 'Could not set the password. Try again.'
  }
}
