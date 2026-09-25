import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'

// A resident's data is deliberately split across three collections by the
// mobile app, so the full profile can't come from one read:
//   residents/{uid}  — verification status + the property they claimed
//   users/{uid}      — UserProfileService: name, phone, photoUrl, bio
//   properties/{uid} — PropertyStorage: phase/block/lot + street + unit
// Fetched on demand (only when a drawer opens) rather than joined into the
// list query, which would mean two extra reads per row for data the admin
// usually never looks at.
export function useResidentProfile(uid) {
  const [profile, setProfile] = useState(null)
  const [property, setProperty] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!uid) {
      setProfile(null)
      setProperty(null)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    Promise.all([
      getDoc(doc(db, 'users', uid)).catch(() => null),
      getDoc(doc(db, 'properties', uid)).catch(() => null),
    ])
      .then(([userSnap, propertySnap]) => {
        if (cancelled) return
        setProfile(userSnap?.exists() ? userSnap.data() : null)
        setProperty(propertySnap?.exists() ? propertySnap.data() : null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [uid])

  return { profile, property, loading }
}
