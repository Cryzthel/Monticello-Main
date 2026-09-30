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
 * SCOPE: FIELDS AND ACTIONS ONLY. The brand mark, the heading and its
 * supporting line live in the shell (`LoginSplitLayout`), not here. That split
 * is load-bearing rather than tidy-minded: a component named LoginForm
 * rendering a wordmark is the exact seam that let the two consoles' headers
 * drift apart when each portal had its own copy of this file.
 *
 * THEME: the shell pins light and this form inherits it, so every token below
 * resolves to its light value on the sign-in screen. Nothing here needs a
 * `dark:` variant and nothing needs a literal hex — which is also why this same
 * file renders correctly if it is ever mounted somewhere that does follow the
 * theme. (An earlier version of this note claimed the opposite, from when the
 * login was pinned DARK; the pin flipped and the note did not.)
 */

/**
 * THE TWO PRESENTATIONS OF THIS FORM.
 *
 * `standard` is the guardhouse's, unchanged and byte-identical to what it has
 * always rendered. `elevated` is the admin split-card screen's, and the two
 * lines below are the WHOLE difference — there is no third branch anywhere in
 * this file, which is the point of collecting them here rather than threading
 * a className through every call site.
 *
 * ── ON THE ALL-CAPS FIELD LABELS ─────────────────────────────────────────────
 * `uppercase` on the elevated labels is a DELIBERATE, SCOPED exception to rule
 * 6 of the design system ("nothing is set in all caps; a `uppercase` utility in
 * this codebase is a regression"), taken by request for this one screen. Two
 * things make it defensible rather than a quiet violation:
 *
 *   · It is `text-transform`, not caps typed into the DOM. The accessible name
 *     stays "Email address", so a screen reader reads the words instead of
 *     spelling them — which was the real objection behind the rule, and the
 *     one the system's own note records.
 *   · It cannot leak. The guardhouse reads `standard` and is unaffected, and
 *     anything new that wants this look has to ask for it by name.
 *
 * The two values that make caps read as a refined micro-label rather than as
 * shouting, and neither is optional:
 *
 *   · 11px (`text-caption`), not 12px. Caps occupy more optical space than
 *     lowercase at the same size — no descenders, every glyph at cap height —
 *     so a 12px caps label sits visually level with the 14px input text it
 *     introduces and competes with it. One step down restores the hierarchy.
 *   · 0.09em tracking, up from Tailwind's `tracking-wider` (0.05em). Inter's
 *     spacing is drawn for mixed case; caps set at text spacing crowd, and the
 *     smaller the label the more it needs. This is the whole difference
 *     between a label that looks typeset and one that looks like a shout.
 */
const LABEL_CLASS = {
  standard: 'text-xs font-medium text-text-secondary',
  elevated: 'text-caption font-semibold uppercase tracking-[0.09em] text-text-secondary',
}

/**
 * The submit button, per presentation.
 *
 * Both are `.btn .btn-brand`, so the fill, the hover, the 150ms
 * `--ease-out-strong` transition and the 0.97 press scale are the design
 * system's and stay identical between the consoles. `elevated` overrides only
 * the shape: a 12px corner instead of 8px, `py-3` instead of a fixed 48px row,
 * and a semibold label.
 *
 * `.btn`'s own transition is kept rather than the brief's `transition-all`,
 * which is the one detail here worth stating: `transition-all` also animates
 * layout properties, so a button that reflows — a label swapping to "Signing
 * in…", an error banner appearing above it — animates its own width and height
 * on a 150ms curve. The enumerated list cannot do that.
 */
const SUBMIT_CLASS = {
  standard: 'btn btn-brand mt-1 h-12 w-full text-label disabled:opacity-60',
  elevated: 'btn btn-brand mt-1 w-full rounded-xl py-3.5 text-sm font-semibold disabled:opacity-60',
}

/**
 * The field WELL — the bordered box holding the icon, the input and any
 * trailing control.
 *
 * `standard` is the design system's field verbatim: emerald border and ring on
 * focus, because in this palette emerald means STATE (focused, selected,
 * healthy) while near-black means ACTION.
 *
 * `elevated` answers focus in near-black instead, by request. Two things make
 * that a considered exception rather than a drift:
 *
 *   · IT IS STILL A TWO-PART ANSWER. The border moves AND a ring appears, which
 *     is what the system requires of a focus state; only the hue changed. A
 *     ring alone, or a border alone, is the failure this pattern guards
 *     against.
 *   · IT MEASURES. slate-900 on white is 17.9:1, well past the 3:1 a focus
 *     indicator owes its surroundings, so the neutral reads as a stronger
 *     indicator here than the emerald it replaces, not a weaker one.
 *
 * `hover:border-slate-300` is new to both — a field that answers the pointer
 * before it is clicked, which the standard variant simply never had.
 */
const FIELD_CLASS = {
  standard:
    'border-slate-200 hover:border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25',
  elevated:
    'border-slate-200/80 hover:border-slate-300 focus-within:border-text-primary focus-within:ring-2 focus-within:ring-text-primary/10',
}

/**
 * One labelled field: label above, a pill well below holding a leading icon,
 * the input, and an optional trailing control.
 *
 * `focus-within` is on the WELL rather than `:focus` on the input, so the
 * icon, border, fill and ring all light up as a single control instead of a
 * ring appearing around a box that happens to contain a glyph.
 */
function Field({
  id,
  label,
  icon: Icon,
  trailing,
  labelClassName = LABEL_CLASS.standard,
  wellClassName = FIELD_CLASS.standard,
  inputClassName = '',
  ...inputProps
}) {
  return (
    <div>
      <label htmlFor={id} className={`mb-2 block ${labelClassName}`}>
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
      <div className={`flex items-center gap-3 rounded-lg border bg-field px-3 transition-colors duration-150 ${wellClassName}`}>
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
  /**
   * The email field's leading glyph. Defaults to `AtSign` — see the note at
   * the field itself for why that was the original choice, which still holds
   * for the guardhouse. The admin split-card screen passes `Mail` because its
   * brief names an envelope, and a prop is how one screen takes that without
   * silently changing the other console's field.
   */
  emailIcon: EmailIcon = AtSign,
  /**
   * 'standard' (the guardhouse card) or 'elevated' (the admin split card).
   * Presentation only — see LABEL_CLASS and SUBMIT_CLASS, which are the entire
   * difference between the two.
   */
  variant = 'standard',
}) {
  const labelClassName = LABEL_CLASS[variant] ?? LABEL_CLASS.standard
  const submitClassName = SUBMIT_CLASS[variant] ?? SUBMIT_CLASS.standard
  const wellClassName = FIELD_CLASS[variant] ?? FIELD_CLASS.standard

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
          labelClassName={labelClassName}
          wellClassName={wellClassName}
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
          className={submitClassName}
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
      {/* AtSign is the default here: the guardhouse brief names an `@` glyph,
          and it is the more literal cue for "this field takes an address" than
          an envelope, which reads as "we will send you something". The admin
          screen overrides it with `Mail` per its own brief — see the prop. */}
      <Field
        id="email"
        label="Email address"
        icon={EmailIcon}
        labelClassName={labelClassName}
        wellClassName={wellClassName}
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
        labelClassName={labelClassName}
        wellClassName={wellClassName}
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
        className={submitClassName}
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
