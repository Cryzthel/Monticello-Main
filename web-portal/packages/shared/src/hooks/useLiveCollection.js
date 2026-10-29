import { useEffect, useState } from 'react'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'

// Subscribes to a Firestore query and keeps `data` in sync in real time.
// Both the Security triage panel and the Admin heatmap read reports through this hook.
// A listener that errors is re-attached with a back-off (see subscribeWithRetry),
// so one refused read no longer freezes the list for the rest of the session.
export function useLiveCollection(query) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!query) return undefined

    setLoading(true)
    return subscribeWithRetry(
      query,
      (snapshot) => {
        // `estimate`, not the default `none`: until the server acknowledges a
        // write, a `serverTimestamp()` field reads as NULL in the local
        // snapshot. Soft delete is exactly such a write (`deletedAt`), so
        // the tab that pressed Delete kept showing the row — and every count
        // that excludes deleted reports kept it — until the round trip
        // landed, which on a slow link or a cold connection looked like the
        // delete had not worked. Estimated, the field is the local clock's
        // time at once and the server's value when it arrives.
        setData(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data({ serverTimestamps: 'estimate' }) })))
        setError(null)
        setLoading(false)
      },
      (snapshotError) => {
        setError(snapshotError)
        setLoading(false)
      },
    )
  }, [query])

  return { data, loading, error }
}
