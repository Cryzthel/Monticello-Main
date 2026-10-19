import { useEffect, useState } from 'react'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'
import { doc } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'

// Subscribed on demand (not joined into mapIncidentDoc) — most incident list
// views never need a reporter's phone number, only the detail modal /
// verification view does, and only for whichever one report is open.
//
// LIVE, not fetched once (2026-10-18). This was a single `getDoc`, so a
// resident approved, or a phone number added, while their report sat open in
// the Hazard Map drawer or the ticket modal kept showing the old badge and an
// em-dash until the view was reopened. One listener per open report.
export function useReporterContact(reporterUid) {
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setContact(null)
    if (!reporterUid) {
      setLoading(false)
      return undefined
    }

    setLoading(true)
    return subscribeWithRetry(
      doc(db, 'users', reporterUid),
      (snap) => {
        setContact(snap.exists() ? snap.data() : null)
        setLoading(false)
      },
      (err) => {
        // A guard console may not read every profile; the views fall back to
        // the name on the report itself.
        console.warn('Resident contact unavailable', err?.code ?? err)
        setContact(null)
        setLoading(false)
      },
    )
  }, [reporterUid])

  return { contact, loading }
}
