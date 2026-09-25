import { useEffect, useMemo, useRef } from 'react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '@shared/lib/firebase'
import { useToast } from '@shared/components/ToastProvider'
import { incidentNotification } from '@shared/lib/notifications'
import { playAlert } from '@shared/lib/alertSound'

/**
 * Turns live Firestore changes into top-right incident notification cards.
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
export function useIncidentAlerts({ detailPath, enabled = true } = {}) {
  const { notify } = useToast()
  const navigate = useNavigate()

  const primed = useRef(false)
  const lastStatus = useRef(new Map())

  // Newest-first with a cap: this listener exists to announce what just
  // happened, so it has no reason to stream the entire history.
  const incidentsQuery = useMemo(
    () => query(collection(db, 'incidents'), orderBy('reportedAt', 'desc'), limit(25)),
    [],
  )

  useEffect(() => {
    if (!enabled) return undefined

    primed.current = false
    lastStatus.current = new Map()

    const unsubscribe = onSnapshot(
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

          // Built by the same function the bell panel uses, so a toast and the
          // row it later becomes are the same notification — same tone, same
          // subject, same sentence — rather than two parallel formatters that
          // drift.
          const notification = incidentNotification({ id, ...data })
          notify({
            ...notification,
            dedupeKey: notification.id,
            onView: detailPath ? () => navigate(`${detailPath}?incident=${id}`) : undefined,
          })

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
      },
    )

    return unsubscribe
  }, [incidentsQuery, enabled, notify, navigate, detailPath])
}
