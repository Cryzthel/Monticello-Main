import { toast } from '@shared/lib/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, MapPin, Volume2, VolumeX } from '@shared/icons'
import { useLivePanicAlerts } from '@/components/PanicAlertProvider'
import { acknowledgePanicAlert } from '@shared/lib/panicAlerts'
import { settleWrite } from '@shared/lib/writeSync'
import { formatDate, formatDateTime, zonedDayNumber } from '@shared/lib/dates'
import { useAuth } from '@shared/auth/AuthContext'
import { distanceMeters, formatDistance } from '@/lib/directions'

/**
 * The SOS alerts feed beside the dispatch map — the minimalist glass column
 * from the user's reference (2026-10-19), replacing `PanicAlertRail`.
 *
 *   ┌ (●) 15 SOS alerts                                        (🔊 Mute) ┐
 *   │     3 need acknowledgement · 12 responding                         │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ NEEDS ACKNOWLEDGEMENT · 3                                          │
 *   │ ┌ Lian Nicole Jabagat                                   4m ago ┐   │
 *   │ │ ⌖ Phase 2 • Block 5 • Lot 02                                 │   │
 *   │ │ (ACTIVE SOS) (No GPS fix)                                    │   │
 *   │ │ ─────────────────────────────────────────────────────────── │   │
 *   │ │ ( Acknowledge )                ( Details )                   │   │
 *   │ └──────────────────────────────────────────────────────────────┘   │
 *   │ RESPONDING · 12                                                    │
 *   │ ┌ … (RESPONDING) (120 m away)                     River Santos ┐   │
 *   │ │ (            Confirm resolve            )                    │   │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * ── LIVE, AND NOT A SECOND SOURCE OF TRUTH ─────────────────────────────────
 * It reads `useLivePanicAlerts`, the one `onSnapshot` the provider owns. The
 * map's nodes and the siren read that same array, so a new SOS, an
 * acknowledgement from another console (Security or Admin) or a resolution
 * shows up here the moment Firestore delivers it. Acknowledge writes straight
 * to `panic_alerts`, and the snapshot that write produces is what moves the
 * card. There is no local copy to drift out of step.
 *
 * ── ORDER: UNATTENDED FIRST, NEWEST ON TOP ─────────────────────────────────
 * Two groups, by proximity and a label rather than by boxes. A fresh panic
 * press always lands at the top of the feed, where the pulse draws the eye.
 */

/** How often the relative ages re-render. Ages read in minutes, so 30s is enough. */
const CLOCK_TICK_MS = 30_000
/** Length of the arrival pulse. Matches `sosArrive` in the shared stylesheet. */
const ARRIVAL_MS = 2400

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * A compact age for the card's corner: "Just now", "4m ago", "2h ago", then a
 * date once the alert is from an earlier day. How long someone has been
 * waiting is the triage question; the full timestamp sits in the tooltip.
 */
function alertAge(date, now) {
  if (!date) return '—'
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime()
  if (Number.isNaN(ms)) return '—'
  const elapsed = Math.max(0, now - ms)
  if (elapsed < MINUTE) return 'Just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (zonedDayNumber(ms) === zonedDayNumber(now)) return `${Math.floor(elapsed / HOUR)}h ago`
  return formatDate(ms)
}

const createdMs = (alert) => alert.createdAt?.getTime?.() ?? Number.POSITIVE_INFINITY
/** Newest first. An alert whose server timestamp has not landed yet IS the newest. */
const byNewest = (a, b) => createdMs(b) - createdMs(a)

/**
 * Ids that arrived after the feed's first loaded snapshot, held for one
 * arrival pulse. Seeded on the first LOADED render so the alerts already open
 * when the console starts do not all pulse at once. The feed stays mounted
 * while the list is empty (it just renders nothing), so the first SOS of a
 * quiet night still counts as an arrival.
 */
function useArrivals(alerts, loading) {
  const seen = useRef(null)
  const [fresh, setFresh] = useState(() => new Set())

  useEffect(() => {
    if (loading) return undefined
    const ids = new Set(alerts.map((alert) => alert.id))
    if (seen.current === null) {
      seen.current = ids
      return undefined
    }
    const arrivals = [...ids].filter((id) => !seen.current.has(id))
    seen.current = ids
    if (!arrivals.length) return undefined

    setFresh((prev) => new Set([...prev, ...arrivals]))
    const timer = setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev)
        arrivals.forEach((id) => next.delete(id))
        return next
      })
    }, ARRIVAL_MS)
    return () => clearTimeout(timer)
  }, [alerts, loading])

  return fresh
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** The small capsule tag: uppercase state, or plain metadata. */
function Tag({ tone = 'neutral', children }) {
  const tones = {
    danger: 'bg-danger/10 text-danger ring-danger/25 uppercase tracking-wider font-semibold',
    warning: 'bg-warning/10 text-warning ring-warning/25 uppercase tracking-wider font-semibold',
    neutral: 'bg-tint/[0.06] text-text-secondary ring-hairline font-medium dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700/50',
  }
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] leading-4 ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  )
}

const secondaryButton =
  'inline-flex min-h-[44px] items-center justify-center rounded-full border border-hairline bg-tint/[0.04] py-2 text-xs font-medium text-text-primary transition-[background-color,border-color,transform] duration-150 ease-out hover:bg-tint/[0.09] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:min-h-0 dark:border-zinc-700/60 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'

/**
 * One alert. The card is a container, not a button: the identity block opens
 * the alert and the actions are its siblings. A <button> inside a <button> is
 * invalid HTML and fires both handlers.
 */
function AlertCard({ alert, origin, now, fresh, busy, onOpen, onAcknowledge }) {
  const waiting = alert.status === 'active'
  const hasFix = Number.isFinite(alert.lat) && Number.isFinite(alert.lng)
  const metres = hasFix && origin ? distanceMeters([alert.lng, alert.lat], [origin.lng, origin.lat]) : null

  return (
    <li
      className={`rounded-xl border border-hairline bg-base-800/40 p-3.5 transition-colors duration-200 hover:border-tint/20 dark:border-zinc-800/70 dark:bg-zinc-900/30 dark:hover:border-zinc-700/80 ${
        fresh ? 'motion-safe:animate-[sosArrive_2.4s_ease-out]' : ''
      }`}
    >
      {/* ── WHO, WHERE, HOW LONG ── opens the alert. */}
      <button
        type="button"
        onClick={() => onOpen(alert)}
        className="block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] font-semibold leading-5 text-text-primary">
            {alert.residentName}
          </span>
          <time
            dateTime={alert.createdAt instanceof Date ? alert.createdAt.toISOString() : undefined}
            title={alert.createdAt ? formatDateTime(alert.createdAt) : 'Time not recorded yet'}
            className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-text-muted"
          >
            {alertAge(alert.createdAt, now)}
          </time>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-text-secondary">
          <MapPin size={13} aria-hidden="true" className="shrink-0 opacity-60" />
          <span className="min-w-0 truncate text-xs">{alert.address}</span>
        </span>
      </button>

      {/* ── STATE ── No GPS-accuracy pill: the SOS payload carries no accuracy
          radius. Whether there is a position at all is known, and changes what
          a responder can do. */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Tag tone={waiting ? 'danger' : 'warning'}>{waiting ? 'Active SOS' : 'Responding'}</Tag>
          {hasFix ? (metres != null ? <Tag>{formatDistance(metres)} away</Tag> : null) : <Tag>No GPS fix</Tag>}
        </div>
        {!waiting && alert.acknowledgedByName ? (
          <span className="min-w-0 truncate text-[11px] font-medium text-text-secondary">{alert.acknowledgedByName}</span>
        ) : null}
      </div>

      {/* ── WHAT TO DO ── Acknowledge only while unattended. Confirm resolve
          opens the alert's modal, which IS the confirmation (notes, photo
          proof), rather than a second press here. */}
      <div className={`mt-3 border-t border-hairline pt-3 dark:border-zinc-800/80 ${waiting ? 'grid grid-cols-2 gap-1.5' : ''}`}>
        {waiting ? (
          <>
            <button
              type="button"
              onClick={() => onAcknowledge(alert)}
              disabled={busy}
              aria-busy={busy || undefined}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-[var(--color-cta)] py-2 text-xs font-medium text-[var(--color-cta-fg)] shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--color-cta-hover)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:min-h-0"
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
            <button
              type="button"
              onClick={() => onOpen(alert)}
              disabled={busy}
              aria-label={`Details of the alert from ${alert.residentName}`}
              className={secondaryButton}
            >
              Details
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onOpen(alert)}
            aria-label={`Confirm resolve the alert from ${alert.residentName}`}
            className={`${secondaryButton} w-full`}
          >
            Confirm resolve
          </button>
        )}
      </div>
    </li>
  )
}

export default function SidebarSOSAlertsFeed({ onOpenAlert, muted, onToggleMute, origin = null }) {
  const { alerts, loading } = useLivePanicAlerts()
  const { user } = useAuth()
  const now = useNow(CLOCK_TICK_MS)
  const fresh = useArrivals(alerts, loading)
  // Scoped to the ALERT: acknowledging one must not freeze the others.
  const [busyId, setBusyId] = useState(null)
  // Shut on a phone until asked; on a console (lg+) always open.
  const [open, setOpen] = useState(false)

  const acknowledge = useCallback(
    async (alert) => {
      setBusyId(alert.id)
      try {
        const outcome = await settleWrite(acknowledgePanicAlert(alert.id, user?.displayName), {
          onLateError: () =>
            toast.error('The server refused the acknowledgement', { description: 'The alert is still open.' }),
        })
        if (outcome === 'queued') {
          toast.warning('SOS acknowledged on this device', { description: 'It will sync when the connection returns.' })
        } else {
          toast.success('SOS acknowledged', { description: 'Every console now shows it as attended.' })
        }
      } catch (err) {
        // The alert stays open, which is the safe failure, but the officer is TOLD.
        console.warn('Panic alert update failed', err)
        toast.error('Could not acknowledge the alert', {
          id: `panic-ack-fail-${alert.id}`,
          description: 'It is still open. Check the connection and try again.',
        })
      } finally {
        setBusyId(null)
      }
    },
    [user?.displayName],
  )

  const groups = useMemo(() => {
    const waiting = alerts.filter((alert) => alert.status === 'active').sort(byNewest)
    const handled = alerts.filter((alert) => alert.status !== 'active').sort(byNewest)
    return [
      { key: 'waiting', title: 'Needs acknowledgement', items: waiting, ink: 'text-danger' },
      { key: 'handled', title: 'Responding', items: handled, ink: 'text-warning' },
    ]
  }, [alerts])

  // No emergencies: no column at all, so the map is full-bleed in the state
  // the console is in almost all of the time. Hooks above still run, so the
  // arrival tracker sees the first SOS of a quiet night.
  if (!alerts.length) return null

  const unattended = groups[0].items.length
  const responding = groups[1].items.length

  return (
    <aside
      aria-label="SOS alerts"
      className={`relative flex w-full shrink-0 flex-col overflow-hidden border-b border-hairline bg-base-900/95 shadow-[0_0_40px_rgba(0,0,0,0.25)] backdrop-blur-3xl lg:w-96 lg:rounded-2xl lg:border dark:border-zinc-800/80 dark:bg-zinc-950/95 dark:shadow-[0_0_40px_rgba(0,0,0,0.8)] ${
        open ? 'max-h-[45vh] lg:max-h-none' : ''
      }`}
    >
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-base-900/80 px-5 py-3.5 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/80">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
            {unattended ? <span className="absolute h-4 w-4 animate-ping rounded-full bg-danger/40" /> : null}
            <span className={`h-2.5 w-2.5 rounded-full ${unattended ? 'bg-danger' : 'bg-warning'}`} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-text-primary">
              {alerts.length === 1 ? '1 SOS alert' : `${alerts.length} SOS alerts`}
            </h2>
            <p className="truncate text-[11px] text-text-muted" aria-live="polite">
              {unattended
                ? `${unattended} need${unattended === 1 ? 's' : ''} acknowledgement · ${responding} responding`
                : 'All acknowledged · none resolved yet'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Mute silences the ROOM, not the emergency: every alert keeps its
              place and status. */}
          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute the SOS siren' : 'Mute the SOS siren'}
            title={muted ? 'The siren is silenced — turn it back on' : 'Silence the siren'}
            className={`inline-flex min-h-[44px] items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors duration-150 lg:min-h-0 ${
              muted
                ? 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20'
                : 'border-hairline bg-tint/[0.04] text-text-secondary hover:bg-tint/[0.09] hover:text-text-primary dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {muted ? <VolumeX size={12} aria-hidden="true" /> : <Volume2 size={12} aria-hidden="true" />}
            {muted ? 'Unmute' : 'Mute'}
          </button>
          {/* Below `lg` only: on a console the list is always open. */}
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls="sos-feed"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-tint/[0.08] hover:text-text-primary lg:hidden"
          >
            <ChevronDown size="sm" className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
            <span className="sr-only">{open ? 'Hide the SOS alerts' : 'Show the SOS alerts'}</span>
          </button>
        </div>
      </header>

      {muted ? (
        <p className="shrink-0 border-b border-hairline bg-warning/10 px-5 py-2 text-[11px] leading-snug text-warning dark:border-zinc-800/80">
          Siren muted. These alerts are still open and still unresolved.
        </p>
      ) : null}

      <div
        id="sos-feed"
        className={`custom-scrollbar drawer-scroll min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5 lg:flex ${open ? 'flex' : 'hidden'}`}
      >
        {groups.map((group) =>
          group.items.length ? (
            <section key={group.key} aria-label={group.title}>
              <h3 className={`mb-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-widest ${group.ink}`}>
                {group.title} · {group.items.length}
              </h3>
              <ul className="flex flex-col gap-3">
                {group.items.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    origin={origin}
                    now={now}
                    fresh={fresh.has(alert.id)}
                    busy={busyId === alert.id}
                    onOpen={onOpenAlert}
                    onAcknowledge={acknowledge}
                  />
                ))}
              </ul>
            </section>
          ) : null,
        )}
      </div>
    </aside>
  )
}
