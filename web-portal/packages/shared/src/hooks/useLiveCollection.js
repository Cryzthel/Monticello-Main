import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'

// Subscribes to a Firestore query and keeps `data` in sync in real time.
// Both the Security triage panel and the Admin heatmap read reports through this hook.
export function useLiveCollection(query) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!query) return undefined

    setLoading(true)
    const unsubscribe = onSnapshot(
      query,
      (snapshot) => {
        setData(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
        setLoading(false)
      },
      (snapshotError) => {
        setError(snapshotError)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [query])

  return { data, loading, error }
}
