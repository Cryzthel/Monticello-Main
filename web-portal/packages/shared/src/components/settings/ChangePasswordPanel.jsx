import { useEffect, useId, useRef, useState } from 'react'
import { Check, KeyRound, Loader2 } from '@shared/icons'
import { auth } from '@shared/lib/firebase'
import { useChangePassword } from '@shared/hooks/useChangePassword'
import { SettingsGroup, SettingRow } from '@shared/components/settings/SettingsFields'
import FormField from '@shared/components/settings/FormField'
import PasswordRules from '@shared/components/settings/PasswordRules'
import RevealToggle from '@shared/components/settings/RevealToggle'

/**
 * The Guardhouse console's change-password card: a one-line summary with a
 * button that opens three fields. The logic is `useChangePassword`, shared
 * with the Admin console's Security settings, which lays the same fields out
 * inline instead.
 *
 * No nested <form>: the fields are a <div> and the button an explicit onClick,
 * so the panel behaves the same under any page. The drawer animates
 * `grid-template-rows` and is `invisible` when shut, so keyboard focus cannot
 * reach fields nobody can see; closing clears everything typed.
 */
export default function ChangePasswordPanel() {
  const user = auth.currentUser
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const toggleRef = useRef(null)
  const firstFieldRef = useRef(null)
  const pw = useChangePassword({
    onChanged: () => {
      setOpen(false)
      toggleRef.current?.focus()
    },
  })

  function close() {
    setOpen(false)
    pw.reset()
    toggleRef.current?.focus()
  }

  useEffect(() => {
    if (open) firstFieldRef.current?.focus({ preventScroll: true })
  }, [open])

  if (!user?.email) {
    return (
      <SettingsGroup icon={KeyRound} title="Password">
        <SettingRow
          id="password-unavailable"
          title="Not available for this account"
          description="A password is confirmed against the account's email, and this account has none. An administrator can issue a new one from Security accounts."
        />
      </SettingsGroup>
    )
  }

  const type = pw.reveal ? 'text' : 'password'

  return (
    <SettingsGroup
      icon={KeyRound}
      title="Password"
      description="Use a strong password you do not use anywhere else."
      action={
        <button
          ref={toggleRef}
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls={panelId}
          className="btn btn-sm btn-outline"
        >
          {open ? 'Cancel' : 'Change password'}
        </button>
      }
    >
      {pw.done && !open ? (
        <p role="status" className="inline-flex items-center gap-1.5 px-4 py-3 text-xs text-success">
          <Check size="sm" aria-hidden="true" />
          Password updated. Use the new one next time you sign in.
        </p>
      ) : null}
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex max-w-sm flex-col gap-5 px-4 py-6">
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
            <div className="flex flex-col gap-3">
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
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={pw.submit} disabled={pw.busy || !pw.next} className="btn btn-sm btn-brand">
                {pw.busy ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
                {pw.busy ? 'Updating…' : 'Update password'}
              </button>
              <button type="button" onClick={close} disabled={pw.busy} className="btn btn-sm btn-outline">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </SettingsGroup>
  )
}
