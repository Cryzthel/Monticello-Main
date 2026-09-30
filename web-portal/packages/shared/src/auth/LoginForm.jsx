import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'

import { useAuth } from '@shared/auth/AuthContext'
import AuthAlert from '@shared/auth/AuthAlert'
import BackToSignIn from '@shared/auth/BackToSignIn'
import FloatingField from '@shared/auth/FloatingField'
import OtpInput from '@shared/auth/OtpInput'
import PasswordRecovery from '@shared/auth/PasswordRecovery'
import { CTA } from '@shared/auth/authStyles'
import { SecondFactorRequiredError, describeTwoFactorError, normaliseCode } from '@shared/lib/twoFactor'

/*
 * There is no cross-portal control on this form, and there is no longer a
 * portal picker behind it either.
 *
 * Staff are provisioned to ONE portal — a guard's account cannot sign in to
 * Admin and an administrator's cannot sign in to the Guardhouse — so a "wrong
 * portal?" link offered a route the credentials in the fields above could not
 * take. Each console is now its own application on its own origin, so the
 * other portal is not merely a different route: it is a different app, which
 * this one has no business linking to or knowing the address of.
 */

/**
 * The sign-in form, shared by both portal logins.
 *
 * Presentation and auth logic live here exactly once. Previously each portal
 * had its own 89-line copy of the same form, which is how they drifted apart in
 * the first place; the pages are now pure config.
 *
 * SCOPE: FIELDS AND ACTIONS ONLY. The brand mark, the heading and its
 * supporting line live in the shell (`LoginSplitLayout`), not here. That split
 * is load-bearing rather than tidy-minded: a component named LoginForm
 * rendering a wordmark is the exact seam that let the two consoles' headers
 * drift apart when each portal had its own copy of this file.
 *
 * ── THERE IS ONE PRESENTATION NOW ────────────────────────────────────────────
 * This file carried a `variant` prop with `standard` and `elevated` tables of
 * class names, from the release where only the admin console had the new
 * sign-in screen and the guardhouse still rendered the old card. The guardhouse
 * adopted the same screen, both call sites passed `elevated`, and `standard`
 * became a branch nothing could reach. It is gone, and with it the threading of
 * three className props through every field. Unifying the two portals was the
 * request; deleting the machinery that expressed their difference is what
 * actually delivers it.
 *
 * THEME: the shell pins light and this form inherits it, so every token below
 * resolves to its light value on the sign-in screen. Nothing here needs a
 * `dark:` variant and nothing needs a literal hex.
 */

/**
 * What the form checks before it is willing to call Firebase.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────
 * The form is `noValidate`, which switches OFF the browser's own enforcement of
 * the `required` attributes on the fields below. That is deliberate — native
 * validation bubbles are unstyleable, appear in the wrong place and read in the
 * browser's language rather than the product's — but turning it off without
 * replacing it is what produced this, shown to staff verbatim:
 *
 *     Firebase: Error (auth/missing-password).
 *
 * An empty password sailed past `required`, reached
 * `signInWithEmailAndPassword`, and came back as an SDK string.
 *
 * ── THE EMAIL CHECK IS DELIBERATELY SHALLOW ──────────────────────────────────
 * Non-empty, one `@`, something either side of it, no spaces. It is not trying
 * to decide whether an address is deliverable — that is unknowable here, and
 * every regex that claims to do it rejects addresses that are perfectly valid.
 * The only job is to stop an obviously malformed string becoming a round trip
 * and a generic failure; Firebase remains the authority on whether the account
 * exists.
 */
function validate({ email, password }) {
  const errors = {}
  const address = email.trim()

  if (!address) errors.email = 'Enter your email address.'
  else if (!/^[^\s@]+@[^\s@]+$/.test(address)) errors.email = 'That does not look like an email address.'

  if (!password) errors.password = 'Enter your password.'

  return errors
}

export default function LoginForm({
  emailPlaceholder,
  submitLabel,
  /** Where a successful sign-in lands when there is no deep link to resume. */
  fallbackPath,
}) {
  const { login, completeSecondFactor, rejection, setRejection } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  // Per-field, so "which one did I miss" is answered at the field rather than
  // in a banner that names it and makes the reader go looking.
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  // Set when the password was accepted and an authenticator code is due.
  // Holds Firebase's resolver; no session exists until the code verifies.
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  // Recovery replaces this form in place rather than opening over it. A login
  // screen has one job at a time, and the two-factor step below already
  // establishes that pattern — a modal here would be a second way of doing the
  // same thing on the same screen.
  const [recovering, setRecovering] = useState(false)

  /*
   * THE SAME EMERALD IN BOTH CONSOLES.
   *
   * This was a prop: admin passed `brand` and the guardhouse `info`, painting
   * the recovery link and the Remember-me tick sky blue on one screen and
   * emerald on the other. The idea was that the accent told an operator which
   * console they were looking at — but a sign-in screen already says so in the
   * heading, and what it actually produced was two screens that are identical
   * in every dimension except one link, which reads as a mistake rather than as
   * a signal.
   *
   * With one value left the prop was a knob nothing turned, so it is gone
   * rather than defaulted. `brand-400` is the design system's TEXT step of the
   * accent — #065F46 in light, 7.6:1 on white — not the fill step, because this
   * is ink on a white pane and the fill step is drawn to carry a label on top
   * of it, not to be read against a background.
   */
  const accentLink = 'text-brand-400 hover:text-brand-300'
  const accentCheckbox = 'accent-brand-500'

  // A session restored from storage that this portal does not accept is signed
  // out by AuthProvider before anything renders. Surfacing its reason here is
  // the difference between "you were signed out because X" and a login screen
  // that appeared for no stated reason.
  useEffect(() => {
    if (!rejection) return
    setError(rejection)
    setRejection('')
  }, [rejection, setRejection])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const problems = validate({ email, password })
    setFieldErrors(problems)
    if (Object.keys(problems).length > 0) {
      // Focus the first field with a problem. Without this the message appears
      // below the fold of a short window and the form looks like it did
      // nothing, which is how people end up pressing the button repeatedly.
      document.getElementById(problems.email ? 'email' : 'password')?.focus()
      return
    }

    setSubmitting(true)

    try {
      // No portal check here any more. AuthProvider signs a wrong-portal
      // account back out before login() resolves, so reaching this line means
      // the session is valid FOR THIS APP — there is no second, weaker sense
      // of "signed in" left to defend against.
      await login(email.trim(), password, { remember: rememberMe })
      navigate(location.state?.from?.pathname ?? fallbackPath, { replace: true })
    } catch (err) {
      if (err instanceof SecondFactorRequiredError) {
        setChallenge(err.resolver)
        setCode('')
        return
      }
      setError(err.message ?? 'Unable to sign in. Please check your credentials.')
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyCode(value = code) {
    const digits = normaliseCode(value)
    if (digits.length !== 6 || submitting) return
    setError('')
    setSubmitting(true)
    try {
      await completeSecondFactor(challenge, digits)
      navigate(location.state?.from?.pathname ?? fallbackPath, { replace: true })
    } catch (err) {
      setError(describeTwoFactorError(err))
      setCode('')
      // A resolver is single-session: once it has expired, only a fresh
      // password step can produce another.
      if (err?.code === 'auth/multi-factor-session-expired' || err?.code === 'auth/code-expired') {
        setChallenge(null)
        setPassword('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function leaveCodeStep() {
    setChallenge(null)
    setCode('')
    setPassword('')
    setError('')
  }

  if (recovering) {
    return (
      <PasswordRecovery
        initialEmail={email}
        onClose={() => {
          setRecovering(false)
          // Both cleared on the way back. The error belonged to a sign-in
          // attempt the person has since abandoned, and a password typed before
          // they went looking for the reset link is one they have just told us
          // they do not remember — leaving either behind is the "broken form
          // state" that switching views is supposed to avoid.
          setError('')
          setPassword('')
          setFieldErrors({})
        }}
      />
    )
  }

  if (challenge) {
    return (
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          verifyCode()
        }}
        noValidate
      >
        <div className="step-enter">
          <p className="text-sm font-semibold text-text-primary" id="totp-code-label">
            Two-step verification
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
            Open your authenticator app and enter the 6-digit code for{' '}
            <span className="font-medium text-text-primary">{email}</span>.
          </p>
        </div>

        {/* Six boxes rather than one wide-tracked text input: the code has a
            shape, and OtpInput gives it the auto-advance, per-digit backspace
            and whole-code paste that every authenticator prompt people have
            used already does. */}
        <OtpInput
          id="totp-code"
          value={code}
          invalid={Boolean(error)}
          disabled={submitting}
          autoFocus
          onChange={setCode}
          // Submits on the sixth digit — the code is the whole form, and an
          // authenticator code is only good for the next few seconds.
          onComplete={verifyCode}
        />

        <AuthAlert tone="error">{error}</AuthAlert>

        <div className="flex flex-col gap-3">
          <button type="submit" disabled={submitting || normaliseCode(code).length !== 6} className={CTA}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying…
              </>
            ) : (
              'Verify and sign in'
            )}
          </button>

          <BackToSignIn
            onClick={leaveCodeStep}
            disabled={submitting}
            label="Use a different account"
          />
        </div>
      </form>
    )
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
      {/* `gap-6` rather than the `gap-5` this had with rectangular fields. The
          floating label needs room above each well to sit on the border without
          crowding the control above it. */}
      <FloatingField
        id="email"
        label="Email address"
        icon={Mail}
        type="email"
        required
        autoComplete="email"
        autoFocus
        filled={Boolean(email)}
        error={fieldErrors.email}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value)
          if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }))
        }}
        placeholder={emailPlaceholder}
      />

      <FloatingField
        id="password"
        label="Password"
        icon={Lock}
        type={showPassword ? 'text' : 'password'}
        required
        autoComplete="current-password"
        filled={Boolean(password)}
        error={fieldErrors.password}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value)
          if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }))
        }}
        placeholder="Enter your password"
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="shrink-0 rounded-full p-1.5 text-text-muted transition-colors duration-150 hover:bg-tint/10 hover:text-text-primary"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer select-none items-center gap-2.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className={`h-4 w-4 rounded border-slate-200 bg-base-800 ${accentCheckbox}`}
          />
          Remember me
        </label>
        {/* Opens the recovery step rather than sending a mail from here. The
            old behaviour fired `sendPasswordResetEmail` against whatever was in
            the email box — a field filled in to SIGN IN, not to recover — so a
            typo mailed a stranger and said "check your inbox". */}
        <button
          type="button"
          onClick={() => setRecovering(true)}
          className={`text-xs font-medium transition ${accentLink}`}
        >
          Forgot password?
        </button>
      </div>

      <AuthAlert tone="error">{error}</AuthAlert>

      <button type="submit" disabled={submitting} className={CTA}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          submitLabel
        )}
      </button>
    </form>
  )
}
