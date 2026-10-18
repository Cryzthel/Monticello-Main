import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { KeyRound, Loader2, ShieldCheck, X } from '@shared/icons'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import {
  DEFAULT_POST,
  PATROL_ACCESS_ROLE,
  ROSTER_SHIFT,
  describeCallableError,
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

const FIELD =
  'w-full rounded-xl border bg-base-800/60 px-3.5 py-2.5 text-sm text-text-primary shadow-sm transition-[border-color,box-shadow] duration-150 placeholder:text-text-muted focus:outline-none focus:ring-4 dark:bg-base-900/50'

function Field({ id, label, required = false, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-text-secondary">
        {label} {required ? <span className="text-brand-500">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-2 text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

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

  const fieldTone = (key) =>
    errors[key]
      ? 'border-danger/60 focus:border-danger focus:ring-danger/10'
      : 'border-hairline focus:border-brand-500 focus:ring-brand-500/10'

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
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
        className="officer-modal-enter relative flex max-h-[90dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl shadow-black/50 sm:max-h-[90vh] sm:rounded-2xl dark:bg-base-950"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline px-6 py-5">
          <div className="flex min-w-0 items-start gap-4">
            <span className="shrink-0 rounded-xl border border-brand-500/20 bg-brand-500/10 p-2.5 text-brand-400">
              <ShieldCheck size="md" aria-hidden="true" />
            </span>
            <div className="mt-0.5 flex min-w-0 flex-col">
              <h2 id="edit-account-title" className="text-lg font-semibold leading-snug tracking-tight text-text-primary">
                Edit security account
              </h2>
              <p id="edit-account-subtitle" className="mt-1 text-sm leading-relaxed text-text-secondary">
                Update this guard’s details. The login email cannot change.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-40"
          >
            <X size="md" />
          </button>
        </header>

        <div className="custom-scrollbar drawer-scroll min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain p-6">
          <section>
            <h3 className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-text-muted">Officer details</h3>
            <div className="space-y-5">
              <Field
                id="edit-fullName"
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
                  className={`${FIELD} ${fieldTone('fullName')}`}
                />
              </Field>
              <Field
                id="edit-badgeNumber"
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
                  className={`${FIELD} font-mono ${fieldTone('badgeNumber')}`}
                />
              </Field>
              <Field
                id="edit-phone"
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
                  className={`${FIELD} ${fieldTone('phone')}`}
                />
              </Field>
            </div>
          </section>

          <section>
            <h3 className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-text-muted">System credentials</h3>
            <div className="space-y-5">
              <Field id="edit-email" label="Login email" required hint="Cannot be changed — it is what this account signs in with.">
                <input
                  id="edit-email"
                  type="email"
                  value={form.email}
                  disabled
                  aria-describedby="edit-email-hint"
                  className="w-full cursor-not-allowed rounded-xl border border-hairline bg-base-800/40 px-3.5 py-2.5 text-sm text-text-muted shadow-sm dark:bg-base-900/30"
                />
              </Field>
              <div className="flex items-start gap-3.5 rounded-xl border border-hairline bg-base-800/40 p-4 dark:bg-base-900/40">
                <KeyRound size="sm" className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
                <p className="text-sm leading-relaxed text-text-secondary">
                  Passwords cannot be changed here. Use{' '}
                  <strong className="font-medium text-text-primary">Reset password</strong> in the directory — that
                  re-issues and re-flags the account in one recorded step.
                </p>
              </div>
            </div>
          </section>
        </div>

        <footer className="shrink-0 border-t border-hairline bg-base-900/90 px-6 py-4 backdrop-blur-md dark:bg-base-950/90">
          {submitError ? (
            <p role="alert" className="mb-3 rounded-xl border border-danger/25 bg-danger/10 p-2.5 text-xs text-danger">
              {submitError}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-full px-5 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !dirty}
              title={!dirty && !busy ? 'Nothing has changed yet' : undefined}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-segment-active)] px-5 py-2.5 text-sm font-medium text-[var(--color-segment-active-fg)] shadow-[0_0_20px_-5px_color-mix(in_oklab,var(--color-segment-active)_40%,transparent)] transition-[background-color,transform,opacity] duration-150 hover:bg-[color-mix(in_oklab,var(--color-segment-active)_85%,white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
            >
              {busy ? <Loader2 size="sm" className="animate-spin" aria-hidden="true" /> : null}
              {busy ? 'Saving…' : 'Save account details'}
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
