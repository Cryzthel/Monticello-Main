import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BadgeAlert, IdCard, MapPin, ShieldCheck, User, X } from '@shared/icons'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useNow } from '@shared/hooks/useNow'
import { formatDate, formatDateTime, formatTime } from '@shared/lib/dates'
import { ACCOUNT_STATUS, STATUS_LABELS, postLabel } from '@/lib/securityAccounts'

/**
 * Security Account Details — the read-only inspector a row click opens on
 * Security accounts (2026-10-19, rebuilt from the provided design).
 *
 *   ┌ (JD) Joaquin Delacruz  (● On duty) (Patrol guard)                 (×) ┐
 *   ├───────────────────────────────┬────────────────────────────────────────┤
 *   │ PROFILE IDENTITY              │ ASSIGNMENT DUTY                        │
 *   │ Badge ID · Account            │ Duty · Console                         │
 *   ├───────────────────────────────┴────────────────────────────────────────┤
 *   │ CONTACT & CREDENTIALS   Login email · Contact number · Password        │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * ── EVERY FACT ONCE ────────────────────────────────────────────────────────
 * The design repeated the name (header and "Full name"), the role (header pill
 * and "Role") and the duty state (header pill and "Status: Active Duty"). Each
 * is shown once here: name and role in the header, duty in Assignment. The
 * guard post is gone unless an account has a real one — every account carries
 * the "Perimeter patrol" placeholder, which only restated "Patrol guard"
 * (see postLabel). The email is shown once, under Contact.
 *
 * ── LIVE ───────────────────────────────────────────────────────────────────
 * `account` is resolved by uid from the page's live `staff_accounts` /
 * `guard_shifts` / `staff_presence` listeners (useSecurityAccounts), so a
 * clock-in, a suspension, a sign-out or an edited phone number shows here
 * while it is open. Durations re-render every 30 s.
 *
 * Dismissed by the ✕, a click on the backdrop, or Escape; focus is trapped
 * inside while open and returned to the row afterwards (useDialogFocus).
 */

const initialsOf = (name) =>
  String(name || '?')
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?'

const PILL = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold'
const PILL_TONES = {
  success: 'border-success/20 bg-success/10 text-success',
  warning: 'border-warning/25 bg-warning/10 text-warning',
  danger: 'border-danger/25 bg-danger/10 text-danger',
  info: 'border-info/25 bg-info/10 text-info',
  neutral: 'border-hairline bg-tint/[0.06] text-text-secondary',
}

function Pill({ tone = 'neutral', children }) {
  return <span className={`${PILL} ${PILL_TONES[tone]}`}>{children}</span>
}

/** "3h 10m" / "45m" since `since`. */
function elapsed(since, now) {
  const minutes = Math.max(0, Math.floor((now - since.getTime()) / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

/** "2:14 PM" today, "Oct 17, 2026, 2:14 PM" before that. */
function when(date, now) {
  return formatDate(date) === formatDate(now) ? formatTime(date) : formatDateTime(date)
}

function CardHeading({ icon: Icon, children, ruled = false }) {
  return (
    <h3
      className={`flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-text-muted ${
        ruled ? 'border-b border-hairline pb-3' : ''
      }`}
    >
      <Icon size={14} aria-hidden="true" />
      {children}
    </h3>
  )
}

/** One labelled value with the design's left rule; `accent` marks the key identifier. */
function Fact({ label, children, mono = false, accent = false, tone = 'text-text-primary' }) {
  const empty = children == null || children === ''
  return (
    <div className={`min-w-0 border-l-2 pl-3 ${accent ? 'border-brand-500/50' : 'border-hairline'}`}>
      <dt className="mb-0.5 text-[11px] text-text-muted">{label}</dt>
      <dd
        className={`break-words text-sm ${mono ? 'font-mono tracking-wide' : 'font-medium'} ${
          empty ? 'text-text-muted' : accent ? 'font-medium text-brand-500' : tone
        }`}
      >
        {empty ? '—' : children}
      </dd>
    </div>
  )
}

export default function SecurityAccountDetailsModal({ account, onClose }) {
  const panelRef = useRef(null)
  const open = Boolean(account)
  useDialogFocus({ open, containerRef: panelRef })
  const now = useNow()

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!account) return null

  const name = account.name || account.email || 'Unnamed officer'
  const supervisor = account.role === 'security_head'
  const active = account.status === ACCOUNT_STATUS.active
  const revoked = account.status === ACCOUNT_STATUS.revoked
  const onDuty = active && Boolean(account.onDuty)
  const resetPending = Boolean(account.mustChangePassword) && !revoked
  const post = postLabel(account.assignedPost)
  const presence = account.presence
  const statusTone = active ? 'success' : revoked ? 'danger' : 'warning'

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-details-title"
        onClick={(event) => event.stopPropagation()}
        className="officer-modal-enter flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:rounded-2xl"
      >
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-6 py-5 sm:px-8 sm:py-6">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/10 text-xl font-bold text-brand-500 shadow-inner"
            >
              {initialsOf(name)}
            </span>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <h2 id="account-details-title" className="truncate text-xl font-bold tracking-tight text-text-primary">
                {name}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {active ? (
                  <Pill tone={onDuty ? 'success' : 'neutral'}>
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${onDuty ? 'bg-success motion-safe:animate-pulse' : 'bg-text-muted'}`}
                    />
                    {onDuty ? 'On duty' : 'Off duty'}
                  </Pill>
                ) : (
                  <Pill tone={statusTone}>{STATUS_LABELS[account.status] ?? 'Unknown'}</Pill>
                )}
                <Pill tone={supervisor ? 'warning' : 'neutral'}>
                  <ShieldCheck size={14} aria-hidden="true" />
                  {supervisor ? 'Security supervisor' : 'Patrol guard'}
                </Pill>
                {resetPending ? (
                  <Pill tone="info">
                    <BadgeAlert size={14} aria-hidden="true" />
                    Reset pending
                  </Pill>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account details"
            className="shrink-0 self-start rounded-lg p-1.5 text-text-muted transition-colors duration-150 hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <X size={20} />
          </button>
        </header>

        {/* ── BODY ─────────────────────────────────────────────────────── */}
        <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain bg-base-950/40 p-6 sm:p-8">
          <div className="overflow-hidden rounded-xl border border-hairline bg-base-900/40">
            <div className="grid grid-cols-1 divide-y divide-hairline md:grid-cols-2 md:divide-x md:divide-y-0">
              <section className="space-y-5 p-6">
                <CardHeading icon={User}>Profile identity</CardHeading>
                <dl className="space-y-4">
                  <Fact label="Badge ID" mono accent>
                    {account.badgeNumber}
                  </Fact>
                  {/* Active shows here (the header shows duty instead); any
                      other status is already the header pill, so this says
                      who changed it rather than repeating the word. */}
                  <Fact label="Account" tone={active ? 'text-success' : revoked ? 'text-danger' : 'text-warning'}>
                    {active ? 'Active' : account.statusReason || STATUS_LABELS[account.status] || 'Unknown'}
                  </Fact>
                </dl>
              </section>

              <section className="space-y-5 bg-base-900/20 p-6">
                <CardHeading icon={MapPin}>Assignment duty</CardHeading>
                <dl className="space-y-4">
                  <Fact label="Duty" tone={onDuty ? 'text-success' : 'text-text-primary'}>
                    {onDuty
                      ? account.onDutySince
                        ? `On duty since ${when(account.onDutySince, now)} · ${elapsed(account.onDutySince, now)}`
                        : 'On duty'
                      : account.lastActiveAt
                        ? `Off duty · last on post ${when(account.lastActiveAt, now)}`
                        : 'Off duty · no shifts logged'}
                  </Fact>
                  <Fact label="Console" tone={presence?.online ? 'text-success' : 'text-text-primary'}>
                    {!presence
                      ? 'No sign-in recorded yet'
                      : presence.online
                        ? presence.onlineSince
                          ? `Online since ${when(presence.onlineSince, now)}`
                          : 'Online'
                        : presence.lastSeenAt
                          ? `Offline · last seen ${when(presence.lastSeenAt, now)}`
                          : 'Offline'}
                  </Fact>
                  {post ? <Fact label="Guard post">{post}</Fact> : null}
                </dl>
              </section>
            </div>
          </div>

          <section className="space-y-5 rounded-xl border border-hairline bg-base-900/40 p-6">
            <CardHeading icon={IdCard} ruled>
              Contact &amp; credentials
            </CardHeading>
            <dl className="grid grid-cols-1 gap-6 pt-1 md:grid-cols-2">
              <Fact label="Login email" mono>
                {account.email ? <span className="select-all">{account.email}</span> : null}
              </Fact>
              <Fact label="Contact number" mono>
                {account.phone ? (
                  <a href={`tel:${account.phone}`} className="underline-offset-2 hover:underline">
                    {account.phone}
                  </a>
                ) : null}
              </Fact>
              <Fact label="Password" tone={resetPending ? 'text-warning' : 'text-text-primary'}>
                {resetPending ? 'Temporary — must be changed at next sign-in' : 'Set by the officer'}
              </Fact>
            </dl>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
