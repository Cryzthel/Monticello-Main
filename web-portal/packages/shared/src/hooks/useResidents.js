import { useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { mapResidentDoc, mapProfileDoc, RESIDENT_SOURCE } from '@shared/lib/residents'

// Single source of truth for "the resident list, live".
//
// A resident's data is deliberately split across collections by the mobile
// app: `residents` holds the verification record, `users` holds the profile
// (photo, and the phone number — which signup does NOT collect, so it only
// ever appears here after the resident edits their profile).
//
// The list is the UNION of the two, not just `residents`. That is what makes
// a newly registered account appear in the dashboard immediately: whichever
// of the two writes lands first is enough to put someone on screen, so a
// failed/slow verification write can no longer hide a real registration
// behind a manual import step. Both listeners are onSnapshot, so an account
// that registers while an admin is looking at the table appears without a
// refresh.
export function useResidents() {
  const residentsQuery = useMemo(() => query(collection(db, 'residents')), [])
  const { data: rawResidents, loading, error } = useLiveCollection(residentsQuery)

  const usersQuery = useMemo(() => query(collection(db, 'users')), [])
  const { data: rawUsers } = useLiveCollection(usersQuery)

  // Staff have `users` docs too — they are not residents and must never show
  // up in this table.
  const staffQuery = useMemo(() => query(collection(db, 'staff_accounts')), [])
  const { data: rawStaff } = useLiveCollection(staffQuery)

  const usersById = useMemo(() => {
    const map = new Map()
    rawUsers.forEach((u) => map.set(u.id, u))
    return map
  }, [rawUsers])

  const residents = useMemo(() => {
    const staffIds = new Set(rawStaff.map((s) => s.id))
    const claimedUids = new Set()

    const fromVerification = rawResidents
      .filter((d) => !staffIds.has(d.id))
      .map((d) => {
        const base = mapResidentDoc(d)
        const profile = usersById.get(base.uid)
        claimedUids.add(base.uid)
        return {
          ...base,
          // Fall back to the profile collection only where the verification
          // record is genuinely missing a value — never overwrite what the
          // resident actually submitted at registration.
          name:
            base.name !== 'Unnamed resident'
              ? base.name
              : profile?.fullName || profile?.name || base.name,
          phone: base.phone || profile?.phone || '',
          email: base.email || profile?.email || '',
          phase: base.phase || profile?.phase || '',
          block: base.block || profile?.block || '',
          lot: base.lot || profile?.lot || '',
          photoUrl: profile?.photoUrl || '',
        }
      })

    // Everyone with a profile but no verification record. Previously these
    // were quarantined as "orphans" and rendered nowhere until imported.
    const fromProfileOnly = rawUsers
      .filter((u) => !claimedUids.has(u.id) && !staffIds.has(u.id))
      .map(mapProfileDoc)

    return [...fromVerification, ...fromProfileOnly]
  }, [rawResidents, rawUsers, rawStaff, usersById])

  // `all` is a real key here rather than something the page derives, so the
  // master tab's badge and the per-status badges can never disagree.
  const counts = useMemo(
    () =>
      residents.reduce(
        (acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1
          acc.all += 1
          return acc
        },
        { all: 0 },
      ),
    [residents],
  )

  // Still surfaced — not to gate visibility, but because a profile with no
  // verification record is the fingerprint of a failed signup write, and an
  // admin should know how many of those exist.
  const profileOnly = useMemo(
    () => residents.filter((r) => r.source === RESIDENT_SOURCE.profile),
    [residents],
  )

  return { residents, counts, profileOnly, loading, error }
}
