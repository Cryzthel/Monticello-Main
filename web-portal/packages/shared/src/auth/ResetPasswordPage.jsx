import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldAlert } from 'lucide-react'

import { auth } from '@shared/lib/firebase'
import AuthAlert from '@shared/auth/AuthAlert'
import BackToSignIn from '@shared/auth/BackToSignIn'
import LoginSplitLayout from '@shared/auth/LoginSplitLayout'
import FloatingField from '@shared/auth/FloatingField'
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

/**
 * Password rules, in the order they are shown.
 *
 * Length first because it is the one that actually matters — every additional
 * character multiplies the search space, while the character-class rules mostly
 * push people towards `Password1!`. The classes are kept because the product's
 * own accounts are provisioned by an administrator and a shared floor is worth
 * having, but the meter below weights length heaviest for the same reason.
 */
const RULES = [
  { id: 'length', label: 'At least 10 characters', test: (v) => v.length >= 10 },
  { id: 'case', label: 'Upper and lower case', test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: 'number', label: 'A number', test: (v) => /\d/.test(v) },
  { id: 'symbol', label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
]

const STRENGTH = [
  { label: 'Too short', bar: 'w-1/4 bg-danger', text: 'text-danger' },
  { label: 'Weak', bar: 'w-2/4 bg-warning', text: 'text-warning' },
  { label: 'Good', bar: 'w-3/4 bg-info', text: 'text-info' },
  { label: 'Strong', bar: 'w-full bg-success', text: 'text-success' },
]

function scoreOf(value) {
  if (!value) return -1
  const passed = RULES.filter((rule) => rule.test(value)).length
  // Length is a gate, not one vote among four: nothing counts as more than
  // "weak" until it is long enough, however many symbols it has.
  if (!RULES[0].test(value)) return 0
  return Math.min(STRENGTH.length - 1, Math.max(1, passed - 1))
}

/**
 * How long step 4 waits before returning to sign-in on its own.
 *
 * It returns automatically because the person's next action is always the same
 * one, and a success screen that waits for a click is a screen someone leaves
 * open on a shared machine. Five seconds is long enough to read the sentence
 * that matters — other devices will need the new password too — and the button
 * is there the whole time for anyone who does not want to wait. The count is
 * shown rather than silent: an interface that navigates without warning feels
 * like it crashed.
 */
const REDIRECT_SECONDS = 5

export default function ResetPasswordPage({ loginPath, illustration }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const oobCode = params.get('oobCode') ?? ''

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

  const score = useMemo(() => scoreOf(password), [password])
  const mismatch = confirmation.length > 0 && confirmation !== password
  const ready = score >= 1 && password === confirmation && !submitting

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
      navigate(loginPath, { replace: true })
      return undefined
    }
    const timer = setTimeout(() => setCountdown((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [done, countdown, navigate, loginPath])

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
            onClick={() => navigate(loginPath, { replace: true })}
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
              onClick={() => navigate(loginPath, { replace: true })}
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

        <div className="flex flex-col gap-5">
          <FloatingField
            id="new-password"
            label="New password"
            icon={Lock}
            type={reveal ? 'text' : 'password'}
            required
            autoComplete="new-password"
            autoFocus
            filled={Boolean(password)}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 10 characters"
            trailing={
              <button
                type="button"
                onClick={() => setReveal((prev) => !prev)}
                className="shrink-0 rounded-full p-1.5 text-text-muted transition-colors duration-150 hover:bg-tint/10 hover:text-text-primary"
                aria-label={reveal ? 'Hide password' : 'Show password'}
                aria-pressed={reveal}
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          {/* The meter is `aria-hidden` and the rule list carries the real
              message: a coloured bar communicates nothing to a screen reader,
              and the same information is already spelled out beneath it. */}
          {password ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <div
                  className="h-1 flex-1 overflow-hidden rounded-full bg-base-800"
                  aria-hidden="true"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-300 ease-out ${
                      STRENGTH[Math.max(0, score)].bar
                    }`}
                  />
                </div>
                <span className={`text-xs font-medium ${STRENGTH[Math.max(0, score)].text}`}>
                  {STRENGTH[Math.max(0, score)].label}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {RULES.map((rule) => {
                  const met = rule.test(password)
                  return (
                    <li
                      key={rule.id}
                      className={`flex items-center gap-2 text-xs transition-colors duration-200 ${
                        met ? 'text-success' : 'text-text-muted'
                      }`}
                    >
                      <CheckCircle2
                        className={`h-3.5 w-3.5 shrink-0 ${met ? 'opacity-100' : 'opacity-30'}`}
                      />
                      {rule.label}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          <FloatingField
            id="confirm-password"
            label="Confirm password"
            icon={KeyRound}
            type={reveal ? 'text' : 'password'}
            required
            autoComplete="new-password"
            filled={Boolean(confirmation)}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="Type it again"
            aria-invalid={mismatch ? 'true' : undefined}
          />
          {mismatch ? (
            <p role="alert" className="-mt-2 text-xs font-medium text-danger">
              The two passwords do not match yet.
            </p>
          ) : null}
        </div>

        <AuthAlert tone="error">{error}</AuthAlert>

        <div className="flex flex-col gap-3">
          <button type="submit" disabled={!ready} className={CTA}>
            {submitting ? 'Setting password…' : 'Set new password'}
          </button>
          <BackToSignIn
            onClick={() => navigate(loginPath, { replace: true })}
            disabled={submitting}
          />
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
