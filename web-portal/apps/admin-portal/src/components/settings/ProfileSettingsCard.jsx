import { useEffect, useId, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, Mail, MailCheck, Pencil, ShieldCheck, UserRound } from '@shared/icons'
import Pill from '@shared/components/Pill'
import FormField from '@shared/components/settings/FormField'
import { ROLE_LABELS } from '@shared/auth/roles'
import { useAccountEmail } from '@/hooks/useAccountEmail'
import Disclosure from './Disclosure'
import SettingsItem from './SettingsItem'
import SettingsSection from './SettingsSection'

const ROLE_SCOPE = {
  super_admin: 'Full access, including guard accounts and these settings.',
  hoa_admin: 'Admin console access. Guard accounts are read-only for this role.',
}

/**
 * Profile: the signed-in administrator's email and role.
 *
 * The email is shown read-only; "Edit email address" opens the change form
 * inline beneath it (2026-10-19, by request — no open input by default).
 * Cancelling, or a sent link, closes it and clears what was typed. The change
 * is a Firebase Auth action with its own button, not part of the page's Save.
 */
export default function ProfileSettingsCard({ role }) {
  const account = useAccountEmail()
  const [editing, setEditing] = useState(false)
  const formId = useId()
  const toggleRef = useRef(null)
  const firstFieldRef = useRef(null)

  // Focus follows the form: into it on open, back to the (re-rendered) Edit
  // button on close, so a keyboard user is never dropped at the page top.
  const wasEditing = useRef(false)
  useEffect(() => {
    if (editing) firstFieldRef.current?.focus({ preventScroll: true })
    else if (wasEditing.current) toggleRef.current?.focus({ preventScroll: true })
    wasEditing.current = editing
  }, [editing])

  function close() {
    setEditing(false)
    account.cancel()
  }

  async function send() {
    if (await account.submit()) setEditing(false)
  }

  return (
    <SettingsSection id="profile" icon={UserRound} title="Profile">
      <SettingsItem
        title="Email address"
        description="The administrator signed in to this console. Confirmation links are sent to this address."
        align="start"
      >
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-hairline bg-base-900/40 p-3">
            <Mail size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate text-sm font-medium text-text-secondary">{account.email || '—'}</span>
            <span className="ml-auto shrink-0">
              {account.verified ? (
                <Pill tone="success" icon={CheckCircle2}>
                  Verified
                </Pill>
              ) : (
                <Pill tone="warning" icon={CircleAlert}>
                  Not verified
                </Pill>
              )}
            </span>
          </div>

          {account.pending ? (
            <p role="status" className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
              <MailCheck size="sm" aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
              <span>
                Waiting for <span className="font-medium text-text-primary">{account.pending}</span> to be confirmed.
                Your sign-in email changes when that link is opened, and you will sign in again with it.{' '}
                <button
                  type="button"
                  onClick={account.dismissPending}
                  className="font-medium text-text-primary underline underline-offset-2"
                >
                  Dismiss
                </button>
              </span>
            </p>
          ) : !account.verified && account.available ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
              This address has not been confirmed.
              <button
                type="button"
                onClick={account.sendVerification}
                disabled={account.sendingVerification}
                className="font-medium text-text-primary underline underline-offset-2 disabled:opacity-50"
              >
                {account.sendingVerification ? 'Sending…' : 'Send verification email'}
              </button>
            </p>
          ) : null}

          {editing ? null : (
            <div>
              <button
                ref={toggleRef}
                type="button"
                onClick={() => setEditing(true)}
                disabled={!account.available}
                aria-expanded={editing}
                aria-controls={formId}
                className="btn btn-sm btn-outline"
              >
                <Pencil size="sm" aria-hidden="true" />
                Edit email address
              </button>
            </div>
          )}

          <Disclosure id={formId} open={editing}>
            <div className="flex flex-col gap-4 rounded-lg border border-hairline bg-base-900/30 p-4">
              <FormField
                inputRef={firstFieldRef}
                id="new-email"
                label="New email address"
                type="email"
                inputMode="email"
                value={account.nextEmail}
                autoComplete="email"
                disabled={account.busy}
                invalid={account.invalid || account.same}
                hint={
                  account.invalid
                    ? 'Enter a valid email address.'
                    : account.same
                      ? 'That is already your sign-in email.'
                      : 'A confirmation link goes to this address; nothing changes until it is opened.'
                }
                onChange={account.setNextEmail}
              />
              <FormField
                id="email-current-password"
                label="Current password"
                type="password"
                value={account.password}
                autoComplete="current-password"
                disabled={account.busy}
                onChange={account.setPassword}
              />
              {account.error ? (
                <p role="alert" className="text-xs text-danger">
                  {account.error}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <button type="button" onClick={send} disabled={account.busy || !account.ready} className="btn btn-sm btn-brand">
                  {account.busy ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
                  {account.busy ? 'Sending…' : 'Send confirmation link'}
                </button>
                <button type="button" onClick={close} disabled={account.busy} className="btn btn-sm btn-outline">
                  Cancel
                </button>
              </div>
            </div>
          </Disclosure>
        </div>
      </SettingsItem>

      <SettingsItem title="System role" description={ROLE_SCOPE[role] ?? 'Staff access.'}>
        <Pill tone="neutral" icon={ShieldCheck}>
          {ROLE_LABELS[role] ?? 'Staff'}
        </Pill>
      </SettingsItem>
    </SettingsSection>
  )
}
