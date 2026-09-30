import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { CheckCircle2, ShieldAlert } from 'lucide-react'

import { auth } from '@shared/lib/firebase'
import AuthAlert from '@shared/auth/AuthAlert'
import BackToSignIn from '@shared/auth/BackToSignIn'
import LoginSplitLayout from '@shared/auth/LoginSplitLayout'
import NewPasswordFields from '@shared/auth/NewPasswordFields'
import { passwordReady } from '@shared/auth/passwordPolicy'
import { CTA } from '@shared/auth/authStyles'

/**
 * Password recovery, steps 3 and 4: choose the new password, confirm it took.
 *
 * Reached by opening the link mailed in step 1 — see PasswordRecovery — which
 * carries Firebase's one-time `oobCode` in the query string. Steps 1-2 and 3-4
 * are deliberately different surfaces because they happen at different times,
 * often on different devices.
 *
 * ── THIS NEEDS ONE SETTING IN THE FIREBASE CONSOLE ───────────────────────────
 * Authentication → Templates → Password reset → the pencil → "Customize action
 * URL" → point it at `https://<this portal's domain>/reset-password`.
 *
 * Without it Firebase's own hosted page handles the code and this route is
 * simply never reached — nothing breaks, the reset still works, it just does
 * not look like the product. With it, this page does the whole job, using only
 * the client SDK: `verifyPasswordResetCode` to check the link before showing a
 * form, `confirmPasswordReset` to set the password. No Cloud Function, which
 * matters because this project cannot currently deploy them.
 *
 * ── WHY THE CODE IS VERIFIED BEFORE THE FORM IS SHOWN ────────────────────────
 * A reset link can be expired, already used, or for an account that has since
 * been disabled. Verifying first means an unusable link says so immediately,
 * instead of letting someone choose and confirm a password and only then
 * telling them it was never going to work. It also yields the account's email,
 * which is worth showing: these links get forwarded and opened on shared
 * machines, and "you are setting the password for X" is the only confirmation
 * the person gets that they are resetting the account they meant to.
 */

/*
 * The rules, the meter and the match check live in NewPasswordFields, which
 * this screen and the OTP flow both render. They were duplicated here first,
 * and two copies of a password policy is two places for it to drift — with the
 * copy nobody is looking at being the one that does.
 */

/**
 * How long step 4 waits before returning to sign-in on its own.
 *
 * It returns automatically because the person's next action is always the same
 * one, and a success screen that waits for a click is a screen someone leaves
 * open on a shared machine. The count is shown rather than silent: an interface
 * that navigates without warning feels like it crashed.
 */
const REDIRECT_SECONDS = 5

export default function ResetPasswordPage({ loginPath, illustration }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const oobCode = params.get('oobCode') ?? ''

  /*
   * Where to send the person afterwards.
   *
   * Firebase appends `continueUrl` from the `actionCodeSettings` the sending
   * portal supplied — see PasswordRecovery — so this is how a guardhouse reset
   * handled by a page hosted on the admin origin knows to return the guard to
   * the guardhouse.
   *
   * ── IT IS ALLOWLISTED, AND THE OBVIOUS REASONING FOR NOT DOING SO IS WRONG ──
   * The tempting argument is that Firebase only puts domains from the project's
   * Authorized domains list into the emails it sends, so the value is already
   * vetted. That is true of the email and irrelevant here: this page reads the
   * query string of whatever URL the browser is pointed at. Anyone can write
   *
   *     https://<portal>/reset-password?oobCode=…&continueUrl=https://evil.tld
   *
   * and send it to a member of staff. Firebase is not in that loop at all.
   * Following it would hand an attacker a redirect off a security console at
   * the exact moment the victim has just changed their password and is primed
   * to type it again — a working phishing hop, shipped by us.
   *
   * So: same origin is always fine, and any OTHER origin has to be named in
   * `VITE_AUTH_RETURN_ORIGINS`. That variable is how the two consoles learn
   * about each other without either bundle hardcoding the other's address —
   * config rather than code, which is the property config/portal.js is
   * protecting when it says this app must not know the guardhouse's origin.
   */
  const continueUrl = useMemo(() => {
    const raw = params.get('continueUrl')
    if (!raw) return null
    let parsed
    try {
      parsed = new URL(raw, window.location.origin)
    } catch {
      return null
    }
    // Blocks `javascript:`, `data:` and friends before anything else looks at it.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.origin === window.location.origin) return parsed.href

    const allowed = String(import.meta.env.VITE_AUTH_RETURN_ORIGINS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return allowed.includes(parsed.origin) ? parsed.href : null
  }, [params])

  /** Leave for wherever the reset came from, or this portal's sign-in. */
  const returnToSignIn = () => {
    if (continueUrl) {
      window.location.assign(continueUrl)
      return
    }
    navigate(loginPath, { replace: true })
  }

  const [account, setAccount] = useState(null)
  const [checking, setChecking] = useState(true)
  const [linkError, setLinkError] = useState('')

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reveal, setReveal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS)

  const ready = passwordReady(password, confirmation) && !submitting

  // Verify the link before rendering a form against it.
  useEffect(() => {
    let cancelled = false
    if (!oobCode) {
      setChecking(false)
      setLinkError('This link is missing its reset code. Request a new one from the sign-in page.')
      return undefined
    }
    verifyPasswordResetCode(auth, oobCode)
      .then((email) => {
        if (!cancelled) setAccount(email)
      })
      .catch(() => {
        if (!cancelled) {
          setLinkError('This reset link has expired or has already been used. Request a new one.')
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [oobCode])

  // Runs only once `done`, so it cannot fire while someone is still typing.
  useEffect(() => {
    if (!done) return undefined
    if (countdown <= 0) {
      returnToSignIn()
      return undefined
    }
    const timer = setTimeout(() => setCountdown((n) => n - 1), 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, countdown])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!ready) return
    setError('')
    setSubmitting(true)
    try {
      await confirmPasswordReset(auth, oobCode, password)
      setDone(true)
    } catch (err) {
      if (err?.code === 'auth/weak-password') {
        setError('Firebase rejected that password as too weak. Try a longer one.')
      } else if (err?.code === 'auth/expired-action-code' || err?.code === 'auth/invalid-action-code') {
        setLinkError('This reset link has expired or has already been used. Request a new one.')
      } else {
        setError(err?.message ?? 'Could not set the password. Try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const body = () => {
    if (checking) {
      return <p className="text-sm text-text-muted">Checking your link…</p>
    }

    if (linkError) {
      return (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold text-text-primary">Link no longer valid</p>
              <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{linkError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={returnToSignIn}
            className={CTA}
          >
            Back to sign in
          </button>
        </div>
      )
    }

    if (done) {
      return (
        <div className="step-enter flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold text-text-primary">Password updated</p>
              <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
                Sign in with your new password. Any other device that was signed in to this
                account will need it too.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={returnToSignIn}
              className={CTA}
            >
              Return to sign in
            </button>
            <p className="text-center text-xs text-text-muted" aria-live="polite">
              Taking you back in {countdown}s…
            </p>
          </div>
        </div>
      )
    }

    return (
      <form className="step-enter flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
        {account ? (
          <p className="text-sm leading-relaxed text-text-muted">
            Setting a new password for{' '}
            <span className="font-medium text-text-primary">{account}</span>.
          </p>
        ) : null}

        <NewPasswordFields
          password={password}
          confirmation={confirmation}
          reveal={reveal}
          disabled={submitting}
          onPasswordChange={setPassword}
          onConfirmationChange={setConfirmation}
          onToggleReveal={() => setReveal((prev) => !prev)}
        />

        <AuthAlert tone="error">{error}</AuthAlert>

        <div className="flex flex-col gap-3">
          <button type="submit" disabled={!ready} className={CTA}>
            {submitting ? 'Setting password…' : 'Set new password'}
          </button>
          <BackToSignIn onClick={returnToSignIn} disabled={submitting} />
        </div>
      </form>
    )
  }

  return (
    <LoginSplitLayout
      title="Choose a new password"
      description="One more step and you are back in."
      illustration={illustration}
    >
      {body()}
    </LoginSplitLayout>
  )
}
