import { useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, Mail, MailCheck, Pencil, ShieldCheck, UserRound } from '@shared/icons'
import Pill from '@shared/components/Pill'
import FormField from '@shared/components/settings/FormField'
import { ROLE_LABELS } from '@shared/auth/roles'
import { useAccountEmail } from '@/hooks/useAccountEmail'
import SettingsDialog from './SettingsDialog'
import SettingsItem from './SettingsItem'
import SettingsSection from './SettingsSection'

const ROLE_SCOPE = {
  super_admin: 'Full access, including guard accounts and these settings.',
  hoa_admin: 'Admin console access. Guard accounts are read-only for this role.',
}

/**
 * Profile: the signed-in administrator's email and role.
 *
 * The email is shown read-only; "Edit email address" opens the change in a
 * MODAL (2026-10-19, by request — it was an inline dropdown). Two steps:
 *
 *   1. New address + current password. The password re-authenticates the
 *      session (Firebase requires a recent sign-in), and the button stays
 *      off until the address is valid and different.
 *   2. "Check your inbox": Firebase's verifyBeforeUpdateEmail has sent a
 *      one-time confirmation link to the NEW address. Nothing changes until
 *      that link is opened, so the step says so and names the address.
 *
 * Cancel, Escape or the backdrop clear what was typed. The change is a
 * Firebase Auth action with its own button, never part of the page's Save.
 */
export default function ProfileSettingsCard({ role }) {
  const account = useAccountEmail()
  // null (closed) | 'form' | 'sent'
  const [step, setStep] = useState(null)
  const firstFieldRef = useRef(null)

  function close() {
    setStep(null)
    account.cancel()
  }

  async function send() {
    if (await account.submit()) setStep('sent')
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

          <div>
            <button
              type="button"
              onClick={() => setStep('form')}
              disabled={!account.available}
              aria-haspopup="dialog"
              className="btn btn-sm btn-outline"
            >
              <Pencil size="sm" aria-hidden="true" />
              Edit email address
            </button>
          </div>
        </div>
      </SettingsItem>

      <SettingsItem title="System role" description={ROLE_SCOPE[role] ?? 'Staff access.'}>
        <Pill tone="neutral" icon={ShieldCheck}>
          {ROLE_LABELS[role] ?? 'Staff'}
        </Pill>
      </SettingsItem>

      <SettingsDialog
        open={step === 'form'}
        icon={Mail}
        title="Change email address"
        description="Confirm with your password. A one-time link is sent to the new address."
        busy={account.busy}
        onClose={close}
        onSubmit={send}
        initialRef={firstFieldRef}
        footer={
          <>
            <button type="button" onClick={close} disabled={account.busy} className="btn btn-sm btn-outline">
              Cancel
            </button>
            <button type="submit" disabled={account.busy || !account.ready} className="btn btn-sm btn-brand">
              {account.busy ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
              {account.busy ? 'Sending…' : 'Send confirmation link'}
            </button>
          </>
        }
      >
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>Current:</span>
          <span className="min-w-0 truncate font-medium text-text-secondary">{account.email || '—'}</span>
        </div>
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
                : 'Nothing changes until the link sent here is opened.'
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
          hint="Required to confirm it is you."
          onChange={account.setPassword}
        />
        {account.error ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <CircleAlert size="sm" aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{account.error}</span>
          </p>
        ) : null}
      </SettingsDialog>

      <SettingsDialog
        open={step === 'sent'}
        icon={MailCheck}
        title="Check your inbox"
        description="One more step, from the new address."
        onClose={close}
        onSubmit={close}
        footer={
          <button type="submit" className="btn btn-sm btn-brand">
            Done
          </button>
        }
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          A confirmation link was sent to <span className="font-medium text-text-primary">{account.pending}</span>.
          Your sign-in email changes when it is opened, and you will sign in again with the new address.
        </p>
        <p className="text-xs leading-relaxed text-text-muted">
          No email after a few minutes? Check spam, or send it again from Edit email address.
        </p>
      </SettingsDialog>
    </SettingsSection>
  )
}
