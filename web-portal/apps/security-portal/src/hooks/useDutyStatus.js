import { useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { auth, db } from '@shared/lib/firebase'
import { useAuth } from '@shared/auth/AuthContext'
import { mapShiftDoc, clockIn, clockOut } from '@shared/lib/shifts'

/**
 * Whether the signed-in guard has an open shift, and the control to change it.
 *
 * ── WHY THIS IS A HOOK AND NOT JUST THE WIDGET'S STATE ─────────────────────
 * The open-shift query used to live inside GuardStatusWidget, which was fine
 * while the only thing that cared about duty was the badge showing it. It is
 * not fine now that the whole console is gated on it: the lock overlay, the
 * badge and the clock in/out button all need the same answer, and three copies
 * of the query would be three chances to disagree about whether a guard is on
 * duty at the moment they press something.
 *
 * The Firestore SDK de-duplicates identical listeners, so mounting this in more
 * than one component costs one subscription, not three.
 *
 * `loading` is a real third state and the reason it is returned separately: on
 * the first frame nothing has come back, and treating "not yet known" as "off
 * duty" would flash the lock screen at a guard who IS clocked in, every time
 * they open a page.
 */
export function useDutyStatus() {
  const { role } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const uid = auth.currentUser?.uid

  // Only this guard's own open shift. A single-field equality filter, so no
  // composite index is needed.
  const openShiftQuery = useMemo(
    () =>
      uid
        ? query(
            collection(db, 'guard_shifts'),
            where('guardUid', '==', uid),
            where('timeOut', '==', null),
          )
        : null,
    [uid],
  )

  const { data: rawOpen, loading } = useLiveCollection(openShiftQuery)
  const openShift = rawOpen.length ? mapShiftDoc(rawOpen[0]) : null

  /**
   * @param {{ summary: string, outstanding?: string }} [handover] Filed with
   *   the clock-out when the handover requirement is on. Ignored on clock-in.
   */
  async function toggle(handover = null) {
    setBusy(true)
    setError('')
    try {
      if (openShift) {
        await clockOut(openShift.id, handover)
      } else {
        await clockIn({
          name: auth.currentUser?.displayName || auth.currentUser?.email || 'Guard',
          email: auth.currentUser?.email || '',
          role: role ?? '',
        })
      }
    } catch (err) {
      setError(err.message ?? 'Could not update your shift.')
    } finally {
      setBusy(false)
    }
  }

  return {
    openShift,
    onDuty: Boolean(openShift),
    // Signed out is not "loading" — there is no shift to wait for.
    loading: Boolean(uid) && loading,
    busy,
    error,
    toggle,
  }
}
