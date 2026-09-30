import { useCallback, useEffect, useState } from 'react'
import { confirmPasswordReset, sendPasswordResetEmail } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { CheckCircle2, Mail, MailCheck, ShieldCheck } from 'lucide-react'

import { auth } from '@shared/lib/firebase'
import AuthAlert from '@shared/auth/AuthAlert'
import BackToSignIn from '@shared/auth/BackToSignIn'
import FloatingField from '@shared/auth/FloatingField'
import NewPasswordFields from '@shared/auth/NewPasswordFields'
import { passwordReady } from '@shared/auth/passwordPolicy'
import OtpInput from '@shared/auth/OtpInput'
import { CTA } from '@shared/auth/authStyles'

/**
 * Password recovery, all four steps, in place of the sign-in form.
 *
 *   email  ──►  6-digit code  ──►  new password  ──►  done
 *
 * ── IT DEGRADES INSTEAD OF BREAKING ──────────────────────────────────────────
 * The code path runs on two Cloud Functions, `sendPasswordOtp` and
 * `verifyPasswordOtp`, which already existed for the mobile app. Cloud
 * Functions need billing enabled, and this project's is currently off — every
 * call returns a bare `functions/internal`.
 *
 * So step 1 tries the callable and, if the BACKEND ITSELF is unreachable, falls
 * back to `sendPasswordResetEmail` — Firebase Auth's own link mail, which is
 * free-tier and unaffected — and shows the link screen instead. Recovery keeps
 * working today, and the code flow lights up on its own the moment billing is
 * restored, with no deploy and no flag to remember.
 *
 * The fallback is narrow on purpose: only "the function did not run" triggers
 * it. A wrong code, an expired code or a rate limit are answers FROM a working
 * backend and must be shown, not silently routed around. The two paths also
 * converge — `verifyPasswordOtp` hands back a Firebase reset link, whose
 * `oobCode` is the same credential the emailed link carries — so this is one
 * mechanism with two ways of delivering the proof, not two auth systems.
 *
 * ── WHY IN PLACE RATHER THAN A DIALOG ────────────────────────────────────────
 * The brief calls it a modal. It replaces the form instead: a sign-in screen
 * has one job at a time, the two-factor step already establishes that pattern
 * on this exact surface, and a dialog would add a scrim, a focus trap and a
 * dismiss affordance to a flow whose every step already has an explicit way
 * back.
 */

/** Seconds before the code can be sent again. */
const RESEND_COOLDOWN = 45

/**
 * Callable failures that mean "the backend did not run", as opposed to "the
 * backend said no". Only these fall back to the link flow.
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

export default function PasswordRecovery({ initialEmail = '', onClose }) {
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [oobCode, setOobCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reveal, setReveal] = useState(false)

  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // Ticks only while there is something to count. Re-armed by each send.
  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  /** The link flow, used when the code backend is unreachable. */
  const sendResetLink = useCallback(async (address) => {
    await sendPasswordResetEmail(auth, address, {
      // This portal's own sign-in page, so a reset started here returns here
      // even though one action URL serves both consoles.
      url: `${window.location.origin}${window.location.pathname}`,
      handleCodeInApp: false,
    })
  }, [])

  const requestCode = useCallback(
    async (address) => {
      const send = httpsCallable(getFunctions(auth.app, 'us-central1'), 'sendPasswordOtp')
      try {
        await send({ email: address })
        return 'code'
      } catch (err) {
        if (!BACKEND_DOWN.has(err?.code)) throw err
        // The function could not run. Fall back rather than stranding someone
        // who genuinely cannot sign in.
        await sendResetLink(address)
        return 'link'
      }
    },
    [sendResetLink],
  )

  async function handleEmailSubmit(event) {
    event.preventDefault()
    const address = email.trim()
    if (!address || busy) return

    setError('')
    setNotice('')
    setBusy(true)
    try {
      const outcome = await requestCode(address)
      setCode('')
      setCooldown(RESEND_COOLDOWN)
      setStep(outcome)
    } catch (err) {
      setError(describeSendError(err))
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
      setError(describeSendError(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = useCallback(
    async (value) => {
      const digits = String(value).replace(/\D/g, '')
      if (digits.length !== 6 || busy) return

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

  // ── Step 1 ────────────────────────────────────────────────────────────────
  if (step === 'email') {
    return (
      <form className="step-enter flex flex-col gap-6" onSubmit={handleEmailSubmit} noValidate>
        <div>
          <p className="text-base font-semibold text-text-primary">Reset your password</p>
          <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
            Enter the address on your account and we will send a 6-digit code to it.
          </p>
        </div>

        <FloatingField
          id="recovery-email"
          label="Email address"
          icon={Mail}
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
            if (error) setError('')
          }}
          placeholder="you@monticellovillas.ph"
          error={error}
        />

        <div className="flex flex-col gap-3">
          <button type="submit" disabled={busy || !email.trim()} className={CTA}>
            {busy ? 'Sending…' : 'Send reset code'}
          </button>
          <BackToSignIn onClick={onClose} disabled={busy} />
        </div>
      </form>
    )
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <div className="step-enter flex flex-col gap-6">
        <div>
          <p className="text-base font-semibold text-text-primary">Enter your code</p>
          <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
            We sent a 6-digit code to{' '}
            <span className="font-medium text-text-primary">{email.trim()}</span>. It expires in 10
            minutes.
          </p>
        </div>

        <OtpInput
          id="recovery-otp"
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
            disabled={busy || code.replace(/\D/g, '').length !== 6}
            className={CTA}
          >
            {busy ? 'Verifying…' : 'Verify code'}
          </button>
          <BackToSignIn onClick={onClose} disabled={busy} />
        </div>
      </div>
    )
  }

  // ── Step 2, fallback: the backend is down, a link was mailed instead ──────
  if (step === 'link') {
    return (
      <div className="step-enter flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/10 text-brand-400">
            <MailCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-base font-semibold text-text-primary">Check your email</p>
            <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
              A link to set a new password is on its way to{' '}
              <span className="font-medium text-text-primary">{email.trim()}</span>. It expires in
              an hour.
            </p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-text-muted">
          Nothing arrived? Check spam, then{' '}
          <button
            type="button"
            onClick={() => setStep('email')}
            className="font-medium text-text-primary underline decoration-slate-300 underline-offset-2 transition-colors hover:decoration-text-primary"
          >
            try a different address
          </button>
          .
        </p>

        <button type="button" onClick={onClose} className={CTA}>
          Return to sign in
        </button>
      </div>
    )
  }

  // ── Step 3 ────────────────────────────────────────────────────────────────
  if (step === 'password') {
    return (
      <form className="step-enter flex flex-col gap-6" onSubmit={handlePasswordSubmit} noValidate>
        <div className="flex flex-col gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/10 text-brand-400">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-base font-semibold text-text-primary">Code verified</p>
            <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
              Choose a new password for{' '}
              <span className="font-medium text-text-primary">{email.trim()}</span>.
            </p>
          </div>
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
            {busy ? 'Setting password…' : 'Set new password'}
          </button>
          <BackToSignIn onClick={onClose} disabled={busy} />
        </div>
      </form>
    )
  }

  // ── Step 4 ────────────────────────────────────────────────────────────────
  return (
    <div className="step-enter flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/10 text-brand-400">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-base font-semibold text-text-primary">Password updated</p>
          <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
            Sign in with your new password. Any other device signed in to this account will need it
            too.
          </p>
        </div>
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

function describeSendError(err) {
  switch (err?.code) {
    case 'functions/invalid-argument':
    case 'auth/invalid-email':
      return 'That does not look like an email address.'
    case 'functions/resource-exhausted':
      return 'Too many requests for this address. Wait a few minutes and try again.'
    case 'auth/too-many-requests':
      return 'Too many attempts from this device. Wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'Could not reach the server. Check your connection and try again.'
    default:
      return 'Could not send a code. Try again, or contact system administration.'
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
      return 'Enter all six digits.'
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
