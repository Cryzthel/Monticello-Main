import {
  addDoc,
  collection,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'

// Guard shift log — the timesheet behind the admin "Security On-Duty History"
// table. One document per shift: created on clock-in with `timeOut: null`, then
// closed on clock-out.
//
// `timeOut: null` (rather than an absent field) is load-bearing: firestore.rules
// permits an update only while `resource.data.timeOut == null`, which is what
// stops a guard rewriting a shift after it has ended. An absent field would not
// satisfy that comparison.

export function mapShiftDoc(d) {
  const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null)
  const timeIn = toDate(d.timeIn)
  const timeOut = toDate(d.timeOut)

  return {
    id: d.id,
    guardUid: d.guardUid ?? '',
    name: d.name || d.email || 'Unknown guard',
    email: d.email ?? '',
    role: d.role ?? '',
    /**
     * Which of the three shifts this is, as the officer picked it at clock-in.
     *
     * This mapper is the only way a reader sees a shift document, so a field
     * written but not mapped here is a field that does not exist as far as
     * every consumer is concerned — which is exactly what happened when
     * `shift` was first written: the duty panel and the clock-out summary both
     * read `undefined` and quietly fell back to the word "Shift".
     */
    shift: d.shift ?? '',
    /**
     * Where the officer stood at each end of the shift: `{ lat, lng, accuracy,
     * capturedAt, source }`, or null when the device could not produce a fix.
     *
     * Null is a real answer here and is kept as one. A shift opened with
     * location blocked is a different fact from a shift opened before
     * positions were recorded at all, and flattening both to "no coordinate"
     * would lose the distinction an audit actually asks about.
     */
    clockInLocation: d.clockInLocation ?? null,
    clockOutLocation: d.clockOutLocation ?? null,
    timeIn,
    timeOut,
    open: Boolean(timeIn) && !timeOut,
    /**
     * The officer's own account of the shift, written at clock-out.
     *
     * Deliberately separate from `shiftActivity`, which DERIVES what happened
     * from the incident documents. Derivation can say a call was dispatched
     * and resolved; it cannot say the gate motor is sticking, or that the
     * resident at Block 7 is expecting a contractor at six. That is what a
     * handover is for, and it is the half no query can reconstruct.
     */
    handover: d.handover && typeof d.handover === 'object'
      ? {
          summary: String(d.handover.summary ?? ''),
          outstanding: String(d.handover.outstanding ?? ''),
          filedAt: toDate(d.handover.filedAt),
        }
      : null,
    // Minutes on duty. An open shift is measured to "now" so the table shows a
    // running duration rather than a blank.
    durationMinutes:
      timeIn ? ((timeOut ? timeOut.getTime() : Date.now()) - timeIn.getTime()) / 60000 : null,
  }
}

/**
 * Opens a shift for the signed-in guard.
 *
 * `shift` is which of the three the guard is working, chosen on the clock-in
 * lock. It is written at CREATE, which the rules allow freely — but note that
 * the UPDATE rule whitelists keys with `hasOnly`, so 'shift' had to be added
 * there too or clock-out would start failing the moment this field existed.
 */
export async function clockIn({ name, email, role, shift, location = null } = {}) {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in.')

  const ref = await addDoc(collection(db, 'guard_shifts'), {
    guardUid: user.uid,
    name: name || user.displayName || user.email || 'Guard',
    email: email || user.email || '',
    role: role ?? '',
    shift: shift ?? '',
    // Where the officer stood when the shift opened. A MAP, not four flat
    // fields: the clock-out rule whitelists top-level keys, and one key is
    // one entry to keep in step there rather than four.
    //
    // Null when the device could not produce a fix. Deliberately stored as
    // null rather than omitted — an absent field is indistinguishable from a
    // shift opened before this was captured at all, and an auditor asking
    // "was a position taken" deserves an answer either way.
    clockInLocation: location ?? null,
    timeIn: serverTimestamp(),
    // Explicit null, not omitted — see the note above about the update rule.
    timeOut: null,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Closes an open shift, optionally with the officer's handover.
 *
 * ONE WRITE, not two. The handover and the clock-out are the same act, and
 * splitting them would leave a shift that is closed with no log — or worse, a
 * log attached to a shift that never closed because the second write failed.
 * The rules only accept an update while `timeOut` is still null, so this is
 * also the last moment the officer can write to their own shift at all.
 *
 * @param {string} shiftId
 * @param {{ summary: string, outstanding?: string }} [handover]
 */
export async function clockOut(shiftId, handover = null, { location = null } = {}) {
  const patch = { timeOut: serverTimestamp(), clockOutLocation: location ?? null }

  if (handover) {
    const summary = String(handover.summary ?? '').trim().slice(0, 1000)
    const outstanding = String(handover.outstanding ?? '').trim().slice(0, 1000)
    // An empty log is not a log. Writing `handover: {}` would make an
    // un-filed shift indistinguishable from one filed with nothing to say.
    if (summary || outstanding) {
      patch.handover = { summary, outstanding, filedAt: serverTimestamp() }
    }
  }

  await updateDoc(doc(db, 'guard_shifts', shiftId), patch)
}

// Re-exported, not re-implemented. `shiftActivity` derives a shift record from
// incident documents and touches no I/O — it lives beside nothing but itself
// so it can be run without initialising Firebase. This module keeps the writes.
export { shiftActivity } from '@shared/lib/shiftActivity'
