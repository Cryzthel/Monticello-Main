import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'
import { PORTAL, portalKey } from '@shared/config/portal'

/**
 * Which notifications this staff member has read — live, per user, per
 * console, in Firestore.
 *
 * ── WHY NOT localStorage ANY MORE (2026-10-17) ─────────────────────────────
 * Read state was one "last seen" timestamp in localStorage: per browser, so a
 * laptop and a phone disagreed about what was new, a second tab never heard
 * about "Mark all read", and there was no way to mark ONE notification read.
 *
 * ── WHERE IT LIVES ─────────────────────────────────────────────────────────
 * `users/{uid}.notificationState.{admin|security}`:
 *
 *   lastSeenAt  epoch ms — everything at or before it is read ("Mark all read")
 *   readIds     notification ids read individually since then (clicked)
 *
 * `users/{uid}` because firestore.rules already lets an owner write their own
 * document (`allow write: if isOwner(userId)`), so this needed no rules change
 * and no deploy. Staff ids are excluded wherever that collection is listed as
 * residents (useResidents), so a staff member's document never appears as one.
 * Keyed by PORTAL because a super admin can sign into both consoles, and the
 * two feeds are different lists.
 *
 * ── ONE LISTENER, CLEANED UP ───────────────────────────────────────────────
 * The snapshot listener is the only subscription and its unsubscribe is the
 * effect's cleanup, re-run only when the uid changes.
 */

const MAX_READ_IDS = 300
const LEGACY_KEY = portalKey('notifications-last-seen')

function legacyLastSeen() {
  try {
    return Number(localStorage.getItem(LEGACY_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

export function useNotificationReads(uid) {
  // Seeded from the old localStorage cursor so nothing that was already read
  // turns unread again on the first load after this change.
  const [state, setState] = useState(() => ({ lastSeenAt: legacyLastSeen(), readIds: new Set() }))
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!uid) return undefined
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const stored = snap.data()?.notificationState?.[PORTAL]
        if (!stored) return
        setState({
          // Never move the cursor backwards: an older device writing a stale
          // value must not resurrect what was already marked read here.
          lastSeenAt: Math.max(Number(stored.lastSeenAt) || 0, legacyLastSeen()),
          readIds: new Set(Array.isArray(stored.readIds) ? stored.readIds : []),
        })
      },
      // Unreadable (offline, rules): keep the local state; the panel still works.
      (err) => console.warn('Notification read state unavailable', err),
    )
  }, [uid])

  const persist = useCallback(
    (next) => {
      setState(next)
      if (!uid) return
      setDoc(
        doc(db, 'users', uid),
        {
          notificationState: {
            [PORTAL]: { lastSeenAt: next.lastSeenAt, readIds: [...next.readIds].slice(-MAX_READ_IDS) },
          },
        },
        { merge: true },
      ).catch((err) => console.warn('Could not save notification read state', err))
    },
    [uid],
  )

  const isUnread = useCallback(
    (item) => (item.at?.getTime?.() ?? 0) > state.lastSeenAt && !state.readIds.has(item.id),
    [state],
  )

  /** Marks one notification read — instantly here, then in Firestore. */
  const markRead = useCallback(
    (id) => {
      const current = stateRef.current
      if (current.readIds.has(id)) return
      persist({ lastSeenAt: current.lastSeenAt, readIds: new Set([...current.readIds, id]) })
    },
    [persist],
  )

  /** Everything up to now is read; individual ids before now are redundant. */
  const markAllRead = useCallback(() => {
    persist({ lastSeenAt: Date.now(), readIds: new Set() })
  }, [persist])

  return useMemo(() => ({ isUnread, markRead, markAllRead }), [isUnread, markRead, markAllRead])
}
