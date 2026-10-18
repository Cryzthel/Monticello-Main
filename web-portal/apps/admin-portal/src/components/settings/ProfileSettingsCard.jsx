import { CheckCircle2, CircleAlert, Loader2, Mail, MailCheck, ShieldCheck, UserRound } from '@shared/icons'
import FormField from '@shared/components/settings/FormField'
import { ROLE_LABELS } from '@shared/auth/roles'
import { useAccountEmail } from '@/hooks/useAccountEmail'
import SettingsItem from './SettingsItem'
import SettingsSection from './SettingsSection'

const ROLE_SCOPE = {
  super_admin: 'Full access, including guard accounts and these settings.',
  hoa_admin: 'Admin console access. Guard accounts are read-only for this role.',
}

/**
 * Profile: the signed-in administrator's email and role.
 *
 * The new-email field is always there, as in the design; the password and
 * Send button appear only once something has been typed (progressive
 * disclosure), because a confirmation needs both and a quiet page needs
 * neither until then. The email change is NOT part of the page's Save — it is
 * an Auth action with its own confirmation link, so it carries its own button.
 */
export default function ProfileSettingsCard({ role }) {
  const account = useAccountEmail()
  const editing = account.nextEmail.trim().length > 0

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
            {account.verified ? (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                <CheckCircle2 size={12} aria-hidden="true" />
                Verified
              </span>
            ) : (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                <CircleAlert size={12} aria-hidden="true" />
                Not verified
              </span>
            )}
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

          <FormField
            id="new-email"
            label="New email address"
            type="email"
            inputMode="email"
            value={account.nextEmail}
            autoComplete="email"
            disabled={account.busy || !account.available}
            invalid={account.invalid || account.same}
            hint={
              account.invalid
                ? 'Enter a valid email address.'
                : account.same
                  ? 'That is already your sign-in email.'
                  : editing
                    ? 'A confirmation link goes to this address; nothing changes until it is opened.'
                    : undefined
            }
            onChange={account.setNextEmail}
          />

          {editing ? (
            <>
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
                <button
                  type="button"
                  onClick={account.submit}
                  disabled={account.busy || !account.ready}
                  className="btn btn-sm btn-brand"
                >
                  {account.busy ? <Loader2 size="sm" aria-hidden="true" className="animate-spin" /> : null}
                  {account.busy ? 'Sending…' : 'Send confirmation link'}
                </button>
                <button type="button" onClick={account.cancel} disabled={account.busy} className="btn btn-sm btn-outline">
                  Cancel
                </button>
              </div>
            </>
          ) : null}
        </div>
      </SettingsItem>

      <SettingsItem title="System role" description={ROLE_SCOPE[role] ?? 'Staff access.'}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-tint/[0.05] px-3 py-1.5 text-xs font-medium text-text-secondary">
          <ShieldCheck size={14} aria-hidden="true" className="text-brand-500" />
          {ROLE_LABELS[role] ?? 'Staff'}
        </span>
      </SettingsItem>
    </SettingsSection>
  )
}
