import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { collection, query, orderBy, limit } from 'firebase/firestore'
import { Bell, BellRinging } from '@shared/icons'
import NotificationPanel from '@shared/components/NotificationPanel'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { buildNotificationFeed, groupNotificationsByDay, notificationHref } from '@shared/lib/notifications'
import { useNotificationReads } from '@shared/hooks/useNotificationReads'
import { PORTAL } from '@shared/config/portal'
import { usePanicAlerts } from '@shared/hooks/usePanicAlerts'
import { useAuth } from '@shared/auth/AuthContext'



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
export default function NotificationBell({ detailPath, historyPath = '/history', routes = null }) {
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const [filter, setFilter] = useState('all')

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

  // Live, per user and per console, in Firestore — see useNotificationReads.
  const reads = useNotificationReads(user?.uid ?? null)
  const unreadIds = useMemo(
    () => new Set(feed.filter((item) => reads.isUnread(item)).map((item) => item.id)),
    [feed, reads],
  )

  // Counts come off the FULL feed, not the filtered view — a tab has to be
  // able to say how many rows it holds while you are looking at another one.
  const counts = useMemo(() => ({ all: feed.length, unread: unreadIds.size }), [feed, unreadIds])

  const visible = useMemo(() => {
    if (filter === 'all') return feed
    return feed.filter((item) => unreadIds.has(item.id))
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

  /**
   * Where each kind opens. The app's own map wins; without one, incidents
   * fall back to `detailPath` so an app that has not passed routes keeps the
   * behaviour it had.
   */
  const effectiveRoutes = useMemo(
    () => routes ?? (detailPath ? { incident: `${detailPath}?incident=` } : {}),
    [routes, detailPath],
  )

  /** Read first (instant), then go — a row with no destination just reads. */
  function openNotification(item) {
    reads.markRead(item.id)
    const href = notificationHref(item, effectiveRoutes)
    if (!href) return
    setOpen(false)
    navigate(href)
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
              // SOLID, after the reference panel: the list inside is its own
              // darker well, and blur behind a solid card buys nothing.
              className="popover z-[var(--z-popover)] flex max-h-[min(40rem,calc(100vh-6rem))] w-[28rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-hairline bg-base-950 shadow-2xl"
            >
              <NotificationPanel
                sections={sections}
                counts={counts}
                filter={filter}
                onFilterChange={setFilter}
                isUnread={(item) => unreadIds.has(item.id)}
                onMarkAllRead={reads.markAllRead}
                onOpen={openNotification}
                onViewAll={() => {
                  navigate(historyPath)
                  setOpen(false)
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
