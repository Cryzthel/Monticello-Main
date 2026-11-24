import { useEffect, useState } from 'react'
import { doc } from 'firebase/firestore'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'
import { db } from '@shared/lib/firebase'

// A resident's data is deliberately split across three collections by the
// mobile app, so the full profile can't come from one read:
//   residents/{uid}  — verification status + the property they claimed
//   users/{uid}      — UserProfileService: name, phone, photoUrl, bio
//   properties/{uid} — PropertyStorage: phase/block/lot + street + unit
// Subscribed on demand (only while a drawer is open) rather than joined into
// the list query, which would mean two extra listeners per row for data the
// admin usually never looks at.
//
// LIVE, not fetched once. It was two `getDoc` calls, so a resident who fixed
// their phone number or lot in the mobile app while the admin had their
// drawer open was reviewed against the stale copy. The residents/{uid} half
// was already live (useResidents); these two now are as well.
export function useResidentProfile(uid) {
  const [profile, setProfile] = useState(null)
  const [property, setProperty] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setProfile(null)
    setProperty(null)
    if (!uid) {
      setLoading(false)
      return undefined
    }

    setLoading(true)
    // Each listener reports once before `loading` clears, so the drawer never
    // flashes "no property on file" while the second read is still in flight.
    const pending = new Set(['users', 'properties'])
    const settle = (key) => {
      pending.delete(key)
      if (pending.size === 0) setLoading(false)
    }

    const listen = (collectionName, set) =>
      subscribeWithRetry(
        doc(db, collectionName, uid),
        (snap) => {
          set(snap.exists() ? snap.data() : null)
          settle(collectionName)
        },
        // A denied or missing profile is not fatal: the residents record
        // still carries the essentials, and the drawer falls back to it.
        () => {
          set(null)
          settle(collectionName)
        },
      )

    const stopUser = listen('users', setProfile)
    const stopProperty = listen('properties', setProperty)
    return () => {
      stopUser()
      stopProperty()
    }
  }, [uid])

  return { profile, property, loading }
}
