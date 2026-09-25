import { useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'

/**
 * Every resident, with the Phase / Block / Lot the MOBILE APP registered.
 *
 * This is the join the report composer binds its location fields to, and the
 * source the address cascade is built from. It exists as its own hook rather
 * than reusing `useResidents` for one specific reason, below.
 *
 * ── WHY NOT `useResidents` ────────────────────────────────────────────────
 * That hook also subscribes to `staff_accounts`, to strip staff out of the
 * admin table. firestore.rules gates that collection on
 * `isOwner(userId) || isAdminStaff()` — a `security_officer` may read their
 * OWN row and nothing else, so the list query is denied for exactly the
 * people this hook is for. Reusing it in the guardhouse would have produced a
 * permanently empty picker with a permission error in the console.
 *
 * No staff filter is needed here anyway: this joins OUT of `residents`, and
 * staff do not have `residents` documents — they have `staff_accounts`. A
 * `users` profile is only ever read for a uid that already appeared in
 * `residents`, so a staff profile has no route into the result.
 *
 * ── WHY NOT `properties/{uid}`, WHICH IS THE REAL VERIFIED RECORD ─────────
 * Because no member of staff can read it. Its rule is
 * `allow read, write: if isOwner(userId)` — owner only, with no staff clause —
 * so a collection LIST is denied outright for admins and guards alike.
 *
 * That is not a gap in the data: `PropertyStorage.saveVerifiedProperty`
 * (lib/features/property/services/property_storage.dart) deliberately mirrors
 * the same three values into two staff-readable places at the moment of
 * verification —
 *
 *     properties/{uid}  phase | block | lot            ← owner only
 *     users/{uid}       phase | block | lot            ← isStaff() may read
 *     residents/{uid}   propertyPhase|Block|Lot        ← isStaff() may read
 *
 * — and its own comment says why: "so staff see the full address regardless of
 * whether this or markPending's write lands first". The mirrors ARE the staff
 * read path. Reading them is not a workaround; it is the design.
 *
 * ── PRECEDENCE, AND WHY IT IS THIS WAY ROUND ──────────────────────────────
 * `users` first, then `residents`. Both are mirrors, but they are written at
 * different moments by different flows:
 *
 *   residents.propertyPhase   written by BOTH signup (markPending, as
 *                             phase/block/lot) and verification
 *   users.phase               written ONLY by saveVerifiedProperty
 *
 * So a value on the `users` doc is evidence the resident completed property
 * verification, while a value on `residents` may be the address typed at
 * signup and never confirmed. When the two disagree the verified one should
 * win, and preferring `users` is what expresses that.
 */

const norm = (value) => String(value ?? '').trim()

/** `Phase 2 • Block 7 • Lot 14`, skipping whatever is missing. */
export function addressLabel({ phase, block, lot }) {
  return [phase && `Phase ${phase}`, block && `Block ${block}`, lot && `Lot ${lot}`]
    .filter(Boolean)
    .join(' • ')
}

export function useResidentAddresses() {
  const residentsQuery = useMemo(() => query(collection(db, 'residents')), [])
  const usersQuery = useMemo(() => query(collection(db, 'users')), [])

  const { data: rawResidents, loading: loadingResidents, error: residentsError } =
    useLiveCollection(residentsQuery)
  const { data: rawUsers, loading: loadingUsers, error: usersError } = useLiveCollection(usersQuery)

  const usersById = useMemo(() => {
    const map = new Map()
    rawUsers.forEach((u) => map.set(u.id, u))
    return map
  }, [rawUsers])

  const residents = useMemo(
    () =>
      rawResidents
        .map((d) => {
          const uid = d.uid ?? d.id
          const profile = usersById.get(uid)

          // See the precedence note above: the `users` mirror is written only
          // by verification, so it outranks the `residents` one.
          const phase = norm(profile?.phase) || norm(d.phase) || norm(d.propertyPhase)
          const block = norm(profile?.block) || norm(d.block) || norm(d.propertyBlock)
          const lot = norm(profile?.lot) || norm(d.lot) || norm(d.propertyLot)

          return {
            uid,
            name: d.name || d.fullName || profile?.fullName || profile?.name || 'Unnamed resident',
            email: d.email || profile?.email || '',
            phone: d.phone || profile?.phone || '',
            phase,
            block,
            lot,
            label: addressLabel({ phase, block, lot }),
            // Whether this resident can actually fill the composer. A profile
            // with no address is still listed — a guard may need to file
            // against them — but the picker says so rather than silently
            // filling nothing.
            hasAddress: Boolean(phase && block && lot),
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [rawResidents, usersById],
  )

  return {
    residents,
    loading: loadingResidents || loadingUsers,
    // Surfaced rather than swallowed: a denied listener resolves to an empty
    // array, which is indistinguishable from "this subdivision has no
    // residents" — the worst possible reading for a guard who cannot find the
    // person they are filing about.
    error: residentsError ?? usersError ?? null,
  }
}

export default useResidentAddresses
