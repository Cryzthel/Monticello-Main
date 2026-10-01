import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { collection, query, orderBy, limit } from 'firebase/firestore'
import { Bell, BellOff, BellRinging, CheckCheck, Clock } from '@shared/icons'
import NotificationRow from '@shared/components/NotificationRow'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { portalKey } from '@shared/config/portal'
import { buildNotificationFeed, groupNotificationsByDay } from '@shared/lib/notifications'
import { PORTAL } from '@shared/config/portal'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'
import { useAuth } from '@shared/auth/AuthContext'

// Namespaced per portal, and this one is a genuine bug fix rather than tidiness:
// on a shared key the admin console and the guardhouse overwrite each other's
// read-cursor, so acknowledging notifications in one silently marks the other's
// unrelated feed as seen. No portal argument — the bell is rendered by both
// shells, so it takes the portal of whichever console mounted it.
const LAST_SEEN_KEY = portalKey('notifications-last-seen')

// The panel's filter vocabulary. `unread` is first because it is the one an
// operator returning to a console actually reaches for; the two kind filters
// exist because incidents and announcements are read for different reasons and
// at different moments.
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'incident', label: 'Incidents' },
  { id: 'announcement', label: 'Announcements' },
]

/**
 * Notification hub shared by both portals.
 *
 * Feeds on live `incidents` AND `announcements` through the same
 * useLiveCollection onSnapshot listeners used elsewhere, so a new report
 * appears here the instant it is written.
 *
 * -- STRUCTURE, NOT A LIST -------------------------------------------------
 * Three tiers, in the order a reader needs them:
 *
 *   1. A header stating how many are unread and offering the one bulk action.
 *   2. A filter bar carrying live counts, so "is there anything new" and
 *      "anything on the bulletin" are answered before any row is read.
 *   3. Day-grouped sections with sticky headers, each holding cards on the
 *      shared three-column grid (see NotificationRow).
 *
 * The footer link is pinned outside the scroll area rather than sitting at the
 * end of the feed, which is where it used to be reachable only by scrolling
 * past everything the link exists to escape.
 *
 * The dropdown is rendered through a portal into document.body and positioned
 * with `fixed` coordinates computed from the bell button's own bounding rect.
 * The bell sits inside a header card and a scrolling main column, either of
 * which clips an inline `absolute` dropdown at its edge. A portal sidesteps
 * that entirely: there is no shared ancestor left to be clipped by.
 *
 * @param {string} [detailPath] Route a row's action navigates to.
 * @param {string} [historyPath] Route the "Notification history" control opens.
 *   Defaults to this app's own /history — a shared component must never name a
 *   particular portal's routes, which is what the old '/admin/history' default
 *   did: the guardhouse bell silently pointed at a console its users cannot open.
 */
export default function NotificationBell({ detailPath, historyPath = '/history' }) {
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const [filter, setFilter] = useState('all')
  const [lastSeen, setLastSeen] = useState(() => Number(localStorage.getItem(LAST_SEEN_KEY) ?? 0))

  const incidentsQuery = useMemo(
    () => query(collection(db, 'incidents'), orderBy('reportedAt', 'desc'), limit(25)),
    [],
  )
  const { data: incidents } = useLiveCollection(incidentsQuery)

  const announcementsQuery = useMemo(
    () => query(collection(db, 'announcements'), orderBy('publishedAt', 'desc'), limit(10)),
    [],
  )
  const { data: announcements } = useLiveCollection(announcementsQuery)

  // `PORTAL` is a build-time constant (each vite.config defines __PORTAL__), so
  // each console asks for its own half of the feed without a prop threaded
  // through two layouts to say which console it is.
  const { alerts: panicAlerts } = usePanicAlerts()
  const { user } = useAuth()

  const feed = useMemo(
    () =>
      buildNotificationFeed({
        incidents,
        announcements,
        panicAlerts,
        audience: PORTAL,
        viewerUid: user?.uid ?? null,
      }),
    [incidents, announcements, panicAlerts, user?.uid],
  )

  const unreadIds = useMemo(() => {
    const ids = new Set()
    feed.forEach((item) => {
      if ((item.at?.getTime() ?? 0) > lastSeen) ids.add(item.id)
    })
    return ids
  }, [feed, lastSeen])

  // Counts come off the FULL feed, not the filtered view — a tab has to be
  // able to say how many rows it holds while you are looking at another one.
  const counts = useMemo(
    () => ({
      all: feed.length,
      unread: unreadIds.size,
      incident: feed.filter((item) => item.kind === 'incident').length,
      announcement: feed.filter((item) => item.kind === 'announcement').length,
    }),
    [feed, unreadIds],
  )

  const visible = useMemo(() => {
    if (filter === 'all') return feed
    if (filter === 'unread') return feed.filter((item) => unreadIds.has(item.id))
    return feed.filter((item) => item.kind === filter)
  }, [feed, filter, unreadIds])

  const sections = useMemo(() => groupNotificationsByDay(visible), [visible])

  // Opening does not mark everything read — that made the unread rules vanish
  // the moment you looked at them, so you could never tell WHICH rows were new.
  // "Mark all read" is explicit.
  function handleToggle() {
    const next = !open
    if (next && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPosition({ top: rect.bottom + 10, right: window.innerWidth - rect.right })
    }
    setOpen(next)
  }

  function markAllRead() {
    const now = Date.now()
    localStorage.setItem(LAST_SEEN_KEY, String(now))
    setLastSeen(now)
  }

  useEffect(() => {
    if (!open) return undefined

    function handleClickOutside(event) {
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return
      setOpen(false)
    }
    function handleKeydown(event) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [open])

  const unreadCount = unreadIds.size

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        aria-expanded={open}
        // Same standardized icon container as the theme toggle beside it, with
        // the shared "on" plate while the panel is open — see .icon-btn-active
        // and .icon-btn-plain. No resting border or fill: the only shape this
        // draws is the hover wash, and the open plate that replaces it.
        className={`icon-btn icon-btn-md icon-btn-plain relative ${open ? 'icon-btn-active' : ''}`}
      >
        {/* 20px — the spec's icon scale, and the size a 40px .icon-btn-md is
            proportioned for.

            The glyph itself carries the unread state, not only the count
            capsule pinned to it: `notifications_active` is the same rounded
            bell with motion arcs, so the control reads as "ringing" before the
            eye reaches the number. That matters because the capsule is 16px of
            danger red in the far corner of the header — the first thing a
            colour-blind or peripherally-glancing operator has to resolve — and
            a shape change is the redundant signal it was missing. Both are
            FILL=0, so this is a change of drawing, not of weight. */}
        {unreadCount > 0 ? <BellRinging size="md" /> : <Bell size="md" />}
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-2xs font-semibold tabular-nums text-white ring-2 ring-base-950">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Notifications"
              style={{ position: 'fixed', top: position.top, right: position.right, '--popover-origin': 'top right' }}
              className="popover z-[var(--z-popover)] flex max-h-[min(34rem,calc(100vh-6rem))] w-[27rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden bg-base-900"
            >
              {/* ── HEADER ───────────────────────────────────────────────── */}
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h2 className="text-sm font-semibold text-text-primary">Notifications</h2>
                  <span className="font-mono text-caption tabular-nums text-text-muted">
                    {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <CheckCheck size="sm" />
                  Mark all read
                </button>
              </div>

              {/* ── FILTERS ──────────────────────────────────────────────────
                  Counts live on the tabs so the panel answers "is there
                  anything new" before a single row has been read. A tab with
                  nothing behind it is disabled rather than hidden, so the bar
                  does not reflow as reports arrive. */}
              <div
                role="tablist"
                aria-label="Filter notifications"
                className="flex shrink-0 items-center gap-1 border-b border-hairline px-2.5 py-2"
              >
                {FILTERS.map((tab) => {
                  const count = counts[tab.id]
                  const selected = filter === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      disabled={count === 0 && !selected}
                      onClick={() => setFilter(tab.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                        selected
                          ? 'bg-brand-100 text-brand-400'
                          : 'text-text-secondary hover:bg-tint/[0.06] hover:text-text-primary'
                      }`}
                    >
                      {tab.label}
                      <span className="font-mono text-2xs tabular-nums opacity-70">{count}</span>
                    </button>
                  )
                })}
              </div>

              {/* ── FEED ─────────────────────────────────────────────────── */}
              {sections.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-14 text-center">
                  <BellOff size="lg" className="text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    {filter === 'all' ? 'No activity yet.' : 'Nothing in this view.'}
                  </p>
                </div>
              ) : (
                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pb-6">
                  {sections.map((section) => (
                    <section key={section.key}>
                      {/* Sticky, so the day a row belongs to is still on screen
                          after scrolling into the middle of a long group. */}
                      <h3 className="sticky top-0 z-10 bg-base-900 px-4 py-1.5 text-2xs font-semibold text-text-muted">
                        {section.label}
                      </h3>
                      <ul className="space-y-0.5 px-1.5 pb-1.5">
                        {section.items.map((item) => (
                          <NotificationRow
                            key={item.id}
                            notification={item}
                            unread={unreadIds.has(item.id)}
                            onSelect={
                              item.kind === 'incident' && detailPath
                                ? () => {
                                    navigate(`${detailPath}?incident=${item.sourceId}`)
                                    setOpen(false)
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}

              {/* ── FOOTER ───────────────────────────────────────────────────
                  Pinned outside the scroll area. It used to sit in the header
                  beside "Mark all read", where two controls of very different
                  weight — a per-panel toggle and a route change — read as one
                  run-on label. */}
              <button
                type="button"
                onClick={() => {
                  // Only the admin portal has an audit archive; the guard
                  // portal's own History page is its equivalent.
                  navigate(historyPath)
                  setOpen(false)
                }}
                className="flex shrink-0 items-center justify-center gap-1.5 border-t border-hairline px-4 py-2.5 text-xs font-semibold text-brand-400 transition-colors hover:bg-tint/[0.04] hover:text-brand-300"
              >
                <Clock size="sm" />
                Notification history
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
