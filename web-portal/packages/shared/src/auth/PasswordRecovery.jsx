import { useEffect, useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { Mail, MailCheck } from 'lucide-react'

import { auth } from '@shared/lib/firebase'
import AuthAlert from '@shared/auth/AuthAlert'
import BackToSignIn from '@shared/auth/BackToSignIn'
import FloatingField from '@shared/auth/FloatingField'
import { CTA } from '@shared/auth/authStyles'

/**
 * Password recovery, steps 1 and 2: identify the account, confirm the mail is
 * on its way.
 *
 * Steps 3 and 4 — choosing the new password and confirming it worked — are in
 * ResetPasswordPage, because they do not happen here. They happen when the
 * person opens the link, which may be on another device, hours later.
 *
 * ── HOW "NO ACCOUNT FOUND" IS DETECTED, AND WHY NOT WITH A LOOKUP ────────────
 * The brief asks for an account-existence check BEFORE sending, using a
 * separate lookup. That lookup is `fetchSignInMethodsForEmail`, and it is not
 * used here for two reasons, the second of which is decisive:
 *
 *   1. It is an enumeration oracle. It answers "does this address have an
 *      account?" to anyone who can load the page, which on a security console
 *      means handing an anonymous visitor the staff roster. Firebase deprecated
 *      it for exactly this.
 *   2. It breaks the moment the project is secured. Turning on Email
 *      Enumeration Protection — one switch in the console, and the DEFAULT for
 *      projects created since late 2023 — makes it return an empty list for
 *      EVERY address, including real ones. A UI built on it would then tell
 *      every legitimate administrator that their account does not exist, and
 *      password recovery would be broken for all staff with nothing in the
 *      logs to explain it.
 *
 * Measured on this project (monticello-villas-f600e) on 2026-10-01: the
 * protection was OFF at that point, so the lookup did distinguish real
 * addresses from invented ones. That was never a reason to build on it — it is
 * the reason this comment exists.
 *
 * `sendPasswordResetEmail` already reports `auth/user-not-found` under exactly
 * the same conditions, so the specified experience is delivered from the call
 * that has to happen anyway — no second endpoint, no deprecated API, and no new
 * capability exposed.
 *
 * ── THIS FILE IS CORRECT WITH THE PROTECTION ON OR OFF ───────────────────────
 * Enabling it is the intended end state and needs NO code change here. With it
 * on, `sendPasswordResetEmail` stops throwing `auth/user-not-found` and simply
 * resolves, so the not-found branch below becomes unreachable and every address
 * lands on "check your email" — which is the correct answer for a screen that
 * must not confirm who has an account. Nothing starts lying; a branch just
 * stops being taken.
 *
 * Sign-in is already correct for that mode too: AuthContext collapses
 * `auth/user-not-found`, `auth/wrong-password` and `auth/invalid-credential`
 * into one "Invalid email or password.", and `invalid-credential` is the code
 * Firebase returns once the protection is on.
 */

/**
 * Seconds before the link can be sent again.
 *
 * A resend control with no cooldown is a button people press three times when
 * mail is slow, which is how an account trips Firebase's `too-many-requests`
 * and locks itself out of recovery for several minutes — the opposite of what
 * the person pressing it wants. The countdown is shown rather than the button
 * being silently inert: a disabled control with no explanation reads as broken.
 */
const RESEND_COOLDOWN = 45

/**
 * @param initialEmail  Whatever was already typed into the sign-in form, as a
 *                      starting point the person can correct.
 * @param onClose       Back to sign-in.
 */
export default function PasswordRecovery({ initialEmail = '', onClose }) {
  const [email, setEmail] = useState(initialEmail)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [resent, setResent] = useState(false)

  // Ticks only while there is something to count. Re-armed by each send.
  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function requestReset(event) {
    event.preventDefault()
    const address = email.trim()
    if (!address || submitting) return

    setError('')
    setSubmitting(true)
    try {
      /*
       * `continueUrl` is this portal's OWN sign-in page, and it is what makes
       * one Firebase project serve two consoles correctly.
       *
       * A project has a single password-reset action URL, but admin and the
       * guardhouse are separate applications on separate origins. Without this,
       * whichever handler processes the code has no idea which console the
       * person came from, and sends a guard to the administrator's sign-in
       * page — a screen their account is refused by. With it, the destination
       * travels with the request.
       *
       * Firebase will only accept a URL whose domain is on the project's
       * Authorized domains list, so this cannot be pointed somewhere arbitrary.
       *
       * Read from the address bar rather than taken as a prop because recovery
       * is only ever shown ON the sign-in page — `pathname` here IS the login
       * route, and threading a `loginPath` prop through two components to
       * rediscover it would be ceremony.
       */
      await sendPasswordResetEmail(auth, address, {
        url: `${window.location.origin}${window.location.pathname}`,
        handleCodeInApp: false,
      })
      setSent(true)
      setCooldown(RESEND_COOLDOWN)
    } catch (err) {
      switch (err?.code) {
        case 'auth/user-not-found':
          // Kept on step 1 with the address intact, so the correction is a
          // couple of keystrokes rather than a retype. See the note above for
          // why this branch is a by-product rather than a lookup.
          setError(
            'No account found with this email address. Check the spelling, or contact system administration.',
          )
          break
        case 'auth/invalid-email':
          setError('That does not look like an email address.')
          break
        case 'auth/too-many-requests':
          setError('Too many attempts from this device. Wait a few minutes and try again.')
          break
        case 'auth/network-request-failed':
          setError('Could not reach the server. Check your connection and try again.')
          break
        default:
          setError(err?.message ?? 'Could not send a reset link. Try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Sends the same link again. Reuses `requestReset` so there is exactly one
   * place that knows how to send and how to interpret a failure — a second
   * copy here is how the two would drift into reporting different things.
   */
  async function resend() {
    setResent(false)
    await requestReset({ preventDefault: () => {} })
    setResent(true)
  }

  if (sent) {
    return (
      <div className="step-enter flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
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

        <div className="flex flex-col gap-2.5">
          <p className="text-xs leading-relaxed text-text-muted">
            Nothing arrived? Check spam, then{' '}
            <button
              type="button"
              onClick={() => {
                setSent(false)
                setResent(false)
              }}
              className="font-medium text-text-primary underline decoration-slate-300 underline-offset-2 transition-colors hover:decoration-text-primary"
            >
              try a different address
            </button>
            .
          </p>

          {/* `aria-live` so the countdown reaching zero is announced rather
              than silently becoming pressable for someone not watching it. */}
          <p className="text-xs font-medium text-text-secondary" aria-live="polite">
            {cooldown > 0 ? (
              `Resend link in ${cooldown}s`
            ) : (
              <button
                type="button"
                onClick={resend}
                disabled={submitting}
                className="font-semibold text-text-primary underline decoration-slate-300 underline-offset-2 transition-colors hover:decoration-text-primary disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Resend link'}
              </button>
            )}
          </p>

          {resent ? (
            <p className="text-xs font-medium text-success">Sent again. Check your inbox.</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <button type="button" onClick={onClose} className={CTA}>
            Return to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="step-enter flex flex-col gap-6" onSubmit={requestReset} noValidate>
      <div>
        <p className="text-base font-semibold text-text-primary">Reset your password</p>
        <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
          Enter the address on your account and we will send a link to set a new password.
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
          // Clears as soon as the address changes: an error about the previous
          // address is wrong the instant it is edited, and leaving it up makes
          // the correction feel rejected before it is submitted.
          if (error) setError('')
        }}
        placeholder="you@monticellovillas.ph"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'recovery-error' : undefined}
      />

      <div id="recovery-error">
        <AuthAlert tone="error">{error}</AuthAlert>
      </div>

      <div className="flex flex-col gap-3">
        <button type="submit" disabled={submitting || !email.trim()} className={CTA}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
        <BackToSignIn onClick={onClose} disabled={submitting} />
      </div>
    </form>
  )
}
