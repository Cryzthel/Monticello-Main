import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, KeyRound, Loader2, Lock } from '@shared/icons'
import { auth } from '@shared/lib/firebase'
import { useChangePassword } from '@shared/hooks/useChangePassword'
import FormField from '@shared/components/settings/FormField'
import PasswordRules from '@shared/components/settings/PasswordRules'
import RevealToggle from '@shared/components/settings/RevealToggle'
import Disclosure from './Disclosure'
import SettingsItem from './SettingsItem'
import SettingsSection from './SettingsSection'

/**
 * Security: change this account's password.
 *
 * The fields are collapsed behind "Change password" (2026-10-19, by request —
 * no open password inputs on the page). Opening moves focus to the first
 * field; Cancel or a successful change collapses it and CLEARS every field,
 * because a typed password behind a collapsed panel is still in the DOM.
 * Logic is the shared `useChangePassword`; like the email change it is a
 * Firebase Auth action with its own button, never part of the page's Save.
 */
export default function SecuritySettingsCard() {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const toggleRef = useRef(null)
  const firstFieldRef = useRef(null)
  const pw = useChangePassword({ onChanged: () => setOpen(false) })
  const hasEmail = Boolean(auth.currentUser?.email)
  const type = pw.reveal ? 'text' : 'password'

  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) firstFieldRef.current?.focus({ preventScroll: true })
    else if (wasOpen.current) toggleRef.current?.focus({ preventScroll: true })
    wasOpen.current = open
  }, [open])

  function close() {
    setOpen(false)
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                ref={toggleRef}
                type="button"
                onClick={() => (open ? close() : setOpen(true))}
                aria-expanded={open}
                aria-controls={panelId}
                className="btn btn-sm btn-outline"
              >
                <KeyRound size="sm" aria-hidden="true" />
                Change password
                <ChevronDown
                  size="sm"
                  aria-hidden="true"
                  className={`transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                />
              </button>
              {pw.done && !open ? (
                <p role="status" className="inline-flex items-center gap-1.5 text-xs text-success">
                  <Check size="sm" aria-hidden="true" />
                  Password updated
                </p>
              ) : null}
            </div>

            <Disclosure id={panelId} open={open}>
              <div className="flex flex-col gap-4 rounded-lg border border-hairline bg-base-900/30 p-4">
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
                  <p role="alert" className="text-xs text-danger">
                    {pw.error}
                  </p>
                ) : null}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={pw.submit} disabled={pw.busy || !pw.next} className="btn btn-sm btn-brand">
                    {pw.busy ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
                    {pw.busy ? 'Updating…' : 'Update password'}
                  </button>
                  <button type="button" onClick={close} disabled={pw.busy} className="btn btn-sm btn-outline">
                    Cancel
                  </button>
                </div>
              </div>
            </Disclosure>
          </div>
        )}
      </SettingsItem>
    </SettingsSection>
  )
}
