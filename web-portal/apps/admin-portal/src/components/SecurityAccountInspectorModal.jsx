import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BadgeAlert, MapPin, ShieldCheck, User, X } from '@shared/icons'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { useNow } from '@shared/hooks/useNow'
import { formatDate, formatDateTime, formatTime } from '@shared/lib/dates'
import { ACCOUNT_STATUS, STATUS_LABELS, postLabel } from '@/lib/securityAccounts'
import Pill from '@shared/components/Pill'
import { useStaffAvatar } from '@shared/lib/staffAvatar'
import { DetailCard, DetailField } from '@shared/components/detail/DetailCard'

/**
 * Security Account Inspector — the read-only view a row click opens on
 * Security accounts (2026-10-19, rebuilt from the provided reference).
 *
 *   ┌ (RS) River Santos  (● On duty) (Patrol guard)                       (×) ┐
 *   ├──────────────────────────────────┬───────────────────────────────────────┤
 *   │ IDENTITY & CONTACT               │ ASSIGNMENT & STATUS                   │
 *   │ Badge ID                         │ Duty — since …, · 8h 28m              │
 *   │ Login email                      │ Console — Offline · last seen 2:14 AM │
 *   │ Contact number                   │                                       │
 *   └──────────────────────────────────┴───────────────────────────────────────┘
 *
 * Two chunks (Miller's law), in a max-w-4xl panel so a long email or a full
 * date never clips. Every fact appears once: the name and role are the header,
 * account status (when not active) and "Reset pending" are header pills, and
 * the body holds only what the header does not say. The guard post shows only
 * when an account has a real one — every account carries the "Perimeter
 * patrol" placeholder, which postLabel hides.
 *
 * LIVE: `account` is resolved by uid from the page's `staff_accounts`,
 * `guard_shifts` and `staff_presence` onSnapshot listeners
 * (useSecurityAccounts), so a clock-in, a sign-out or a suspension shows here
 * while it is open, in every admin console at once. The duration re-renders
 * every 30 s.
 *
 * Dismissed by the ✕, a backdrop click or Escape; focus is trapped inside
 * while open and returned to the row afterwards (useDialogFocus).
 */

const initialsOf = (name) =>
  String(name || '?')
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?'

/** "8h 28m" / "45m" since `since`. */
function elapsed(since, now) {
  const minutes = Math.max(0, Math.floor((now - since.getTime()) / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

/** "2:14 AM" today, "Oct 18, 2026, 7:21 PM" before that. */
function when(date, now) {
  return formatDate(date) === formatDate(now) ? formatTime(date) : formatDateTime(date)
}

/**
 * One fact, on the shared DetailField (2026-10-19: this file used to carry its
 * own Pill, Card and Fact markup, duplicating the shared components).
 * `accent` marks a card's lead fact; `className` colours the value.
 */
function Fact({ label, children, accent = false, className = 'text-text-primary' }) {
  const empty = children == null || children === ''
  return (
    <DetailField label={label} empty={empty} accent={accent ? 'border-brand-500/50' : ''}>
      {empty ? '—' : <span className={`leading-snug ${className}`}>{children}</span>}
    </DetailField>
  )
}

export default function SecurityAccountInspectorModal({ account, onClose }) {
  const panelRef = useRef(null)
  const open = Boolean(account)
  useDialogFocus({ open, containerRef: panelRef })
  const now = useNow()
  // Live: a guard's new Settings photo appears here without a refresh.
  const photoUrl = useStaffAvatar(account?.uid ?? null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose?.()
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
  const online = active && Boolean(presence?.online)

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-inspector-title"
        onClick={(event) => event.stopPropagation()}
        className="officer-modal-enter flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl sm:rounded-2xl"
      >
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-6 py-5 sm:px-8 sm:py-6">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded-full border border-brand-500/30 object-cover shadow-inner"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/10 text-xl font-bold text-brand-500 shadow-inner"
              >
                {initialsOf(name)}
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <h2 id="account-inspector-title" className="truncate text-xl font-bold tracking-tight text-text-primary">
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
                  <Pill tone={revoked ? 'danger' : 'warning'}>{STATUS_LABELS[account.status] ?? 'Unknown'}</Pill>
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
            aria-label="Close account inspector"
            className="shrink-0 self-start rounded-lg p-1.5 text-text-muted transition-colors duration-150 hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <X size={20} />
          </button>
        </header>

        {/* ── BODY: TWO CHUNKS ─────────────────────────────────────────── */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-base-950/40 p-6 sm:p-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <DetailCard icon={User} title="Identity & contact">
              <Fact label="Badge ID" accent className="font-mono tracking-wide text-brand-500">
                {account.badgeNumber}
              </Fact>
              <Fact label="Login email" className="select-all tracking-tight text-text-primary">
                {account.email}
              </Fact>
              <Fact label="Contact number" className="font-mono tracking-wide text-text-primary">
                {account.phone ? (
                  <a href={`tel:${account.phone}`} className="underline-offset-2 hover:underline">
                    {account.phone}
                  </a>
                ) : null}
              </Fact>
            </DetailCard>

            <DetailCard icon={MapPin} title="Assignment & status">
              <Fact label="Duty" accent className={onDuty ? 'text-success' : 'text-text-primary'}>
                {onDuty ? (
                  account.onDutySince ? (
                    <>
                      On duty since {when(account.onDutySince, now)}
                      <span className="block font-mono text-[11px] font-semibold tracking-wide">
                        · {elapsed(account.onDutySince, now)}
                      </span>
                    </>
                  ) : (
                    'On duty'
                  )
                ) : !active ? (
                  `Unavailable — account ${String(STATUS_LABELS[account.status] ?? 'inactive').toLowerCase()}`
                ) : account.lastActiveAt ? (
                  <>
                    Off duty
                    <span className="block font-mono text-[11px] font-normal text-text-muted">
                      · last on post {when(account.lastActiveAt, now)}
                    </span>
                  </>
                ) : (
                  'Off duty · no shifts logged'
                )}
              </Fact>
              <Fact label="Console" className={online ? 'text-success' : 'text-text-secondary'}>
                {!presence ? (
                  'No sign-in recorded yet'
                ) : online ? (
                  <>
                    Online
                    {presence.onlineSince ? (
                      <span className="font-mono text-[11px] font-normal text-text-muted">
                        {' '}
                        · since {when(presence.onlineSince, now)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    Offline
                    {presence.lastSeenAt ? (
                      <span className="font-mono text-[11px] font-normal text-text-muted">
                        {' '}
                        · last seen {when(presence.lastSeenAt, now)}
                      </span>
                    ) : null}
                  </>
                )}
              </Fact>
              {post ? <Fact label="Guard post">{post}</Fact> : null}
            </DetailCard>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
