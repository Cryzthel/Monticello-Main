import { CheckCircle2, Circle, Eye, EyeOff } from '@shared/icons'

import FloatingField from '@shared/auth/FloatingField'
import { RULES } from '@shared/auth/passwordPolicy'

/**
 * Choose a new password, with mobile's requirements checklist and a match check.
 *
 * ── WHY IT IS ITS OWN COMPONENT ──────────────────────────────────────────────
 * Two places ask for a new password and they are reached completely
 * differently: the OTP flow, where the code was typed a moment ago in the same
 * screen, and the emailed-link route, where the person arrives from their inbox
 * possibly on another device. The SCREENS differ; the decision — is this
 * password long enough, and did you type it twice the same — does not. Two
 * copies of a password rule set is two places for them to drift, and the one
 * that drifts is always the one nobody is looking at.
 */

export default function NewPasswordFields({
  password,
  confirmation,
  reveal,
  onPasswordChange,
  onConfirmationChange,
  onToggleReveal,
  disabled = false,
}) {
  const mismatch = confirmation.length > 0 && confirmation !== password

  return (
    // `gap-6`, the sign-in form's value: a floated label sits on its field's
    // top border and needs the same air above it on every auth screen.
    <div className="flex flex-col gap-6">
      <FloatingField
        id="new-password"
        label="New password"
        type={reveal ? 'text' : 'password'}
        required
        disabled={disabled}
        autoComplete="new-password"
        autoFocus
        filled={Boolean(password)}
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
        // Read from the policy rather than restated: this said "At least 10"
        // while the rule it describes accepts 8.
        placeholder={RULES.find((rule) => rule.id === 'length').label}
        trailing={
          <button
            type="button"
            onClick={onToggleReveal}
            // The sign-in form's reveal toggle, exactly: 44px on touch, 32px on
            // a pointer. This was a 28px `p-1.5` square — the same eye, a
            // different size, one screen later.
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors duration-150 hover:bg-tint/10 hover:text-text-primary sm:h-8 sm:w-8"
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
          >
            {reveal ? <EyeOff size="sm" /> : <Eye size="sm" />}
          </button>
        }
      />

      <FloatingField
        id="confirm-password"
        label="Confirm password"
        type={reveal ? 'text' : 'password'}
        required
        disabled={disabled}
        autoComplete="new-password"
        filled={Boolean(confirmation)}
        value={confirmation}
        onChange={(event) => onConfirmationChange(event.target.value)}
        placeholder="Re-enter your password"
        // Only once there is something to compare. Flagging a mismatch on the
        // first keystroke tells someone they are wrong before they have had a
        // chance to be right.
        error={mismatch ? 'The two passwords do not match yet.' : ''}
      />

      <PasswordRequirements password={password} />
    </div>
  )
}

/**
 * Mobile's "Password Requirements" panel (`_PasswordRequirements` in
 * change_password_screen.dart), rule for rule and word for word.
 *
 * ── ALWAYS ON SCREEN, BENEATH BOTH FIELDS ───────────────────────────────────
 * This was a strength bar plus a list that only appeared once something was
 * typed — so the rules were invisible at the moment someone was deciding what
 * to type. Mobile shows them from the start; so does this. The strength bar is
 * gone with it: it graded on the same three rules the list already ticks, so
 * it said everything twice in two visual languages.
 *
 * ── THREE RULES, NOT FOUR ───────────────────────────────────────────────────
 * No uppercase rule. Mobile removed it so Create Account and Change Password
 * agree, and RULES (passwordPolicy.js) is the copy of that decision. Adding it
 * here alone would let the web refuse passwords the app accepts.
 *
 * Met rows turn brand emerald (#047857, `brand-cta`, the auth green), not
 * mobile's success green: on these screens the CTA beneath is that emerald,
 * and a second green one row above it reads as a different meaning.
 * `aria-live` so a screen reader hears a rule flip as it is satisfied.
 */
function PasswordRequirements({ password }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-field px-4 py-3.5">
      <p className="text-2xs font-bold uppercase tracking-[0.05em] text-text-muted">
        Password requirements
      </p>
      <ul className="mt-2.5 flex flex-col gap-1.5" aria-live="polite">
        {RULES.map((rule) => {
          const met = rule.test(password)
          const Icon = met ? CheckCircle2 : Circle
          return (
            <li
              key={rule.id}
              className={`flex items-center gap-2 text-[0.78125rem] font-medium transition-colors duration-200 ${
                met ? 'text-text-primary' : 'text-text-secondary'
              }`}
            >
              <Icon
                size="sm"
                aria-hidden="true"
                className={`shrink-0 transition-colors duration-200 ${met ? 'text-brand-cta' : 'text-text-muted'}`}
              />
              <span>
                {rule.label}
                <span className="sr-only">{met ? ' — met' : ' — not met yet'}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
