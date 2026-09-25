import { useMemo } from 'react'
import { useResidentAddresses } from '@shared/hooks/useResidentAddresses'
import { SUBDIVISION_PHASES } from '@shared/lib/subdivisionBoundary'

/**
 * Phase → Block → Lot, derived from addresses residents have actually
 * registered on the mobile app.
 *
 * THERE IS NO LOT PLAN IN THIS REPO. The boundary GeoJSON is a single
 * unsubdivided polygon with no per-lot features, and the mobile signup flow
 * stores phase/block/lot as free text. So a truly authoritative cascade —
 * "Phase 2 contains exactly blocks 1-14" — cannot be built from anything that
 * exists today; inventing one would put addresses in the dropdown that may not
 * be real and omit ones that are.
 *
 * What IS authoritative:
 *   • The phase list. SUBDIVISION_PHASES is the canonical set the boundary
 *     layer, the mobile map and the heatmap already colour by.
 *   • Every address a resident has registered, which is where incidents are
 *     actually filed.
 *
 * So the cascade offers real, known addresses and always permits a new one.
 * A guard attending a call at an unregistered lot must still be able to file
 * it — a dropdown that cannot express a real location is worse than a text
 * box, not better.
 *
 * ── A DENIED QUERY THAT WAS SILENTLY HALVING THIS ─────────────────────────
 * This hook used to subscribe to `residents` AND `properties`, merging both so
 * "a block that exists in either is offered". The second half never arrived.
 *
 * `properties/{userId}` is gated `allow read, write: if isOwner(userId)` in
 * firestore.rules — owner only, no staff clause — so a LIST of that collection
 * is denied for every member of staff, guards included. The listener resolved
 * to an empty array and its `error` was destructured away, so the failure had
 * no symptom: the cascade simply offered fewer blocks than it should have,
 * with nothing on screen or in the console to say why.
 *
 * `useResidentAddresses` replaces it with the two collections staff may
 * actually read, which the mobile app mirrors the same values into precisely
 * so that staff can. See the long note there.
 */

const norm = (value) => String(value ?? '').trim()

export function usePropertyDirectory() {
  const { residents, loading, error } = useResidentAddresses()

  return useMemo(() => {
    // phase -> Map(block -> Set(lot))
    const tree = new Map()

    residents.forEach(({ phase, block, lot }) => {
      const p = norm(phase)
      if (!p) return
      if (!tree.has(p)) tree.set(p, new Map())
      const blocks = tree.get(p)
      const b = norm(block)
      if (!b) return
      if (!blocks.has(b)) blocks.set(b, new Set())
      const l = norm(lot)
      if (l) blocks.get(b).add(l)
    })

    // Numeric-aware sort so Block 10 follows Block 9, not Block 1.
    const sortValues = (values) =>
      [...values].sort((a, b) => {
        const na = Number(a)
        const nb = Number(b)
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
        return String(a).localeCompare(String(b), undefined, { numeric: true })
      })

    // The phase list is the canonical one and is NOT merged with whatever the
    // data happens to hold. A phase with no residents yet is still real and
    // must be offerable; a phase that does not exist (a mis-keyed "4") must
    // not be, or the dropdown re-teaches the error every time it is opened.
    // AddressSelect's "enter manually" path remains the escape hatch.
    const phases = [...SUBDIVISION_PHASES]

    return {
      loading,
      error,
      phases,
      blocksFor: (phase) => sortValues(tree.get(norm(phase))?.keys() ?? []),
      lotsFor: (phase, block) => sortValues(tree.get(norm(phase))?.get(norm(block)) ?? []),
    }
  }, [residents, loading, error])
}

export default usePropertyDirectory
