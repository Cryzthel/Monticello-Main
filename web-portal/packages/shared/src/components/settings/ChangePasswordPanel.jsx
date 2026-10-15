import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { Check, Eye, EyeOff, KeyRound, Loader2, Lock } from '@shared/icons'
import { auth } from '@shared/lib/firebase'
import { RULES, STRENGTH, passwordReady, scoreOf } from '@shared/auth/passwordPolicy'
import { SettingsGroup, SettingRow } from '@shared/components/settings/SettingsFields'

/**
 * Change the signed-in account's own password. One panel, both consoles.
 *
 * ── WHY THIS WORKS WHEN SO LITTLE ELSE ON THE SETTINGS PAGE DOES ────────────
 * Nearly every other control in this suite carries a "stored, not yet acted
 * on" note, because it needs a Cloud Function and Functions cannot deploy on
 * the Spark plan. This one needs nothing of the sort: `updatePassword` is a
 * Firebase Auth CLIENT call that goes straight from this browser to Identity
 * Toolkit. It takes effect on the next sign-in, today, with no backend at all.
 *
 * That is also why it does NOT reuse the OTP recovery flow next door. That
 * flow exists for someone who cannot sign in, and it needs the mailer function
 * — which is deployed but billing-gated. The person reading this panel is
 * already signed in, so they never have to go near it.
 *
 * ── RE-AUTHENTICATION IS NOT OPTIONAL AND IS NOT A UX CHOICE ────────────────
 * Firebase refuses `updatePassword` with `auth/requires-recent-login` when the
 * session's credential is more than a few minutes old, and the session on an
 * admin console is routinely hours old. So the current password is asked for
 * and exchanged for a fresh credential first.
 *
 * It would be security theatre to call this a mere formality: an unattended,
 * still-signed-in console is exactly the threat here, and asking for the
 * current password is what stops a passer-by from taking the account outright.
 * Which is why the failure message for a wrong current password says the
 * password was wrong rather than something softer — the person typing it is
 * the account's owner, and vagueness helps nobody but the passer-by.
 *
 * ── NOTHING IS PERSISTED BY THIS COMPONENT ──────────────────────────────────
 * No draft, no store, no settings document. The three fields live in local
 * state and are cleared on success. A password that reached the settings draft
 * would be written to Firestore by the page's Save — into a document every
 * approved staff account can read.
 */
export default function ChangePasswordPanel() {
  const user = auth.currentUser
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const score = scoreOf(next)
  const tier = STRENGTH[Math.max(0, score)]
  const mismatch = confirmation.length > 0 && confirmation !== next
  const reused = next.length > 0 && next === current
  const ready = Boolean(current) && passwordReady(next, confirmation) && !reused

  /**
   * A signed-in account with no email address cannot be re-authenticated this
   * way, because `EmailAuthProvider.credential` is the only factor either
   * console issues. Rather than fail at submit with a Firebase error code,
   * the panel says so up front and offers nothing to type.
   */
  if (!user?.email) {
    return (
      <SettingsGroup
        icon={KeyRound}
        title="Change password"
        description="Updates the password for the account signed in on this console."
      >
        <SettingRow
          id="password-unavailable"
          title="This account has no email address"
          description="A password is changed by confirming the current one against the account's email, and this account does not have one. An administrator can issue a new credential from Security Accounts."
          control={<Lock size="sm" aria-hidden="true" className="text-text-muted" />}
        />
      </SettingsGroup>
    )
  }

  async function submit(event) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      // Re-authenticate, then change. Both can fail and they fail differently,
      // so the messages below distinguish them — "wrong password" and "that
      // password is too weak" send a reader to completely different fixes.
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current))
      await updatePassword(user, next)
      setCurrent('')
      setNext('')
      setConfirmation('')
      setDone(true)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup
      icon={KeyRound}
      title="Change password"
      description={`Updates the password for ${user.email}. Other signed-in sessions are not signed out.`}
    >
      {/* ── A FORM INSIDE A FORM IS INVALID HTML ──────────────────────────
          The admin settings page wraps every panel in its own <form> with the
          Save button, so this cannot be one: nested forms do not nest, the
          inner one is dropped by the parser, and this panel's submit would
          then trigger the page's Save instead. The fields are a plain <div>
          and the button is an explicit onClick. The guardhouse console has no
          outer form, but the panel behaves the same there rather than
          depending on which page mounted it. */}
      <div className="px-4 py-3.5">
        <div className="flex max-w-md flex-col gap-4">
          <Field
            id="current-password"
            label="Current password"
            value={current}
            autoComplete="current-password"
            reveal={reveal}
            disabled={busy}
            onChange={setCurrent}
          />

          <Field
            id="next-password"
            label="New password"
            value={next}
            autoComplete="new-password"
            reveal={reveal}
            disabled={busy}
            onChange={setNext}
            trailing={
              <button
                type="button"
                onClick={() => setReveal((on) => !on)}
                aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
                aria-pressed={reveal}
                className="shrink-0 rounded-full p-1.5 text-text-muted transition-colors duration-150 hover:bg-tint/10 hover:text-text-primary"
              >
                {reveal ? <EyeOff size="sm" /> : <Eye size="sm" />}
              </button>
            }
          />

          {/* The meter and the rule list come from `passwordPolicy`, which is
              what the recovery flow scores against too. A second opinion about
              what counts as strong is how two screens start disagreeing about
              whether the same password is acceptable. */}
          {next ? (
            <div>
              <div className="h-1 overflow-hidden rounded-full bg-tint/10">
                <div className={`h-full rounded-full transition-[width] duration-200 ${tier.bar}`} />
              </div>
              <p className={`mt-1.5 text-2xs font-medium ${tier.text}`}>{tier.label}</p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {RULES.map((rule) => {
                  const met = rule.test(next)
                  return (
                    <li
                      key={rule.id}
                      className={`inline-flex items-center gap-1 text-2xs ${
                        met ? 'text-success' : 'text-text-muted'
                      }`}
                    >
                      <Check size="sm" aria-hidden="true" className={met ? '' : 'opacity-30'} />
                      {rule.label}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          <Field
            id="confirm-password"
            label="Confirm new password"
            value={confirmation}
            autoComplete="new-password"
            reveal={reveal}
            disabled={busy}
            onChange={setConfirmation}
            invalid={mismatch}
          />

          {mismatch ? (
            <p className="text-xs text-danger">The two new passwords do not match.</p>
          ) : null}
          {reused ? (
            <p className="text-xs text-warning">
              The new password is the same as the current one.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          {done ? (
            <p role="status" className="inline-flex items-center gap-1.5 text-xs text-success">
              <Check size="sm" aria-hidden="true" />
              Password changed. Use the new one next time you sign in.
            </p>
          ) : null}

          <div>
            <button
              type="button"
              onClick={submit}
              disabled={!ready || busy}
              className="btn btn-sm btn-brand"
            >
              {busy ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
              {busy ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </div>
      </div>
    </SettingsGroup>
  )
}

function Field({ id, label, value, autoComplete, reveal, disabled, invalid, trailing, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium leading-snug text-text-primary">
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
          className="field h-9 min-w-0 flex-1"
        />
        {trailing}
      </div>
    </div>
  )
}

/**
 * Firebase's codes, in the words of the person reading them.
 *
 * `auth/invalid-credential` is the one that matters: since enumeration
 * protection was enabled on this project it is what a wrong password returns,
 * in place of the older `auth/wrong-password`. Both are handled, because the
 * older code still reaches clients on some SDK paths and a fallback of "an
 * unexpected error" for the single most likely failure would be a bad panel.
 */
function messageFor(err) {
  switch (err?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'That is not the current password for this account.'
    case 'auth/weak-password':
      return 'Firebase rejected the new password as too weak. Try a longer one.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/requires-recent-login':
      return 'This session is too old to change a password. Sign out, sign in again, and retry.'
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check the connection and try again.'
    default:
      return err?.message || 'The password could not be changed.'
  }
}
