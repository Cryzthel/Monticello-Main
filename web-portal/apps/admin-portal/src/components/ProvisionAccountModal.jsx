import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  Eye,
  EyeOff,
  IdCard,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UserRound,
  X,
} from '@shared/icons'
import Select from '@shared/components/Select'
import { MetaItem, MetaList } from '@shared/components/MetaList'
import CredentialHandoff from '@/components/CredentialHandoff'
import {
  ACCESS_ROLES,
  POSTS,
  SHIFTS,
  createSecurityAccount,
  describeCallableError,
  generateTempPassword,
  resolveAccessRole,
  updateSecurityAssignment,
  validateAccountForm,
} from '@/lib/securityAccounts'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'

/**
 * Add a guardhouse account, or edit an existing one — as three steps.
 *
 * -- THREE STEPS, IN THE ORDER A ROSTER IS READ ----------------------------
 *   1. Guard details    who they are: full name, badge ID
 *   2. Role and post    what they can do, where they stand, when
 *   3. Credentials      how they first sign in — and a review of 1 and 2
 *
 * It was one scrolling form of seven fields under three eyebrow headings, with
 * the only "Create account" at the bottom of the scroll. As steps, each screen
 * asks one question, each is validated before it can be left, and the last one
 * shows everything that is about to be written before the button that writes
 * it. A final validation failure jumps back to the step that holds the error.
 *
 * Editing uses the same steps as tabs: every step is reachable from the
 * stepper, and "Save changes" is on every step — an admin fixing a shift should
 * not have to page through a badge number to reach the button.
 *
 * -- WHAT IS DELIBERATELY NOT A FIELD --------------------------------------
 *   • THE PASSWORD IS NOT TYPEABLE. It is generated on this device by a CSPRNG
 *     (see generateTempPassword) and shown read-only with a New password
 *     control. An admin-invented password is the weakest credential the
 *     guardhouse would ever issue.
 *   • THERE IS NO "FORCE A PASSWORD CHANGE" SWITCH. New accounts always
 *     require one; its only other setting produced a permanent shared password
 *     that had been read aloud at a handover.
 *
 * -- ONE HEIGHT FOR EVERY CONTROL ------------------------------------------
 * Text inputs were `.field` (38px) beside `Select size="touch"` (36px), so the
 * text box and the dropdown next to it never shared a baseline, and the "New
 * password" button beside the password field was a third height. All three are
 * now 44px on touch and 36px from `sm:`.
 *
 * -- THE HANDOFF IS NOT A CONFIRMATION -------------------------------------
 * After Create, the dialog swaps to CredentialHandoff: the ONLY time the
 * temporary password exists anywhere an admin can read it. The callable
 * returns it, this panel shows it, and nothing writes it down. So the dialog
 * refuses to close on a backdrop click or Escape while the handoff is showing —
 * the reflex click that dismisses a toast would here destroy the credential the
 * new hire has not been given yet.
 */

const EMPTY_FORM = {
  fullName: '',
  email: '',
  badgeNumber: '',
  accessRole: '',
  assignedPost: '',
  shift: '',
  password: '',
}

const STEPS = [
  {
    key: 'guard',
    label: 'Guard details',
    description: 'Who is being added to the roster.',
    icon: UserRound,
    fields: ['fullName', 'badgeNumber'],
  },
  {
    key: 'assignment',
    label: 'Role and post',
    description: 'What they can do in the portal, where they report, and when.',
    icon: Briefcase,
    fields: ['accessRole', 'assignedPost', 'shift'],
  },
  {
    key: 'credentials',
    label: 'Credentials',
    description: 'How they sign in the first time. Check the details above before creating.',
    icon: KeyRound,
    fields: ['email', 'password'],
  },
]

const LAST_STEP = STEPS.length - 1

/** The errors that belong to one step, out of a whole-form validation. */
function errorsForStep(all, index) {
  return Object.fromEntries(Object.entries(all).filter(([key]) => STEPS[index].fields.includes(key)))
}

// -- FORM PRIMITIVES ---------------------------------------------------------

/**
 * One labelled control, with a sentence-case `.meta-label` label.
 *
 * The message slot under it is always present (`min-h-5`), not conditionally
 * inserted. A message that appears by pushing the next field down moves the
 * control the operator is about to click at the moment they reach for it.
 */
function Field({ label, htmlFor, error, hint, required, className = '', children }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className="meta-label mb-1.5 flex items-center gap-1">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        ) : null}
      </label>
      {children}
      <div className="min-h-5 pt-1">
        {error ? (
          <p id={`${htmlFor}-error`} className="text-xs font-medium leading-snug text-danger">
            {error}
          </p>
        ) : hint ? (
          <p className="text-xs leading-snug text-text-muted">{hint}</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A text input wired to its own error state, so `aria-invalid` cannot drift.
 * `h-11 sm:h-9 py-0` matches `Select size="touch"` exactly — see the header.
 */
function TextInput({ id, error, icon: Icon, className = '', ...rest }) {
  return (
    <div className="relative">
      {Icon ? (
        <Icon size="sm" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
      ) : null}
      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`field h-11 py-0 sm:h-9 ${Icon ? 'pl-9' : ''} ${
          error ? 'border-danger focus:border-danger focus:ring-danger/20' : ''
        } ${className}`}
        {...rest}
      />
    </div>
  )
}

/** The progress rail. Done steps carry a check; the current one is filled. */
function Stepper({ step, editing, busy, onJump }) {
  return (
    <ol className="flex items-center gap-2 px-6 pb-4" aria-label="Steps">
      {STEPS.map((item, index) => {
        const state = index === step ? 'current' : index < step ? 'done' : 'todo'
        // Creating: back to any finished step, forward only through Next, so a
        // step is never skipped unvalidated. Editing: every step, every time.
        const reachable = index !== step && (editing || index < step)
        return (
          <li key={item.key} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <button
              type="button"
              disabled={!reachable || busy}
              onClick={() => onJump(index)}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-1 text-left disabled:cursor-default"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset transition-colors duration-150 ${
                  state === 'current'
                    ? 'surface-brand ring-transparent'
                    : state === 'done'
                      ? 'bg-brand-100 text-brand-400 ring-brand-500/30'
                      : 'bg-base-800 text-text-muted ring-slate-200'
                }`}
              >
                {state === 'done' ? <Check size="sm" /> : index + 1}
              </span>
              <span
                className={`hidden truncate text-sm sm:block ${
                  state === 'current' ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary'
                }`}
              >
                {item.label}
              </span>
            </button>
            {index < LAST_STEP ? (
              <span
                aria-hidden="true"
                className={`h-px min-w-4 flex-1 transition-colors duration-200 ${
                  index < step ? 'bg-brand-500' : 'bg-slate-200'
                }`}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

// -- DIALOG ------------------------------------------------------------------

export default function ProvisionAccountModal({ open, account = null, onClose, onSaved }) {
  const panelRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef })
  const editing = Boolean(account)

  const [form, setForm] = useState(EMPTY_FORM)
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [credentials, setCredentials] = useState(null)

  const stepBodyRef = useRef(null)

  // Reset every time the dialog opens. Without this, closing a half-filled
  // "New account" form and reopening it hands the next officer the previous
  // one's badge number — and on an edit, the previously selected row's values.
  useEffect(() => {
    if (!open) return
    setStep(0)
    setErrors({})
    setSubmitError('')
    setCredentials(null)
    setRevealed(false)
    setForm(
      account
        ? {
            fullName: account.name ?? '',
            email: account.email ?? '',
            badgeNumber: account.badgeNumber ?? '',
            // Derived rather than read straight off the document, so an account
            // provisioned before this field existed still opens with its role
            // selected instead of an empty dropdown.
            accessRole: resolveAccessRole(account),
            assignedPost: account.assignedPost ?? '',
            shift: account.shift ?? '',
            password: '',
          }
        : { ...EMPTY_FORM, password: generateTempPassword() },
    )
  }, [open, account])

  // Focus the first editable control of each step as it arrives.
  //
  // `preventScroll` is what keeps the page behind the dialog still. This used
  // to wait a requestAnimationFrame for the same reason, which made focus
  // depend on a frame being produced — and it measurably did not land on
  // every step. Focusing in the commit that shows the step, without scrolling,
  // gets the same protection with no timing dependency.
  //
  // `button[aria-expanded]` is how a Select trigger is found — it carries
  // aria-expanded and no aria-haspopup — so the Role and post step, whose
  // first control is a dropdown, still receives focus.
  useEffect(() => {
    if (!open || credentials) return
    stepBodyRef.current
      ?.querySelector('input:not([disabled]):not([readonly]), button[aria-expanded]')
      ?.focus({ preventScroll: true })
  }, [open, step, credentials])

  // Escape closes the FORM but never the handoff — see the file header.
  useEffect(() => {
    if (!open) return undefined
    function handleKeydown(event) {
      if (event.key === 'Escape' && !busy && !credentials) onClose?.()
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [open, busy, credentials, onClose])

  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }))
    // Clear only the errors for the fields being edited. Clearing all of them
    // would make a form with three problems look solved after fixing one.
    setErrors((prev) => {
      const next = { ...prev }
      Object.keys(patch).forEach((key) => delete next[key])
      return next
    })
  }

  function validateAll() {
    return validateAccountForm(form, { requireCredentials: !editing })
  }

  function goNext() {
    const found = errorsForStep(validateAll(), step)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setStep((current) => Math.min(current + 1, LAST_STEP))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    // Enter on an intermediate step means "next", not "create" — creating
    // mode only. Editing saves from any step.
    if (!editing && step < LAST_STEP) {
      goNext()
      return
    }

    const found = validateAll()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const firstBad = STEPS.findIndex((item) => item.fields.some((field) => found[field]))
      if (firstBad >= 0) setStep(firstBad)
      return
    }

    setBusy(true)
    setSubmitError('')
    try {
      if (editing) {
        // `accessRole` goes over the wire; the RBAC role and the duty list are
        // derived SERVER-SIDE from it (functions/securityProvisioning.js).
        // Sending a role the client picked would make the browser the
        // authority on its own privilege level.
        await updateSecurityAssignment({
          uid: account.uid,
          fullName: form.fullName.trim(),
          badgeNumber: form.badgeNumber.trim(),
          accessRole: form.accessRole,
          assignedPost: form.assignedPost,
          shift: form.shift,
        })
        onSaved?.({ kind: 'updated', name: form.fullName.trim() })
        onClose?.()
      } else {
        const result = await createSecurityAccount({
          fullName: form.fullName.trim(),
          email: form.email.trim().toLowerCase(),
          badgeNumber: form.badgeNumber.trim(),
          accessRole: form.accessRole,
          assignedPost: form.assignedPost,
          shift: form.shift,
          password: form.password,
          // Not a form value. Every new guardhouse credential is one-time by
          // construction — see the file header.
          forcePasswordReset: true,
        })
        // Swap to the handoff rather than closing. The password came back in
        // this response and exists nowhere else.
        setCredentials({
          fullName: form.fullName.trim(),
          email: result?.email ?? form.email.trim().toLowerCase(),
          badgeNumber: form.badgeNumber.trim(),
          password: form.password,
          forcePasswordReset: true,
        })
        onSaved?.({ kind: 'created', name: form.fullName.trim() })
      }
    } catch (err) {
      console.error('Security account write failed', err)
      setSubmitError(describeCallableError(err, editing ? 'save those changes' : 'create that account'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const roleOptions = ACCESS_ROLES.map((r) => ({ value: r.value, label: r.label }))
  const postOptions = POSTS.map((p) => ({ value: p.value, label: p.label }))
  const shiftOptions = SHIFTS.map((s) => ({ value: s.value, label: s.label, hint: s.window }))
  const current = STEPS[step]
  const StepIcon = current.icon
  const labelOf = (list, value) => list.find((item) => item.value === value)?.label ?? ''

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim sm:items-center sm:p-4"
      // A backdrop click closes the form and is INERT over the handoff.
      onClick={() => !busy && !credentials && onClose?.()}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          credentials ? 'Account credentials' : editing ? 'Edit security account' : 'Create security account'
        }
        onClick={(event) => event.stopPropagation()}
        className="custom-scrollbar max-h-[80dvh] w-full max-w-2xl dialog-panel overflow-y-auto rounded-xl rounded-b-none border border-hairline bg-base-850 shadow-modal sm:max-h-[88vh] sm:rounded-b-xl"
      >
        {credentials ? (
          <CredentialHandoff credentials={credentials} onDone={onClose} />
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            {/* Sticky, so the step rail stays in view on a laptop viewport
                where a step can scroll. */}
            <header className="sticky top-0 z-10 border-b border-hairline bg-base-850">
              <div className="flex items-start gap-4 px-6 pb-4 pt-5">
                <span className="icon-tile icon-tile-md">
                  {editing ? <IdCard size="md" /> : <UserPlus size="md" />}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold leading-tight text-text-primary">
                    {editing ? 'Edit security account' : 'Create security account'}
                  </h2>
                  <p className="mt-1 text-sm leading-snug text-text-secondary">
                    {editing
                      ? 'Update this guard’s details and where they are posted.'
                      : 'Creates a Guardhouse Portal login and a one-time password to hand over.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  aria-label="Close"
                  className="icon-btn icon-btn-sm -mr-1 shrink-0 text-text-secondary hover:text-text-primary"
                >
                  <X size="sm" />
                </button>
              </div>
              <Stepper step={step} editing={editing} busy={busy} onJump={setStep} />
            </header>

            {/* Keyed on the step, so each arrival replays `.step-enter`. The
                minimum height keeps the dialog from jumping between a
                two-field step and a three-field one. */}
            <div ref={stepBodyRef} key={current.key} className="step-enter space-y-5 px-6 py-5 sm:min-h-[18rem]">
              <div className="flex items-start gap-3">
                <StepIcon size="md" className="mt-0.5 shrink-0 text-brand-400" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text-primary">{current.label}</h3>
                  <p className="mt-0.5 text-sm text-text-secondary">{current.description}</p>
                </div>
              </div>

              {current.key === 'guard' ? (
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                  <Field
                    label="Guard full name"
                    htmlFor="sa-name"
                    required
                    error={errors.fullName}
                    hint="As printed on their company ID."
                  >
                    <TextInput
                      id="sa-name"
                      value={form.fullName}
                      error={errors.fullName}
                      autoComplete="off"
                      placeholder="e.g. Roberto D. Santos"
                      onChange={(e) => update({ fullName: e.target.value })}
                    />
                  </Field>

                  <Field
                    label="Badge ID"
                    htmlFor="sa-badge"
                    required
                    error={errors.badgeNumber}
                    hint="Shown on the roster and on every report they file."
                  >
                    <TextInput
                      id="sa-badge"
                      icon={ShieldCheck}
                      value={form.badgeNumber}
                      error={errors.badgeNumber}
                      autoComplete="off"
                      placeholder="e.g. MV-0142"
                      onChange={(e) => update({ badgeNumber: e.target.value.toUpperCase() })}
                    />
                  </Field>
                </div>
              ) : null}

              {current.key === 'assignment' ? (
                /* The role also decides the duty list, SERVER-SIDE — a Gate
                   Guard guards a gate — which is why there is no second control
                   asking the operator to keep the two consistent. */
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
                  <Field
                    label="Access role"
                    htmlFor="sa-role"
                    required
                    error={errors.accessRole}
                    hint={
                      ACCESS_ROLES.find((r) => r.value === form.accessRole)?.hint ??
                      'Sets what they can see and do.'
                    }
                  >
                    <Select
                      ariaLabel="Access role"
                      value={form.accessRole}
                      onChange={(value) => update({ accessRole: value })}
                      options={roleOptions}
                      placeholder="Select a role"
                      size="touch"
                      variant="field"
                      className="w-full"
                    />
                  </Field>

                  <Field
                    label="Assigned post"
                    htmlFor="sa-post"
                    required
                    error={errors.assignedPost}
                    hint="Where they report for duty."
                  >
                    <Select
                      ariaLabel="Assigned post"
                      value={form.assignedPost}
                      onChange={(value) => update({ assignedPost: value })}
                      options={postOptions}
                      placeholder="Select a post"
                      size="touch"
                      variant="field"
                      className="w-full"
                    />
                  </Field>

                  <Field
                    label="Shift"
                    htmlFor="sa-shift"
                    required
                    error={errors.shift}
                    hint="Can be changed at any time."
                  >
                    <Select
                      ariaLabel="Shift"
                      value={form.shift}
                      onChange={(value) => update({ shift: value })}
                      options={shiftOptions}
                      placeholder="Select a shift"
                      size="touch"
                      variant="field"
                      className="w-full"
                    />
                  </Field>
                </div>
              ) : null}

              {current.key === 'credentials' ? (
                <>
                  {/* The review. Everything steps 1 and 2 are about to write,
                      in one place, directly above the button that writes it. */}
                  <div className="rounded-xl border border-hairline bg-base-800 p-4">
                    <MetaList>
                      <MetaItem label="Guard">{form.fullName.trim()}</MetaItem>
                      <MetaItem label="Badge ID" mono>{form.badgeNumber.trim()}</MetaItem>
                      <MetaItem label="Access role">{labelOf(ACCESS_ROLES, form.accessRole)}</MetaItem>
                      <MetaItem label="Assigned post">{labelOf(POSTS, form.assignedPost)}</MetaItem>
                      <MetaItem label="Shift">{labelOf(SHIFTS, form.shift)}</MetaItem>
                    </MetaList>
                  </div>

                  <Field
                    label="Login email"
                    htmlFor="sa-email"
                    required
                    error={errors.email}
                    hint={
                      editing
                        ? 'Cannot be changed — it is what this account signs in with.'
                        : 'They sign in with this. It cannot be changed later.'
                    }
                  >
                    <TextInput
                      id="sa-email"
                      type="email"
                      icon={Mail}
                      value={form.email}
                      error={errors.email}
                      // Read-only rather than absent on an edit: the email IS
                      // the account, and hiding it makes an admin verify they
                      // have the right row somewhere else.
                      readOnly={editing}
                      disabled={editing}
                      autoComplete="off"
                      placeholder="officer@monticellovillas.ph"
                      onChange={(e) => update({ email: e.target.value })}
                    />
                  </Field>

                  {editing ? (
                    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-base-800 p-4">
                      <KeyRound size="sm" className="mt-0.5 shrink-0 text-text-secondary" />
                      <p className="text-sm leading-relaxed text-text-secondary">
                        Passwords cannot be changed here. Use{' '}
                        <strong className="font-semibold text-text-primary">Reset password</strong> in the
                        directory — that re-issues and re-flags the account in one recorded step.
                      </p>
                    </div>
                  ) : (
                    <Field
                      label="Temporary password"
                      htmlFor="sa-password"
                      error={errors.password}
                      hint="Made on this device. They set their own the first time they sign in."
                    >
                      <div className="flex items-stretch gap-2">
                        <div className="relative min-w-0 flex-1">
                          <input
                            id="sa-password"
                            type={revealed ? 'text' : 'password'}
                            value={form.password}
                            // Read-only, not disabled: a disabled input leaves the
                            // tab order and some engines hide it from screen
                            // readers, and this is the one value the operator
                            // has to be able to read out loud.
                            readOnly
                            aria-invalid={errors.password ? 'true' : undefined}
                            aria-describedby={errors.password ? 'sa-password-error' : undefined}
                            className={`field h-11 cursor-default py-0 pr-11 font-mono sm:h-9 ${
                              errors.password ? 'border-danger' : ''
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setRevealed((v) => !v)}
                            aria-label={revealed ? 'Hide password' : 'Show password'}
                            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:text-text-primary sm:h-7 sm:w-7"
                          >
                            {revealed ? <EyeOff size="sm" /> : <Eye size="sm" />}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => update({ password: generateTempPassword() })}
                          className="btn btn-sm btn-outline h-11 shrink-0 sm:h-9"
                        >
                          <RefreshCw size="sm" />
                          New password
                        </button>
                      </div>
                    </Field>
                  )}
                </>
              ) : null}

              {submitError ? (
                <p className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
                  <AlertTriangle size="sm" className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{submitError}</span>
                </p>
              ) : null}
            </div>

            {/* Compact actions: the standard `btn-sm`, never the 44px tier. The
                loudest thing on a data-entry dialog should not be the pair of
                controls pressed once. */}
            <footer className="sticky bottom-0 flex items-center gap-2 border-t border-hairline bg-base-850 px-6 py-3.5">
              <p className="mr-auto text-sm text-text-muted">
                Step {step + 1} of {STEPS.length}
              </p>

              {step === 0 ? (
                <button type="button" onClick={onClose} disabled={busy} className="btn btn-sm btn-outline">
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={busy}
                  className="btn btn-sm btn-outline"
                >
                  <ArrowLeft size="sm" />
                  Back
                </button>
              )}

              {editing || step === LAST_STEP ? (
                <button type="submit" disabled={busy} className="btn btn-sm btn-brand">
                  {busy ? <Loader2 size="sm" className="animate-spin" /> : <Check size="sm" />}
                  {editing ? 'Save changes' : 'Create account'}
                </button>
              ) : (
                <button type="submit" disabled={busy} className="btn btn-sm btn-brand">
                  Next
                  <ArrowRight size="sm" />
                </button>
              )}
            </footer>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
