import { useEffect, useState } from 'react'
import { collection, query } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'
import { mapPanicAlertDoc } from '@shared/lib/panicAlerts'
import { isPanicLive } from '@shared/lib/panicStatus'

/*
  ── ONE LISTENER FOR EVERY CALLER (the duplicate-subscription fix) ──────────
  This hook is called from the notification bell, which lives in AppShell and is
  therefore mounted on EVERY page of both portals, and again from whatever the
  page itself needs: the Panic alerts table, and the Admin Overview's metrics.
  Each call used to open its own `onSnapshot` on the whole `panic_alerts`
  collection, so the Overview held two listeners streaming the same documents
  and paid for the same reads twice.

  Worse than the cost: the two arrays were separate React state, so they could
  render one snapshot apart. On a page that counts alerts in a headline figure
  and lists them in a bell at the same time, that is a visible disagreement with
  no cause a reader could see.

  The subscription is now module-level and reference-counted. The first hook to
  mount opens it, every later caller is handed the SAME mapped array by identity
  (so their memos and `useEffect` dependencies do not re-fire), and the last to
  unmount closes it. Re-subscription after an error is still
  `subscribeWithRetry`'s job, unchanged.

  Mapping and sorting happen ONCE per snapshot here rather than once per caller,
  which is the same argument the Overview's metrics make: a derivation performed
  in several places is a derivation that can differ between them.

  Deliberately NOT a cache that outlives its subscribers: at zero listeners the
  snapshot is dropped along with the subscription, so a remount reads fresh
  rather than painting a stale emergency list from a previous route.
*/

/** The current shared snapshot, and everyone waiting on it. */
const store = {
  state: { alerts: [], liveCount: 0, loading: true, error: null },
  listeners: new Set(),
  unsubscribe: null,
}

function publish(next) {
  store.state = { ...store.state, ...next }
  store.listeners.forEach((listener) => listener(store.state))
}

function attach() {
  if (store.unsubscribe) return
  store.state = { ...store.state, loading: true }
  // Built here, not at module scope: this module is imported by the portal
  // chrome, and a `collection()` call at import time would run before anything
  // has had a chance to decide whether Firebase should be initialised at all.
  const panicQuery = query(collection(db, 'panic_alerts'))
  store.unsubscribe = subscribeWithRetry(
    panicQuery,
    (snap) => {
      // `estimate`, for the reason spelled out in useLiveCollection: until the
      // server acknowledges a write, a `serverTimestamp()` field reads as null
      // locally — and for a panic alert that field is `createdAt`, the one this
      // whole list is sorted by.
      const alerts = snap.docs
        .map((d) => mapPanicAlertDoc({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
        .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))
      publish({
        alerts,
        liveCount: alerts.filter((alert) => isPanicLive(alert.status)).length,
        loading: false,
        error: null,
      })
    },
    (error) => publish({ loading: false, error }),
  )
}

function detach() {
  if (store.listeners.size > 0) return
  store.unsubscribe?.()
  store.unsubscribe = null
  store.state = { alerts: [], liveCount: 0, loading: true, error: null }
}

/**
 * Every panic alert ever raised, live, newest first.
 *
 * ── WHY THIS IS NOT THE DISPATCH MAP'S QUERY ──────────────────────────────
 * The map subscribes with `where('status', 'in', ['active', 'acknowledged'])`,
 * which is right for a map: a resolved emergency is not a place a guard needs
 * to go. This is the RECORD, so it is deliberately unfiltered — an emergency
 * log that drops entries once they are handled cannot answer the question a log
 * exists for, which is what happened and when.
 *
 * Sorted in JS rather than with `orderBy` so an alert whose `createdAt` server
 * timestamp has not resolved yet still appears. A Firestore `orderBy` omits
 * documents missing the field entirely, which for the seconds between a
 * resident pressing SOS and the server stamping it would hide the newest and
 * most urgent row on the page.
 *
 * No `deletedAt` / `archivedAt` filter, and that is not an omission: panic
 * alerts have neither field. Nothing in either portal or the mobile app can
 * soft-delete or archive an emergency — it is the one record type that is only
 * ever appended to. Worth stating because the incident feed DOES filter one of
 * them out, and a reader comparing the two would otherwise have to guess which
 * of them is wrong.
 */
export function usePanicAlerts() {
  const [state, setState] = useState(store.state)

  useEffect(() => {
    store.listeners.add(setState)
    attach()
    // Hand the newcomer whatever is already in hand, so a hook mounting onto an
    // already-live subscription does not report `loading` until the next
    // snapshot happens to arrive.
    setState(store.state)
    return () => {
      store.listeners.delete(setState)
      detach()
    }
  }, [])

  return state
}
