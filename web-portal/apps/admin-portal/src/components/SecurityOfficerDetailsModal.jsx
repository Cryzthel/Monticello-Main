import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BadgeAlert, ShieldCheck, X } from '@shared/icons'
import Pill from '@shared/components/Pill'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { ACCOUNT_STATUS, STATUS_LABELS, STATUS_TONES, postLabel } from '@/lib/securityAccounts'

/**
 * Read-only view of one security account — what a ROW CLICK opens on
 * Security accounts. Nothing here is editable: changing an account is only
 * through the row's ⋯ menu → "Edit assignment", so a stray click can never
 * start an edit.
 *
 *   ┌ (JD) Joaquin Dela Cruz                                          (×) ┐
 *   │      delacruzjoaquin068@gmail.com                                   │
 *   │      (● On duty) (Patrol guard) (Reset pending)                     │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │ PROFILE         Full name · Badge ID                                │
 *   │ ASSIGNMENT      Guard post · Role                                   │
 *   │ CONTACT         Login email · Contact number                        │
 *   │ SYSTEM ACCOUNT  Status · Password (amber note while temporary)      │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * No footer (2026-10-18): the "use the row's menu" note and a second Close
 * button repeated the ✕. "Last sign-in" and "Created" were dropped from System
 * account as well — the row's Last active column carries recency.
 *
 * LIVE: `account` is resolved by uid from the page's live `staff_accounts`
 * listener (useSecurityAccounts), so a suspension, a reset, or "Reset pending"
 * clearing once the officer changes their password shows here while it is
 * open.
 */

const initialsOf = (name) =>
  String(name || '?')
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?'

/** Status → the dot beside the word in System account. */
const STATUS_DOT = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-text-muted">{title}</h3>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">{children}</dl>
    </section>
  )
}

function Fact({ label, children, wide = false, mono = false }) {
  const empty = children == null || children === ''
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-[13px] text-text-muted">{label}</dt>
      <dd
        className={`break-words text-[14px] ${mono ? 'font-mono' : ''} ${
          empty ? 'text-text-muted/70' : 'font-medium text-text-primary'
        }`}
      >
        {empty ? '—' : children}
      </dd>
    </div>
  )
}

export default function SecurityOfficerDetailsModal({ account, onClose }) {
  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(account), containerRef: panelRef })

  useEffect(() => {
    if (!account) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [account, onClose])

  if (!account) return null

  const name = account.name || account.email || 'Unnamed officer'
  const supervisor = account.role === 'security_head'
  const revoked = account.status === ACCOUNT_STATUS.revoked
  const onDuty = Boolean(account.onDuty) && !revoked
  const statusTone = STATUS_TONES[account.status] ?? 'neutral'
  const statusLabel = STATUS_LABELS[account.status] ?? 'Unknown'
  const resetPending = Boolean(account.mustChangePassword) && !revoked

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/40 backdrop-blur-[8px] sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="officer-details-title"
        onClick={(event) => event.stopPropagation()}
        className="officer-modal-enter relative flex max-h-[85dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-[1.25rem] border border-hairline bg-base-900 shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] sm:max-h-[85vh] sm:rounded-[1.25rem] dark:bg-base-950"
      >
        <header className="relative shrink-0 border-b border-hairline px-6 py-7 sm:px-8">
          <div className="flex items-start gap-4 pr-10">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brand-500/20 bg-brand-500/10 text-[17px] font-semibold tracking-tight text-brand-500"
            >
              {initialsOf(name)}
            </span>
            <div className="flex min-w-0 flex-col">
              <h2
                id="officer-details-title"
                className="truncate text-[17px] font-semibold leading-tight tracking-tight text-text-primary"
              >
                {name}
              </h2>
              <p className="mt-0.5 truncate text-[13px] text-text-secondary">{account.email || 'No email on file'}</p>
              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                {onDuty ? (
                  <Pill tone="success" pulse>
                    On duty
                  </Pill>
                ) : (
                  <Pill tone={statusTone}>{statusLabel}</Pill>
                )}
                <Pill tone={supervisor ? 'warning' : 'neutral'} icon={ShieldCheck}>
                  {supervisor ? 'Security supervisor' : 'Patrol guard'}
                </Pill>
                {resetPending ? (
                  <Pill tone="info" icon={BadgeAlert}>
                    Reset pending
                  </Pill>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close officer details"
            className="absolute right-5 top-5 rounded-full p-2 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hairline"
          >
            <X size="sm" />
          </button>
        </header>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-10 overflow-y-auto overscroll-contain px-6 py-8 sm:px-8">
          <Section title="Profile">
            <Fact label="Full name">{account.name}</Fact>
            <Fact label="Badge ID" mono>
              {account.badgeNumber}
            </Fact>
          </Section>

          <Section title="Assignment">
            <Fact label="Guard post">{postLabel(account.assignedPost)}</Fact>
            <Fact label="Role">{supervisor ? 'Security supervisor' : 'Patrol guard'}</Fact>
          </Section>

          <Section title="Contact">
            <Fact label="Login email">{account.email}</Fact>
            <Fact label="Contact number" mono>
              {account.phone ? (
                <a href={`tel:${account.phone}`} className="text-text-primary underline-offset-2 hover:underline">
                  {account.phone}
                </a>
              ) : null}
            </Fact>
          </Section>

          <Section title="System account">
            <Fact label="Status">
              <span className="mt-0.5 inline-flex items-center gap-2">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[statusTone] ?? 'bg-text-muted'}`} />
                {statusLabel}
              </span>
            </Fact>
            <Fact label="Password">
              {resetPending ? (
                <span className="mt-0.5 inline-flex items-center rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-[12px] font-medium leading-snug text-warning">
                  Temporary — must be changed at next sign-in
                </span>
              ) : (
                'Set by the officer'
              )}
            </Fact>
            {account.statusReason ? (
              <Fact label="Status note" wide>
                {account.statusReason}
              </Fact>
            ) : null}
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
