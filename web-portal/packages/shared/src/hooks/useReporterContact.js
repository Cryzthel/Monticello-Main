import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'

// Fetched on demand (not joined into mapIncidentDoc) — most incident list
// views never need a reporter's phone number, only the detail modal /
// verification view does, and only for whichever one report is open.
export function useReporterContact(reporterUid) {
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!reporterUid) {
      setContact(null)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    getDoc(doc(db, 'users', reporterUid))
      .then((snap) => {
        if (cancelled) return
        setContact(snap.exists() ? snap.data() : null)
      })
      .catch((err) => {
        console.error('Failed to load resident contact', err)
        if (!cancelled) setContact(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reporterUid])

  return { contact, loading }
}
