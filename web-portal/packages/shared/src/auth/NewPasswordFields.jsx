import { useMemo } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Lock } from '@shared/icons'

import FloatingField from '@shared/auth/FloatingField'
import { RULES, STRENGTH, scoreOf } from '@shared/auth/passwordPolicy'

/**
 * Choose a new password, with a strength meter and a match check.
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
  const score = useMemo(() => scoreOf(password), [password])
  const mismatch = confirmation.length > 0 && confirmation !== password
  const tier = STRENGTH[Math.max(0, score)]

  return (
    <div className="flex flex-col gap-5">
      <FloatingField
        id="new-password"
        label="New password"
        icon={Lock}
        type={reveal ? 'text' : 'password'}
        required
        disabled={disabled}
        autoComplete="new-password"
        autoFocus
        filled={Boolean(password)}
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
        placeholder="At least 10 characters"
        trailing={
          <button
            type="button"
            onClick={onToggleReveal}
            className="shrink-0 rounded-full p-1.5 text-text-muted transition-colors duration-150 hover:bg-tint/10 hover:text-text-primary"
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
          >
            {reveal ? <EyeOff size="sm" /> : <Eye size="sm" />}
          </button>
        }
      />

      {/* The meter is `aria-hidden` and the rule list carries the real message:
          a coloured bar communicates nothing to a screen reader, and the same
          information is spelled out immediately beneath it. */}
      {password ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-base-800" aria-hidden="true">
              <div className={`h-full rounded-full transition-all duration-300 ease-out ${tier.bar}`} />
            </div>
            <span className={`text-xs font-medium ${tier.text}`}>{tier.label}</span>
          </div>
          <ul className="flex flex-col gap-1">
            {RULES.map((rule) => {
              const met = rule.test(password)
              return (
                <li
                  key={rule.id}
                  className={`flex items-center gap-2 text-xs transition-colors duration-200 ${
                    met ? 'text-brand-400' : 'text-text-muted'
                  }`}
                >
                  <CheckCircle2
                    size="sm"
                    className={met ? 'opacity-100' : 'opacity-30'}
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
        disabled={disabled}
        autoComplete="new-password"
        filled={Boolean(confirmation)}
        value={confirmation}
        onChange={(event) => onConfirmationChange(event.target.value)}
        placeholder="Type it again"
        // Only once there is something to compare. Flagging a mismatch on the
        // first keystroke tells someone they are wrong before they have had a
        // chance to be right.
        error={mismatch ? 'The two passwords do not match yet.' : ''}
      />
    </div>
  )
}
