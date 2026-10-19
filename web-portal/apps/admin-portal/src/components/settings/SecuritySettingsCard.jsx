import { useRef, useState } from 'react'
import { Check, CircleAlert, KeyRound, Loader2, Lock, ShieldCheck } from '@shared/icons'
import { auth } from '@shared/lib/firebase'
import { useChangePassword } from '@shared/hooks/useChangePassword'
import FormField from '@shared/components/settings/FormField'
import PasswordRules from '@shared/components/settings/PasswordRules'
import RevealToggle from '@shared/components/settings/RevealToggle'
import SettingsDialog from './SettingsDialog'
import SettingsItem from './SettingsItem'
import SettingsSection from './SettingsSection'

/**
 * Security: change this account's password, in a MODAL (2026-10-19, by
 * request — it was an inline dropdown).
 *
 *   1. Current password (re-authenticates; Firebase requires a recent
 *      sign-in), new password with the live requirements checklist (the
 *      mobile-parity policy: 8+ characters, a number, a symbol), and the
 *      confirmation. The checklist turns red and says why if Update is
 *      pressed with a rule unmet, rather than leaving a dead button.
 *   2. "Password updated", stating the consequence: every other session of
 *      this account is signed out.
 *
 * Closing at any point CLEARS every field — a typed password must not stay in
 * the DOM behind a dismissed dialog. Logic is the shared `useChangePassword`;
 * like the email change it is a Firebase Auth action with its own button,
 * never part of the page's Save.
 */
export default function SecuritySettingsCard() {
  // null (closed) | 'form' | 'done'
  const [step, setStep] = useState(null)
  const firstFieldRef = useRef(null)
  const pw = useChangePassword({ onChanged: () => setStep('done') })
  const hasEmail = Boolean(auth.currentUser?.email)
  const type = pw.reveal ? 'text' : 'password'

  function close() {
    setStep(null)
    pw.reset()
  }

  return (
    <SettingsSection id="security" icon={Lock} title="Security">
      <SettingsItem
        title="Password"
        description="Use a strong, unique password. Changing it signs this account out on every other device."
        align="start"
      >
        {!hasEmail ? (
          <p className="text-sm text-text-muted">
            Not available: a password is confirmed against the account's email, and this account has none.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setStep('form')} aria-haspopup="dialog" className="btn btn-sm btn-outline">
              <KeyRound size="sm" aria-hidden="true" />
              Change password
            </button>
            {pw.done && step === null ? (
              <p role="status" className="inline-flex items-center gap-1.5 text-xs text-success">
                <Check size="sm" aria-hidden="true" />
                Password updated
              </p>
            ) : null}
          </div>
        )}
      </SettingsItem>

      <SettingsDialog
        open={step === 'form'}
        icon={KeyRound}
        title="Change password"
        description="Confirm your current password, then choose a new one."
        busy={pw.busy}
        onClose={close}
        onSubmit={pw.submit}
        initialRef={firstFieldRef}
        footer={
          <>
            <button type="button" onClick={close} disabled={pw.busy} className="btn btn-sm btn-outline">
              Cancel
            </button>
            <button type="submit" disabled={pw.busy || !pw.next} className="btn btn-sm btn-brand">
              {pw.busy ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
              {pw.busy ? 'Updating…' : 'Update password'}
            </button>
          </>
        }
      >
        <FormField
          inputRef={firstFieldRef}
          id="current-password"
          label="Current password"
          type={type}
          value={pw.current}
          autoComplete="current-password"
          disabled={pw.busy}
          onChange={pw.setCurrent}
        />
        <div className="flex flex-col gap-2.5">
          <FormField
            id="next-password"
            label="New password"
            type={type}
            value={pw.next}
            autoComplete="new-password"
            disabled={pw.busy}
            invalid={pw.showRuleError}
            onChange={pw.setNext}
            trailing={<RevealToggle on={pw.reveal} onToggle={pw.toggleReveal} />}
          />
          <PasswordRules value={pw.next} failed={pw.showRuleError} />
        </div>
        <FormField
          id="confirm-password"
          label="Confirm new password"
          type={type}
          value={pw.confirmation}
          autoComplete="new-password"
          disabled={pw.busy}
          invalid={pw.mismatch}
          hint={pw.mismatch ? 'The two new passwords do not match.' : pw.reused ? 'That is the current password.' : undefined}
          onChange={pw.setConfirmation}
        />
        {pw.error ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <CircleAlert size="sm" aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{pw.error}</span>
          </p>
        ) : null}
      </SettingsDialog>

      <SettingsDialog
        open={step === 'done'}
        icon={ShieldCheck}
        title="Password updated"
        description="Use the new password the next time you sign in."
        onClose={close}
        onSubmit={close}
        footer={
          <button type="submit" className="btn btn-sm btn-brand">
            Done
          </button>
        }
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          Every other device signed in to this account has been signed out. This console stays signed in.
        </p>
      </SettingsDialog>
    </SettingsSection>
  )
}
