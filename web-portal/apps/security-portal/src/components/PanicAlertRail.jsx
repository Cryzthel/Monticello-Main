import { toast } from '@shared/lib/toast'
import { useCallback, useState } from 'react'
import { ChevronDown, Loader2, MapPin, Volume2, VolumeX } from '@shared/icons'
import Pill from '@shared/components/Pill'
import { useLivePanicAlerts } from '@/components/PanicAlertProvider'
import { relativeTime } from '@shared/lib/notifications'
import { acknowledgePanicAlert } from '@shared/lib/panicAlerts'
import { useAuth } from '@shared/auth/AuthContext'
import { distanceMeters, formatDistance } from '@/lib/directions'

/**
 * Every unresolved SOS, in a glass column beside the map (user's reference,
 * 2026-10-18).
 *
 *   ┌ (●) 10 panic alerts                                       (🔇 Mute) ┐
 *   │     8 still unattended                                             │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ ▌ Lian Nicole Jabagat                                  2 mins ago  │
 *   │ ▌ ⌖ Phase 2 • Block 5 • Lot 02                                     │
 *   │ ▌ (Active SOS) (No GPS fix)                                        │
 *   │ ▌ ( Acknowledge )            ( Confirm resolve )                   │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * ── LIVE, AND NOT A SECOND SOURCE OF TRUTH ─────────────────────────────────
 * It reads `useLivePanicAlerts`, the one subscription the provider owns — the
 * same array the map draws its nodes from and the siren counts — so a new SOS,
 * an acknowledgement from another console or a resolution lands here (and in
 * the header counts) the moment it is written. The query filters
 * `status in ('active','acknowledged')`; there is no local copy to go stale.
 *
 * ── WHAT MOVES ─────────────────────────────────────────────────────────────
 * Only the header's ping dot (while anything is unattended) and the relative
 * clock. The accent bar marks state without motion: red for an unattended
 * SOS, amber for one being handled. `animate-ping` is covered by the global
 * reduced-motion rule.
 */

/**
 * One alert. The card is a CONTAINER, not a button: the identity block opens
 * the alert, and the two actions are its siblings — a <button> inside a
 * <button> is invalid and fires both handlers.
 */
function AlertCard({ alert, origin, onOpen, onAcknowledge, busy }) {
  const waiting = alert.status === 'active'
  const canNavigate = Number.isFinite(alert.lat) && Number.isFinite(alert.lng)
  const metres =
    canNavigate && origin ? distanceMeters([alert.lng, alert.lat], [origin.lng, origin.lat]) : null

  return (
    <li className="group relative overflow-hidden rounded-2xl border border-hairline bg-base-800/60 p-5 transition-colors duration-200 hover:bg-base-800 dark:border-white/[0.04] dark:bg-zinc-900/40 dark:hover:bg-zinc-900/60">
      {/* The state bar: red while unattended, amber once acknowledged. */}
      <span
        aria-hidden="true"
        className={`absolute bottom-0 left-0 top-0 w-1 ${
          waiting
            ? 'bg-danger shadow-[0_0_15px_color-mix(in_oklab,var(--color-danger)_40%,transparent)]'
            : 'bg-warning shadow-[0_0_15px_color-mix(in_oklab,var(--color-warning)_30%,transparent)]'
        }`}
      />

      {/* ── WHO, WHERE, HOW LONG ── opens the alert. */}
      <button
        type="button"
        onClick={() => onOpen(alert)}
        className="block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
      >
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0 truncate text-[15px] font-medium text-text-primary">{alert.residentName}</span>
          {/* The age, not the wall clock: "how long has this person been
              waiting" is the triage question. */}
          <time className="mt-0.5 shrink-0 text-[11px] font-medium tabular-nums text-text-muted">
            {relativeTime(alert.createdAt)}
          </time>
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-text-secondary">
          <MapPin size={14} aria-hidden="true" className="shrink-0 opacity-70" />
          <span className="min-w-0 truncate text-xs">{alert.address || 'Address not recorded'}</span>
        </span>
      </button>

      {/* ── WHAT THE CONSOLE KNOWS ── There is deliberately no GPS-accuracy
          pill: the SOS payload carries no accuracy radius, and inventing one
          would assert a precision nobody measured. Whether there is a position
          at all IS known, and changes what a responder can do. */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Pill size="sm" tone={waiting ? 'danger' : 'warning'}>
          {waiting ? 'Active SOS' : 'Responding'}
        </Pill>
        {canNavigate ? (
          metres != null ? (
            <Pill size="sm">{formatDistance(metres)} away</Pill>
          ) : null
        ) : (
          <Pill size="sm">No GPS fix</Pill>
        )}
        {!waiting && alert.acknowledgedByName ? (
          <span className="truncate text-[11px] text-text-muted">{alert.acknowledgedByName}</span>
        ) : null}
      </div>

      {/* ── WHAT TO DO ── Acknowledge only while unattended; Confirm resolve
          opens the alert's modal, which is the confirmation (notes, photo
          proof) rather than a second press here. */}
      <div className="mt-5 flex gap-3">
        {waiting ? (
          <button
            type="button"
            onClick={() => onAcknowledge(alert)}
            disabled={busy}
            aria-busy={busy || undefined}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-[var(--color-cta)] py-2 text-sm font-medium text-[var(--color-cta-fg)] shadow-[0_0_15px_-3px_color-mix(in_oklab,var(--color-cta)_20%,transparent)] transition-[background-color,transform] duration-150 hover:bg-[var(--color-cta-hover)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy ? (
              <>
                <Loader2 size="sm" aria-hidden="true" className="animate-spin" />
                Acknowledging…
              </>
            ) : (
              'Acknowledge'
            )}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpen(alert)}
          disabled={busy}
          aria-label={`Confirm resolve the alert from ${alert.residentName}`}
          className="min-h-[44px] flex-1 rounded-full border border-hairline bg-tint/[0.04] py-2 text-sm font-medium text-text-secondary transition-[background-color,color,transform] duration-150 hover:bg-tint/[0.1] hover:text-text-primary active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 dark:border-zinc-700/50 dark:bg-zinc-800/50"
        >
          Confirm resolve
        </button>
      </div>
    </li>
  )
}

export default function PanicAlertRail({ onOpenAlert, muted, onToggleMute, origin = null }) {
  const { alerts } = useLivePanicAlerts()
  const { user } = useAuth()
  // Scoped to the ALERT: acknowledging one must not freeze the others.
  const [busyId, setBusyId] = useState(null)

  const run = useCallback(async (alert, action) => {
    setBusyId(alert.id)
    try {
      await action()
      toast.success('SOS acknowledged', { description: 'Every console now shows it as attended.' })
    } catch (err) {
      // The alert stays open — the safe failure — but the officer is TOLD.
      console.warn('Panic alert update failed', err)
      toast.error('Could not acknowledge the alert', {
        id: `panic-ack-fail-${alert.id}`,
        description: 'It is still open. Check the connection and try again.',
      })
    } finally {
      setBusyId(null)
    }
  }, [])

  // Shut on a phone until asked; on a console (lg+) always open.
  const [open, setOpen] = useState(false)

  // No emergencies: no column at all, rather than a permanent empty tax on the map.
  if (!alerts.length) return null

  const unattended = alerts.filter((alert) => alert.status === 'active').length

  return (
    <aside
      aria-label="Active panic alerts"
      className={`flex w-full shrink-0 flex-col border-b border-hairline bg-base-900/80 shadow-2xl backdrop-blur-3xl lg:max-h-none lg:w-[400px] lg:border-b-0 lg:border-l dark:border-white/5 dark:bg-zinc-950/80 ${
        open ? 'max-h-[45vh]' : 'max-h-none'
      }`}
    >
      <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-hairline bg-base-900/50 px-6 py-5 backdrop-blur-md dark:border-white/5 dark:bg-zinc-950/50">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="relative mt-1.5 flex h-3 w-3 shrink-0" aria-hidden="true">
            {unattended ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
            ) : null}
            <span
              className={`relative inline-flex h-3 w-3 rounded-full ${
                unattended
                  ? 'bg-danger shadow-[0_0_10px_color-mix(in_oklab,var(--color-danger)_50%,transparent)]'
                  : 'bg-warning'
              }`}
            />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-[15px] font-semibold leading-none tracking-tight text-text-primary">
              {alerts.length === 1 ? '1 panic alert' : `${alerts.length} panic alerts`}
            </h2>
            <p className="mt-1.5 text-xs font-medium text-text-muted" aria-live="polite">
              {unattended ? `${unattended} still unattended` : 'All acknowledged — none resolved yet'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Mute silences the ROOM, not the emergency: every alert keeps its
              place and status. */}
          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute the SOS siren' : 'Mute the SOS siren'}
            title={muted ? 'The siren is silenced — turn it back on' : 'Silence the siren'}
            className={`flex min-h-[44px] items-center gap-2 rounded-full px-3.5 py-1.5 transition-colors lg:min-h-0 ${
              muted
                ? 'bg-warning/10 text-warning hover:bg-warning/20'
                : 'text-text-secondary hover:bg-tint/[0.08] hover:text-text-primary'
            }`}
          >
            {muted ? <VolumeX size="sm" aria-hidden="true" /> : <Volume2 size="sm" aria-hidden="true" />}
            <span className="text-xs font-medium">{muted ? 'Unmute' : 'Mute'}</span>
          </button>
          {/* Below `lg` only: on a console the list is always open. */}
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls="panic-queue"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-tint/[0.08] hover:text-text-primary lg:hidden"
          >
            <ChevronDown size="sm" className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
            <span className="sr-only">{open ? 'Hide the panic queue' : 'Show the panic queue'}</span>
          </button>
        </div>
      </header>

      {muted ? (
        <p className="shrink-0 border-b border-hairline bg-warning/10 px-6 py-2 text-[11px] leading-snug text-warning dark:border-white/5">
          Siren muted. These alerts are still open and still unresolved.
        </p>
      ) : null}

      <div
        id="panic-queue"
        className={`custom-scrollbar drawer-scroll min-h-0 flex-1 flex-col overflow-y-auto p-5 lg:flex ${open ? 'flex' : 'hidden'}`}
      >
        <ul className="flex flex-col gap-4">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              origin={origin}
              busy={busyId === alert.id}
              onOpen={onOpenAlert}
              onAcknowledge={(a) => run(a, () => acknowledgePanicAlert(a.id, user?.displayName))}
            />
          ))}
        </ul>
      </div>
    </aside>
  )
}
