import { useEffect, useMemo, useRef } from 'react'
import { collection, query, orderBy, limit } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'
import { playAlert } from '@shared/lib/alertSound'

/**
 * Turns live Firestore changes into the console's ALERT SOUNDS. It used to
 * raise a top-right card for each as well; those were removed (2026-10-19,
 * by request) because the notification bell shows the same rows live. The
 * sound is what calls the operator to the bell.
 *
 * Uses a raw onSnapshot rather than useLiveCollection because this needs
 * `snapshot.docChanges()` — the *diff* — not the current array. Diffing a
 * previous array in React state would fire an alert for every doc on first
 * render and re-fire on any unrelated re-render.
 *
 * Two things are deliberately suppressed:
 *  - The first snapshot. Firestore delivers the whole result set as `added`
 *    when a listener attaches, so without this every page load would erupt
 *    with a card per existing incident.
 *  - `modified` events that didn't change the status. The onIncidentWrite
 *    Cloud Function stamps `wpdaScore` moments after create, which arrives as
 *    a modification the operator does not need to be told about.
 *
 * @param {object}  options
 * @param {string}  options.detailPath Route the "View Incident" action opens.
 * @param {boolean} options.enabled    Pass false to keep the listener closed.
 */
export function useIncidentAlerts({ enabled = true } = {}) {
  const primed = useRef(false)
  const lastStatus = useRef(new Map())

  // Newest-first with a cap: this listener exists to announce what just
  // happened, so it has no reason to stream the entire history.
  //
  // Ordered by `createdAt` — the SERVER's write time — not `reportedAt`. The
  // mobile app files `reportedAt` as the oldest attached photo's camera time,
  // so a report sent with a photo taken this morning sorted below the newest
  // 25 and arrived with no alert at all. `createdAt` is when it reached us.
  const incidentsQuery = useMemo(
    () => query(collection(db, 'incidents'), orderBy('createdAt', 'desc'), limit(25)),
    [],
  )

  useEffect(() => {
    if (!enabled) return undefined

    primed.current = false
    lastStatus.current = new Map()

    const unsubscribe = subscribeWithRetry(
      incidentsQuery,
      (snapshot) => {
        if (!primed.current) {
          snapshot.docs.forEach((docSnap) => {
            lastStatus.current.set(docSnap.id, docSnap.data().status)
          })
          primed.current = true
          return
        }

        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data()
          const id = change.doc.id

          if (change.type === 'removed') {
            lastStatus.current.delete(id)
            return
          }

          // A status change is only worth announcing if the status actually
          // changed. The onIncidentWrite Cloud Function stamps `wpdaScore`
          // moments after create, which arrives as a modification the operator
          // does not need to be told about.
          if (change.type === 'modified' && lastStatus.current.get(id) === data.status) return
          lastStatus.current.set(id, data.status)

          // ── AUDIBLE ALERT ────────────────────────────────────────────────
          //
          // Fired here rather than inside the toast component so it inherits
          // every suppression above for free: no burst on first snapshot, and
          // nothing for the wpdaScore write the Cloud Function makes moments
          // after create. A sound that cries wolf on page load is a sound the
          // guard learns to ignore.
          //
          // Three signatures, because "a report came in" and "someone pressed
          // the panic button" should not sound alike from across the room.
          // A new critical report outranks everything; an existing incident
          // merely changing status gets the quietest tone.
          const isNew = change.type === 'added'
          const critical =
            data.priority === 'critical' || data.priority === 'high'
          playAlert(isNew ? (critical ? 'critical' : 'report') : 'update')
        })
      },
      (error) => {
        // Surfaced rather than swallowed: a permission-denied here means the
        // signed-in account isn't staff, which is worth knowing.
        console.error('Incident alert listener failed', error)
        // Re-attached after a back-off; its first snapshot re-primes rather
        // than announcing every incident as new.
        primed.current = false
      },
    )

    return unsubscribe
  }, [incidentsQuery, enabled])
}
