import { Check, Loader2, Lock } from '@shared/icons'
import { auth } from '@shared/lib/firebase'
import { useChangePassword } from '@shared/hooks/useChangePassword'
import FormField from '@shared/components/settings/FormField'
import PasswordRules from '@shared/components/settings/PasswordRules'
import RevealToggle from '@shared/components/settings/RevealToggle'
import SettingsItem from './SettingsItem'
import SettingsSection from './SettingsSection'

/**
 * Security: change this account's password, laid out inline as in the design.
 * The logic is the shared `useChangePassword` (also behind the Guardhouse's
 * panel). Like the email change, this is an Auth action with its own button,
 * not part of the page's Save; nothing typed here is ever stored.
 */
export default function SecuritySettingsCard() {
  const pw = useChangePassword()
  const hasEmail = Boolean(auth.currentUser?.email)
  const type = pw.reveal ? 'text' : 'password'
  const dirty = Boolean(pw.current || pw.next || pw.confirmation)

  return (
    <SettingsSection id="security" icon={Lock} title="Security">
      <SettingsItem
        title="Change password"
        description="Use a strong, unique password. Changing it signs this account out on every other device."
        align="start"
      >
        {!hasEmail ? (
          <p className="text-sm text-text-muted">
            Not available: a password is confirmed against the account's email, and this account has none.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <FormField
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
              <p role="alert" className="text-xs text-danger">
                {pw.error}
              </p>
            ) : pw.done && !dirty ? (
              <p role="status" className="inline-flex items-center gap-1.5 text-xs text-success">
                <Check size="sm" aria-hidden="true" />
                Password updated. Use the new one next time you sign in.
              </p>
            ) : null}
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={pw.submit} disabled={pw.busy || !pw.next} className="btn btn-sm btn-outline">
                {pw.busy ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
                {pw.busy ? 'Updating…' : 'Update password'}
              </button>
              {dirty ? (
                <button type="button" onClick={pw.reset} disabled={pw.busy} className="btn btn-sm btn-outline">
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        )}
      </SettingsItem>
    </SettingsSection>
  )
}
