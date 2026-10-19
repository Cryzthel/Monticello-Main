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
        setData(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
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
