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
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserPlus,
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
import Pill from '@shared/components/Pill'
import { DetailCard } from '@shared/components/detail/DetailCard'
import { DetailFormField, detailInputClass } from '@shared/components/detail/DetailFormField'

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
 * ── ONE DESIGN WITH THE INCIDENT DETAILS (2026-10-19) ──────────────────────
 * The shell of the shared IncidentDetailModal (max-w-3xl, icon-tile header
 * with a pill row, a base-950/40 body of DetailCards, a base-950 footer), and
 * fields drawn by DetailFormField, so labels and wells match the record views.
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

/** An input with a leading glyph, in the Incident details' base-950 well. */
function TextInput({ id, error, icon: Icon, mono = false, ...rest }) {
  return (
    <div className="relative">
      <Icon size="sm" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className={detailInputClass({ error: Boolean(error), icon: true, mono })}
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
    'inline-flex items-center gap-2 rounded-full bg-[var(--color-cta)] px-5 py-2 text-xs font-semibold text-[var(--color-cta-fg)] shadow-md transition-[background-color,transform] hover:bg-[var(--color-cta-hover)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50'
  const secondaryBtn =
    'inline-flex items-center gap-2 rounded-full border border-hairline bg-tint/[0.06] px-5 py-2 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-tint/[0.1] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50'

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4 md:p-6"
      onClick={() => !busy && !credentials && onClose?.()}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={credentials ? 'Account credentials' : 'Create security account'}
        onClick={(event) => event.stopPropagation()}
        className={`dialog-panel relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl ${
          credentials ? 'max-w-xl' : 'max-w-3xl'
        }`}
      >
        {credentials ? (
          <div className="custom-scrollbar overflow-y-auto">
            <CredentialHandoff credentials={credentials} onDone={onClose} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col">
            {/* ═══ HEADER ═══ The Incident details' header: icon tile, title,
                record line, then a row of pills — here the role every account
                is created with. No ✕: Cancel is the one way out (2026-10-18). */}
            <header className="relative shrink-0 border-b border-hairline px-6 py-5 sm:px-8">
              <div className="flex min-w-0 items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-500 shadow-inner">
                  <UserPlus size={22} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl font-bold tracking-tight text-text-primary">Create security account</h2>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Fill out guard details before configuring account credentials.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Pill tone="brand" icon={ShieldCheck}>
                      Patrol Guard
                    </Pill>
                    <Pill className="font-mono tracking-wider">
                      Step {step + 1} of {STEPS.length}
                    </Pill>
                  </div>
                </div>
              </div>
            </header>

            {/* ── Progress ── */}
            <div className="shrink-0 border-b border-hairline px-6 py-4 sm:px-8">
              <ProgressSteps step={step} unlocked={step1Valid} busy={busy} onJump={goTo} />
            </div>

            {/* ═══ BODY ═══ keyed so each arrival replays `.step-enter`. */}
            <div
              ref={stepBodyRef}
              key={STEPS[step].key}
              className="step-enter custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-base-950/40 p-6 sm:min-h-[20rem] sm:p-8"
            >
              <div className="flex flex-col gap-6">
                {step === 0 ? (
                  <>
                    {showStepWarning && !step1Valid ? (
                      <p role="alert" className="flex items-center gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                        <AlertTriangle size="sm" className="shrink-0" aria-hidden="true" />
                        <span>
                          Complete the required fields below to unlock step 2: full name, badge ID and contact number.
                        </span>
                      </p>
                    ) : null}

                    <DetailCard icon={UserRound} title="Guard details" bodyClassName="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                      <DetailFormField
                        className="sm:col-span-2"
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
                      </DetailFormField>
                      <DetailFormField
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
                      </DetailFormField>
                      <DetailFormField
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
                      </DetailFormField>
                    </DetailCard>
                  </>
                ) : null}

                {step === 1 ? (
                  <DetailCard icon={KeyRound} title="System credentials" bodyClassName="space-y-2">
                    <DetailFormField
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
                    </DetailFormField>

                    <DetailFormField
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
                          aria-describedby={errors.password ? 'sa-password-error' : 'sa-password-hint'}
                          className={detailInputClass({ error: Boolean(errors.password), icon: true, mono: true, className: 'cursor-default !pr-20' })}
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
                    </DetailFormField>
                  </DetailCard>
                ) : null}

                {submitError ? (
                  <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-xs text-danger">
                    <AlertTriangle size="sm" className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{submitError}</span>
                  </p>
                ) : null}
              </div>
            </div>

            {/* ═══ FOOTER ═══ ONE Cancel and ONE primary, on every step
                (2026-10-18). Going back is the progress indicator's job. */}
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline bg-base-950 px-6 py-3 sm:px-8">
              <p className="flex items-center gap-2 text-xs text-text-muted">
                <ShieldCheck size={14} className="text-success/70" aria-hidden="true" />
                <span>Every change is recorded in Audit History</span>
              </p>
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
