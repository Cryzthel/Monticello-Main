import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { sendPasswordResetEmail } from 'firebase/auth'
import {
  ShieldAlert, Eye, EyeOff, AtSign, Lock, Loader2, CheckCircle2, KeyRound, ArrowLeft,
} from 'lucide-react'

import { auth } from '@shared/lib/firebase'
import { useAuth } from '@shared/auth/AuthContext'
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
 * SCOPE: FIELDS AND ACTIONS ONLY. The brand mark, title and small-caps
 * sub-label moved up into LoginLayout when the split panel became a single
 * card — they are the card's header, and a component named LoginForm rendering
 * a wordmark was the seam that let the two consoles' headers drift apart.
 *
 * Everything below assumes the dark-pinned subtree LoginLayout establishes, so
 * every token here resolves to its dark value under either theme. Nothing
 * needs a `dark:` variant and nothing needs a literal hex.
 */

/**
 * One labelled field: label above, a pill well below holding a leading icon,
 * the input, and an optional trailing control.
 *
 * `focus-within` is on the WELL rather than `:focus` on the input, so the
 * icon, border, fill and ring all light up as a single control instead of a
 * ring appearing around a box that happens to contain a glyph.
 */
function Field({ id, label, icon: Icon, trailing, inputClassName = '', ...inputProps }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-medium text-text-secondary">
        {label}
      </label>
      {/* Matches `.field` in the design system — a flat bordered box at the
          6px corner, no inset, no fill trickery. It is spelled out here rather
          than reusing the class because `.field` styles the <input> itself,
          and this wraps the input together with a leading icon and a trailing
          toggle: the border has to be on the WRAPPER or the icons sit outside
          the shape they belong to.

          Focus moves the border to the accent AND adds a ring — the same pair
          `.field` uses, so this hand-built field and every generated one
          answer focus identically. */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-field px-3 transition-colors duration-150 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25">
        <Icon className="h-4 w-4 shrink-0 text-text-muted" />
        <input
          id={id}
          className={`min-w-0 flex-1 bg-transparent py-3 text-sm text-text-primary outline-none placeholder:text-text-muted ${inputClassName}`}
          {...inputProps}
        />
        {trailing}
      </div>
    </div>
  )
}

export default function LoginForm({
  emailPlaceholder,
  submitLabel,
  /** Where a successful sign-in lands when there is no deep link to resume. */
  fallbackPath,
  /** 'brand' (admin blue) or 'info' (guardhouse sky). Styling only. */
  accent = 'brand',
}) {
  const { login, completeSecondFactor, rejection, setRejection } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Set when the password was accepted and an authenticator code is due.
  // Holds Firebase's resolver; no session exists until the code verifies.
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')

  // The accent applies to two small marks and nothing else. The CTA stays
  // emerald in BOTH portals on purpose: the brief asks for identical geometry
  // and styling across the two consoles, and the primary action is the loudest
  // element on the card — swapping its hue per portal would make the pair read
  // as two products rather than as two doors into one.
  const accentLink =
    accent === 'info' ? 'text-info hover:text-info/80' : 'text-brand-400 hover:text-brand-300'
  const accentCheckbox = accent === 'info' ? 'accent-info' : 'accent-brand-500'

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
    setNotice('')
    setSubmitting(true)

    try {
      // No portal check here any more. AuthProvider signs a wrong-portal
      // account back out before login() resolves, so reaching this line means
      // the session is valid FOR THIS APP — there is no second, weaker sense
      // of "signed in" left to defend against.
      await login(email, password)
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

  /**
   * Sends a real Firebase password-reset email rather than being a decorative
   * link. There is no separate reset page in this portal, so a `href="#"` here
   * would be a dead control on a security-critical screen.
   */
  async function handleForgotPassword() {
    setError('')
    setNotice('')

    const address = email.trim()
    if (!address) {
      setError('Enter your email address first, then choose Forgot password.')
      return
    }

    try {
      await sendPasswordResetEmail(auth, address)
      setNotice(`Reset link sent to ${address}. Check your inbox.`)
    } catch (err) {
      // Deliberately not surfacing "user-not-found": confirming which
      // addresses have staff accounts would leak the roster to anyone who can
      // load this page. A generic confirmation is the correct response either
      // way, so only genuinely actionable failures are shown.
      if (err.code === 'auth/user-not-found') {
        setNotice(`Reset link sent to ${address}. Check your inbox.`)
        return
      }
      setError(err.message ?? 'Could not send a reset link. Try again.')
    }
  }

  if (challenge) {
    return (
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          verifyCode()
        }}
        noValidate
      >
        <div className="step-enter">
          <p className="text-sm font-semibold text-text-primary">Two-step verification</p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            Open your authenticator app and enter the 6-digit code for{' '}
            <span className="font-medium text-text-primary">{email}</span>.
          </p>
        </div>

        <Field
          id="totp-code"
          label="Authentication code"
          icon={KeyRound}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          autoFocus
          required
          value={code}
          aria-invalid={error ? 'true' : undefined}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d ]/g, '')
            setCode(next)
            // Submits on the sixth digit — the code is the whole form, and
            // an authenticator code is only good for the next few seconds.
            if (normaliseCode(next).length === 6) verifyCode(next)
          }}
          placeholder="000 000"
          inputClassName="font-mono tracking-[0.3em]"
        />

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || normaliseCode(code).length !== 6}
          className="btn btn-brand mt-1 h-12 w-full text-label disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Verifying…
            </>
          ) : (
            'Verify and sign in'
          )}
        </button>

        <button
          type="button"
          onClick={leaveCodeStep}
          disabled={submitting}
          className={`inline-flex items-center justify-center gap-1.5 self-center text-xs font-medium transition ${accentLink}`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Use a different account
        </button>
      </form>
    )
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
      {/* AtSign rather than Mail: the brief names an `@` glyph, and it is the
          more literal cue for "this field takes an address" than an envelope,
          which reads as "we will send you something". */}
      <Field
        id="email"
        label="Email address"
        icon={AtSign}
        type="email"
        required
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={emailPlaceholder}
      />

      <Field
        id="password"
        label="Password"
        icon={Lock}
        type={showPassword ? 'text' : 'password'}
        required
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
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
            className={`h-4 w-4 rounded-lg border-slate-200 bg-base-800 ${accentCheckbox}`}
          />
          Remember me
        </label>
        <button
          type="button"
          onClick={handleForgotPassword}
          className={`text-xs font-medium transition ${accentLink}`}
        >
          Forgot password?
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{notice}</span>
        </div>
      ) : null}

      {/* The only filled control on the card, so it reads as the single
          primary action. Same brand-cta fill as every other CTA in the
          product; it keeps its own h-12 because a login button is deliberately
          one step louder than the in-app button scale.

          The label was `uppercase` with wide tracking. Both are gone: the
          brief removes ALL-CAPS from every title and label, and a shouted CTA
          is the loudest example of it on either console. */}
      <button
        type="submit"
        disabled={submitting}
        className="btn btn-brand mt-1 h-12 w-full text-label disabled:opacity-60"
      >
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
