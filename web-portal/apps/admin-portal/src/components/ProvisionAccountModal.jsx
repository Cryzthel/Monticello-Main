import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  IdCard,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from '@shared/icons'
import CredentialHandoff from '@/components/CredentialHandoff'
import { DEFAULT_POST, PATROL_ACCESS_ROLE, ROSTER_SHIFT,
  createSecurityAccount,
  describeCallableError,
  generateTempPassword,
  validateAccountForm,
} from '@/lib/securityAccounts'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { toast } from '@shared/lib/toast'
import Tooltip from '@shared/components/Tooltip'

/**
 * Add a guardhouse account — two steps (user's reference, 2026-10-18).
 * CREATE ONLY: changing an existing account is EditSecurityAccountModal, a
 * one-screen dialog (split out 2026-10-18).
 *
 *   ┌ [shield] Create security account                                      ┐
 *   │ ✓ Step 1: Guard details ─────── 2 Step 2: Credentials & access          │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │ STEP 1  [amber banner if Continue is pressed with fields missing]       │
 *   │         Full name (i) · Badge ID (i) · Official contact number (i)      │
 *   │ STEP 2  System credentials: login email · temporary password            │
 *   │         (Generate) [copy] [show]                                        │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │ Step 1 of 2                                   (Cancel) (Continue →)     │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE LOCK ───────────────────────────────────────────────────────────────
 * Step 2 stays locked until step 1 validates, and pressing it (or Continue)
 * early shows which fields are missing instead of moving.
 *
 * ── WHAT IS DELIBERATELY NOT A FIELD ───────────────────────────────────────
 *   • NO ROLE PICKER. Every account is a Patrol Guard. That is said where it
 *     matters — in the full-name field's tooltip and hint — rather than in a
 *     static banner (removed 2026-10-18).
 *   • ONE CANCEL. The header × was a second Cancel; Escape and the backdrop
 *     still close the form.
 *   • NO USERNAME. The reference shows one, but a guard signs in with their
 *     email; a username would be a second identifier nothing reads.
 *   • THE PASSWORD IS NOT TYPEABLE. It is generated on this device by a CSPRNG
 *     (generateTempPassword); "Generate" makes another. The guard must replace
 *     it at first sign-in (forcePasswordReset is always sent).
 *
 * ── THE HANDOFF IS NOT A CONFIRMATION ──────────────────────────────────────
 * After Create the dialog swaps to CredentialHandoff — the only time the
 * temporary password exists anywhere an admin can read it — and refuses to
 * close on a backdrop click or Escape while it is showing.
 *
 * The new contact number is saved by the provisioning functions
 * (functions/securityProvisioning.js, `phone`), which must be deployed for it
 * to persist.
 */

const EMPTY_FORM = { fullName: '', badgeNumber: '', phone: '', email: '', password: '' }

// Every account is a Patrol Guard. Creating sends the patrol access role (RBAC
// `security_officer`, derived server-side); the callable also requires a post
// and shift, which are constants now — see functions/securityProvisioning.js.

const STEPS = [
  { key: 'guard', label: 'Guard details', fields: ['fullName', 'badgeNumber', 'phone'] },
  { key: 'credentials', label: 'Credentials & access', fields: ['email', 'password'] },
]
const LAST_STEP = STEPS.length - 1

const errorsForStep = (all, index) =>
  Object.fromEntries(Object.entries(all).filter(([key]) => STEPS[index].fields.includes(key)))

// ── FORM PRIMITIVES ─────────────────────────────────────────────────────────

/** Label, control, and an always-present message slot (so nothing jumps). */
function Field({ label, htmlFor, error, hint, required, tip = null, action = null, children }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <label htmlFor={htmlFor} className="block text-xs font-medium text-text-secondary">
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-0.5 text-brand-500">
                *
              </span>
            ) : null}
          </label>
          {tip ? (
            <Tooltip label={label} hint={tip} side="top">
              <button
                type="button"
                aria-label={`About ${label.toLowerCase()}: ${tip}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                <Info size={14} />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {action}
      </div>
      {children}
      <div className="min-h-4">
        {error ? (
          <p id={`${htmlFor}-error`} className="text-[11px] font-medium leading-snug text-danger">
            {error}
          </p>
        ) : hint ? (
          <p className="text-[11px] leading-snug text-text-muted">{hint}</p>
        ) : null}
      </div>
    </div>
  )
}

/** An input with a leading glyph, wired to its own error state. */
function TextInput({ id, error, icon: Icon, mono = false, className = '', ...rest }) {
  return (
    <div className="relative">
      <Icon size="sm" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`field h-11 rounded-xl py-0 pl-9 text-sm sm:h-10 sm:text-xs ${mono ? 'font-mono' : ''} ${
          error ? 'border-danger focus:border-danger focus:ring-danger/20' : ''
        } ${className}`}
        {...rest}
      />
    </div>
  )
}

/**
 * The step indicator: both steps named ("Step 1: Guard details"), a check on a
 * finished step, and a lock on one not yet reachable. Each step label is a
 * button. (The percentage bar under it was removed at the user's request,
 * 2026-10-18.)
 */
function ProgressSteps({ step, unlocked, busy, onJump }) {
  return (
    <div>
      <ol className="flex items-center gap-3" aria-label="Progress">
        {STEPS.map((item, index) => {
          const current = index === step
          const done = !current && (index === 0 ? unlocked : false)
          const locked = index > 0 && !unlocked
          return (
            <li key={item.key} className="flex min-w-0 flex-1 items-center gap-3 last:flex-none">
              <button
                type="button"
                disabled={busy}
                aria-current={current ? 'step' : undefined}
                aria-disabled={locked || undefined}
                onClick={() => onJump(index)}
                className={`group flex min-w-0 items-center gap-2 rounded-full py-1 pr-2 text-left transition-opacity ${
                  locked ? 'cursor-not-allowed opacity-60' : ''
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset transition-colors duration-200 ${
                    current
                      ? 'bg-[var(--color-segment-active)] text-[var(--color-segment-active-fg)] ring-transparent'
                      : done
                        ? 'bg-brand-500/15 text-brand-500 ring-brand-500/30'
                        : 'bg-tint/[0.06] text-text-muted ring-hairline'
                  }`}
                >
                  {done ? <Check size={14} /> : locked ? <Lock size={12} /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Step {index + 1}
                  </span>
                  <span
                    className={`block truncate text-xs ${
                      current ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary group-hover:text-text-primary'
                    }`}
                  >
                    {item.label}
                  </span>
                </span>
              </button>
              {index < LAST_STEP ? (
                <span aria-hidden="true" className={`h-px min-w-4 flex-1 ${unlocked ? 'bg-brand-500/60' : 'bg-hairline'}`} />
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ── DIALOG ──────────────────────────────────────────────────────────────────

export default function ProvisionAccountModal({ open, onClose, onSaved }) {
  const panelRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef })

  const [form, setForm] = useState(EMPTY_FORM)
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState({})
  const [showStepWarning, setShowStepWarning] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [credentials, setCredentials] = useState(null)
  const stepBodyRef = useRef(null)

  // Reset on every open, so a half-filled form never carries into the next.
  useEffect(() => {
    if (!open) return
    setStep(0)
    setErrors({})
    setShowStepWarning(false)
    setSubmitError('')
    setCredentials(null)
    setRevealed(false)
    setCopied(false)
    setForm({ ...EMPTY_FORM, password: generateTempPassword() })
  }, [open])

  // Focus the first editable control of each step as it arrives.
  useEffect(() => {
    if (!open || credentials) return
    stepBodyRef.current?.querySelector('input:not([disabled]):not([readonly])')?.focus({ preventScroll: true })
  }, [open, step, credentials])

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  // Escape closes the FORM but never the handoff.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy && !credentials) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, credentials, onClose])

  const validateAll = () => validateAccountForm(form, { requireCredentials: true })
  const allErrors = validateAll()
  const step1Valid = Object.keys(errorsForStep(allErrors, 0)).length === 0

  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }))
    // Clear only the edited fields' errors.
    setErrors((prev) => {
      const next = { ...prev }
      Object.keys(patch).forEach((key) => delete next[key])
      return next
    })
  }

  /** Move to a step. Forward only once the current step validates. */
  function goTo(target) {
    if (target === step) return
    if (target > step) {
      const found = errorsForStep(validateAll(), step)
      if (Object.keys(found).length > 0) {
        setErrors(found)
        setShowStepWarning(true)
        return
      }
    }
    setShowStepWarning(false)
    setStep(target)
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(form.password)
      setCopied(true)
    } catch {
      toast.error('Could not copy the password', { description: 'Show it and read it out instead.' })
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    // Enter on step 1 means "continue", not "create".
    if (step < LAST_STEP) {
      goTo(step + 1)
      return
    }

    const found = validateAll()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const firstBad = STEPS.findIndex((item) => item.fields.some((field) => found[field]))
      if (firstBad >= 0) setStep(firstBad)
      if (firstBad === 0) setShowStepWarning(true)
      return
    }

    setBusy(true)
    setSubmitError('')
    try {
      const result = await createSecurityAccount({
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        badgeNumber: form.badgeNumber.trim(),
        phone: form.phone.trim(),
        accessRole: PATROL_ACCESS_ROLE,
        assignedPost: DEFAULT_POST,
        shift: ROSTER_SHIFT,
        password: form.password,
        forcePasswordReset: true,
      })
      // Swap to the handoff: the password exists nowhere else.
      setCredentials({
        fullName: form.fullName.trim(),
        email: result?.email ?? form.email.trim().toLowerCase(),
        badgeNumber: form.badgeNumber.trim(),
        password: form.password,
        forcePasswordReset: true,
      })
      onSaved?.({ kind: 'created', name: form.fullName.trim() })
    } catch (err) {
      console.error('Security account write failed', err)
      setSubmitError(describeCallableError(err, 'create that account'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const primaryBtn =
    'inline-flex items-center gap-1.5 rounded-full bg-[var(--color-segment-active)] px-5 py-2.5 text-xs font-semibold text-[var(--color-segment-active-fg)] shadow-md transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50'
  const secondaryBtn =
    'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-tint/[0.05] px-5 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-tint/[0.1] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50'

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-4"
      onClick={() => !busy && !credentials && onClose?.()}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={credentials ? 'Account credentials' : 'Create security account'}
        onClick={(event) => event.stopPropagation()}
        className="dialog-panel flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl shadow-black/60 sm:rounded-2xl"
      >
        {credentials ? (
          <div className="custom-scrollbar overflow-y-auto">
            <CredentialHandoff credentials={credentials} onDone={onClose} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col">
            {/* ── Header ── */}
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline px-6 py-5">
              <div className="flex min-w-0 items-start gap-3.5">
                <span className="mt-0.5 flex shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 p-2.5 text-brand-500">
                  <ShieldCheck size="md" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold tracking-tight text-text-primary">
                    Create security account
                  </h2>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Fill out guard details before configuring account credentials.
                  </p>
                </div>
              </div>
            </header>

            {/* ── Progress ── */}
            <div className="shrink-0 border-b border-hairline px-6 pb-4 pt-4">
              <ProgressSteps step={step} unlocked={step1Valid} busy={busy} onJump={goTo} />
            </div>

            {/* ── Step body ── keyed so each arrival replays `.step-enter`. */}
            <div ref={stepBodyRef} key={STEPS[step].key} className="step-enter custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-6 sm:min-h-[20rem]">
              {step === 0 ? (
                <>
                  {showStepWarning && !step1Valid ? (
                    <p role="alert" className="flex items-center gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                      <AlertTriangle size="sm" className="shrink-0" aria-hidden="true" />
                      <span>
                        Complete the required fields below to unlock step 2: full name, badge ID and
                        contact number.
                      </span>
                    </p>
                  ) : null}

                  <div className="space-y-2">
                    <Field
                      label="Guard full name"
                      htmlFor="sa-name"
                      required
                      error={errors.fullName}
                      tip="Every security account is created as a Patrol Guard — the role and patrol posting are assigned automatically."
                      hint="As printed on their company ID. Joins as a Patrol Guard."
                    >
                      <TextInput
                        id="sa-name"
                        icon={UserRound}
                        value={form.fullName}
                        error={errors.fullName}
                        autoComplete="off"
                        placeholder="e.g. Juan Dela Cruz"
                        onChange={(e) => update({ fullName: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Badge ID"
                      htmlFor="sa-badge"
                      required
                      error={errors.badgeNumber}
                      tip="Letters, numbers and dashes, 2–16 characters. Must be unique — the server refuses a badge already in use."
                      hint="Shown on the roster and on every report they file."
                    >
                      <TextInput
                        id="sa-badge"
                        icon={IdCard}
                        mono
                        value={form.badgeNumber}
                        error={errors.badgeNumber}
                        autoComplete="off"
                        placeholder="e.g. MV-0142"
                        onChange={(e) => update({ badgeNumber: e.target.value.toUpperCase() })}
                      />
                    </Field>
                    <Field
                      label="Official contact number"
                      htmlFor="sa-phone"
                      required
                      error={errors.phone}
                      tip="7–20 digits; spaces, +, - and () are fine. Used by the guardhouse to reach them on shift." 
                      hint="The number the guardhouse calls them on."
                    >
                      <TextInput
                        id="sa-phone"
                        type="tel"
                        icon={Phone}
                        mono
                        inputMode="tel"
                        value={form.phone}
                        error={errors.phone}
                        autoComplete="off"
                        placeholder="+63 9XX XXX XXXX"
                        onChange={(e) => update({ phone: e.target.value })}
                      />
                    </Field>
                  </div>
                </>
              ) : null}
              {step === 1 ? (
                <div className="space-y-5">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-500">
                    <KeyRound size="sm" aria-hidden="true" />
                    System credentials
                  </p>

                  <div className="space-y-2">
                    <Field
                      label="Login email"
                      htmlFor="sa-email"
                      required
                      error={errors.email}
                      tip="The guard's sign-in for the Guardhouse portal. Fixed once the account exists; it doubles as the account's identity in the change log."
                      hint="They sign in with this. It cannot be changed later."
                    >
                      <TextInput
                        id="sa-email"
                        type="email"
                        icon={Mail}
                        value={form.email}
                        error={errors.email}
                        autoComplete="off"
                        placeholder="guard@monticellovillas.ph"
                        onChange={(e) => update({ email: e.target.value })}
                      />
                    </Field>

                    <div className="border-t border-hairline pt-3">
                      <Field
                        label="Temporary password"
                        htmlFor="sa-password"
                        required
                        error={errors.password}
                        tip="Generated on this device. Shown once more after saving so you can hand it over; it is never stored where an admin can read it again."
                        hint="The guard is prompted to replace this the first time they sign in."
                        action={
                          <button
                            type="button"
                            onClick={() => update({ password: generateTempPassword() })}
                            className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-500 transition-colors hover:bg-brand-500/20"
                          >
                            <RefreshCw size={12} aria-hidden="true" />
                            Generate random password
                          </button>
                        }
                      >
                        <div className="relative">
                          <Lock size="sm" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                          <input
                            id="sa-password"
                            type={revealed ? 'text' : 'password'}
                            value={form.password}
                            readOnly
                            aria-invalid={errors.password ? 'true' : undefined}
                            aria-describedby={errors.password ? 'sa-password-error' : undefined}
                            className={`field h-11 cursor-default rounded-xl py-0 pl-9 pr-20 font-mono text-sm sm:h-10 sm:text-xs ${errors.password ? 'border-danger' : ''}`}
                          />
                          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={copyPassword}
                              aria-label={copied ? 'Password copied' : 'Copy password'}
                              title={copied ? 'Copied' : 'Copy password'}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary"
                            >
                              {copied ? <Check size="sm" className="text-success" /> : <Copy size="sm" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRevealed((v) => !v)}
                              aria-label={revealed ? 'Hide password' : 'Show password'}
                              title={revealed ? 'Hide password' : 'Show password'}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary"
                            >
                              {revealed ? <EyeOff size="sm" /> : <Eye size="sm" />}
                            </button>
                          </div>
                        </div>
                      </Field>
                    </div>
                  </div>
                </div>
              ) : null}

              {submitError ? (
                <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-xs text-danger">
                  <AlertTriangle size="sm" className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{submitError}</span>
                </p>
              ) : null}
            </div>

            {/* ── Footer ── */}
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-base-950/40 px-6 py-4">
              <p className="text-xs font-medium text-text-muted">
                Step <span className="font-bold text-text-primary">{step + 1}</span> of {STEPS.length}
              </p>
              {/* ONE Cancel and ONE primary, on every step (2026-10-18). Going
                  back to step 1 is the progress indicator's job; the header ×
                  that duplicated Cancel is gone. */}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
                  Cancel
                </button>
                {step === 0 ? (
                  <button type="submit" disabled={busy} className={`${primaryBtn} ${step1Valid ? '' : 'opacity-60'}`}>
                    Continue
                    <ArrowRight size="sm" />
                  </button>
                ) : (
                  <button type="submit" disabled={busy} className={primaryBtn}>
                    {busy ? <Loader2 size="sm" className="animate-spin" /> : <Check size="sm" />}
                    Save account details
                  </button>
                )}
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
