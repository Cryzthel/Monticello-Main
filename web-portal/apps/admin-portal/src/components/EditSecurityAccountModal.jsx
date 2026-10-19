import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, KeyRound, Loader2, Lock, Mail, ShieldCheck, UserRound, UserRoundCog, X } from '@shared/icons'
import Pill from '@shared/components/Pill'
import { DetailCard } from '@shared/components/detail/DetailCard'
import { DetailFormField, detailInputClass } from '@shared/components/detail/DetailFormField'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import {
  ACCESS_ROLE_LABELS,
  DEFAULT_POST,
  PATROL_ACCESS_ROLE,
  ROSTER_SHIFT,
  STATUS_LABELS,
  STATUS_TONES,
  describeCallableError,
  resolveAccessRole,
  updateSecurityAssignment,
  validateAccountForm,
} from '@/lib/securityAccounts'

/**
 * Edit one security account: name, badge and contact number. The login email
 * is shown and locked — it is what the account signs in with — and the
 * password is not here at all (Reset password in the directory re-issues and
 * re-flags it in one recorded step).
 *
 *   ┌ [shield] Edit security account                                  [×] ┐
 *   │          Update this guard's details. The login email cannot change.│
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │ OFFICER DETAILS      Guard full name* · Badge ID* · Contact number  │
 *   │ SYSTEM CREDENTIALS   Login email (disabled) · password note         │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │                                     (Cancel) (Save account details) │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Drawn on the Incident details' shell and cards (2026-10-19), the same as
 * the Add account form, with DetailFormField for every label and well.
 *
 * Split out of ProvisionAccountModal (2026-10-18), which keeps the two-step
 * CREATE flow and its one-time password handoff. The reference's "Step 1 of 2"
 * is not drawn: an edit is one screen, and a step counter with no step 2
 * would promise a second screen that never comes.
 *
 * The save sends the account's CURRENT role, post and shift back with the
 * edited fields — updateSecurityAssignment validates the whole assignment, and
 * a name fix must not reset a supervisor to Patrol Guard or a post to the
 * creation default.
 */

const formOf = (account) => ({
  fullName: account?.name ?? '',
  badgeNumber: account?.badgeNumber ?? '',
  phone: account?.phone ?? '',
  email: account?.email ?? '',
})

export default function EditSecurityAccountModal({ account, onClose, onSaved }) {
  const open = Boolean(account)
  const [form, setForm] = useState(() => formOf(account))
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)

  // Reset per ACCOUNT, keyed on the uid: `account` is the live listener's
  // object, and re-seeding on every snapshot would wipe a half-typed edit.
  useEffect(() => {
    if (!open) return
    setForm(formOf(account))
    setErrors({})
    setSubmitError('')
    setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.uid])

  const panelRef = useRef(null)
  const firstFieldRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef, initialRef: firstFieldRef })

  // Escape cancels — but never mid-save, so a write cannot outlive its dialog.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const original = formOf(account)
  const dirty =
    form.fullName.trim() !== original.fullName.trim() ||
    form.badgeNumber.trim() !== original.badgeNumber.trim() ||
    form.phone.trim() !== original.phone.trim()

  const set = (key) => (event) => {
    const value = event.target.value
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  async function save(event) {
    event.preventDefault()
    if (busy || !dirty) return
    const found = validateAccountForm(form, { requireCredentials: false })
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    setSubmitError('')
    try {
      await updateSecurityAssignment({
        uid: account.uid,
        fullName: form.fullName.trim(),
        badgeNumber: form.badgeNumber.trim(),
        phone: form.phone.trim(),
        accessRole:
          account.accessRole || (account.role === 'security_head' ? 'security_supervisor' : PATROL_ACCESS_ROLE),
        assignedPost: account.assignedPost || DEFAULT_POST,
        shift: account.shift || ROSTER_SHIFT,
      })
      onSaved?.({ kind: 'updated', name: form.fullName.trim() })
      onClose?.()
    } catch (err) {
      // Inline, beside the button that retries it; the dialog stays open.
      console.error('Security account update failed', err)
      setSubmitError(describeCallableError(err, 'save those changes'))
    } finally {
      setBusy(false)
    }
  }

  const status = account.status
  const roleLabel = ACCESS_ROLE_LABELS[resolveAccessRole(account)] || 'Security officer'

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4 md:p-6"
      onClick={() => !busy && onClose?.()}
      role="presentation"
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-account-title"
        aria-describedby="edit-account-subtitle"
        onSubmit={save}
        onClick={(event) => event.stopPropagation()}
        noValidate
        className="dialog-panel relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
      >
        {/* ═══ HEADER ═══ as the Incident details: icon tile, title with the
            mono badge, record line, pills; ✕ pinned top-right. */}
        <header className="relative shrink-0 border-b border-hairline px-6 py-5 pr-14 sm:px-8 sm:pr-16">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-500 shadow-inner">
              <UserRoundCog size={22} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 id="edit-account-title" className="truncate text-xl font-bold tracking-tight text-text-primary">
                  Edit security account
                </h2>
                {original.badgeNumber ? <Pill className="font-mono tracking-wider">{original.badgeNumber}</Pill> : null}
              </div>
              <p id="edit-account-subtitle" className="mt-0.5 text-xs text-text-muted">
                Update this guard’s details. The login email cannot change.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill tone="brand" icon={ShieldCheck}>
                  {roleLabel}
                </Pill>
                {status ? (
                  <Pill tone={STATUS_TONES[status] ?? 'neutral'}>
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                    {STATUS_LABELS[status] ?? status}
                  </Pill>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40 sm:right-6 sm:top-5"
          >
            <X size={20} />
          </button>
        </header>

        {/* ═══ BODY ═══ */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-base-950/40 p-6 sm:p-8">
          <div className="flex flex-col gap-6">
            <DetailCard icon={UserRound} title="Officer details" bodyClassName="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <DetailFormField
                className="sm:col-span-2"
                htmlFor="edit-fullName"
                label="Guard full name"
                required
                hint="As printed on their company ID."
                error={errors.fullName}
              >
                <input
                  ref={firstFieldRef}
                  id="edit-fullName"
                  type="text"
                  autoComplete="off"
                  value={form.fullName}
                  onChange={set('fullName')}
                  aria-invalid={Boolean(errors.fullName)}
                  aria-describedby={errors.fullName ? 'edit-fullName-error' : 'edit-fullName-hint'}
                  className={detailInputClass({ error: Boolean(errors.fullName) })}
                />
              </DetailFormField>
              <DetailFormField
                htmlFor="edit-badgeNumber"
                label="Badge ID"
                required
                hint="Shown on the roster and on every report they file."
                error={errors.badgeNumber}
              >
                <input
                  id="edit-badgeNumber"
                  type="text"
                  autoComplete="off"
                  value={form.badgeNumber}
                  onChange={set('badgeNumber')}
                  aria-invalid={Boolean(errors.badgeNumber)}
                  aria-describedby={errors.badgeNumber ? 'edit-badgeNumber-error' : 'edit-badgeNumber-hint'}
                  className={detailInputClass({ error: Boolean(errors.badgeNumber), mono: true })}
                />
              </DetailFormField>
              <DetailFormField
                htmlFor="edit-phone"
                label="Official contact number"
                hint="The number the guardhouse calls them on."
                error={errors.phone}
              >
                <input
                  id="edit-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={form.phone}
                  onChange={set('phone')}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? 'edit-phone-error' : 'edit-phone-hint'}
                  className={detailInputClass({ error: Boolean(errors.phone), mono: true })}
                />
              </DetailFormField>
            </DetailCard>

            <DetailCard icon={KeyRound} title="System credentials" bodyClassName="space-y-4">
              <DetailFormField htmlFor="edit-email" label="Login email" required hint="Cannot be changed — it is what this account signs in with.">
                <div className="relative">
                  <Mail size="sm" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    id="edit-email"
                    type="email"
                    value={form.email}
                    disabled
                    aria-describedby="edit-email-hint"
                    className={detailInputClass({ icon: true, disabled: true, className: '!pr-10' })}
                  />
                  <Lock size="sm" aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                </div>
              </DetailFormField>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
                <KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  Passwords cannot be changed here. Use <strong className="font-medium text-text-secondary">Reset password</strong> in
                  the directory — that re-issues and re-flags the account in one recorded step.
                </span>
              </p>
            </DetailCard>

            {submitError ? (
              <p role="alert" className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-xs text-danger">
                {submitError}
              </p>
            ) : null}
          </div>
        </div>

        {/* ═══ FOOTER ═══ */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-base-950 px-6 py-3 sm:px-8">
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <ShieldCheck size={14} className="text-success/70" aria-hidden="true" />
            <span>Every change is recorded in Audit History</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-tint/[0.06] px-5 py-2 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-tint/[0.1] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !dirty}
              title={!dirty && !busy ? 'Nothing has changed yet' : undefined}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-cta)] px-5 py-2 text-xs font-semibold text-[var(--color-cta-fg)] shadow-md transition-[background-color,transform] hover:bg-[var(--color-cta-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
            >
              {busy ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : <Check size="sm" aria-hidden="true" />}
              {busy ? 'Saving…' : 'Save account details'}
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
