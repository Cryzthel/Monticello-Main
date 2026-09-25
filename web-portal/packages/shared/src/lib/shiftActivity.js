// Pure derivation of "what one guard did during one shift" from the incident
// documents themselves. No Firestore, no auth, no imports — see shifts.js for
// the reads and writes that produce the data this interprets.
/**
 * Everything a guard did during one shift.
 *
 * Derived from the incident documents rather than logged separately: each
 * incident already records who acted on it and when, so the shift window plus
 * those stamps IS the activity record. A parallel activity log could silently
 * disagree with the incidents it claims to describe.
 *
 * An open shift is treated as running to now, so the drawer works mid-shift.
 *
 * ── WHY RESOLUTIONS LOOKED LIKE A SYNC BUG ─────────────────────────────────
 *
 * Both lists used to test `assignedGuardUid`, and for dispatches that is
 * exactly right — assignment IS the dispatch, stamped in the same write. For
 * resolutions it was wrong, and wrong in a way that looked like a stale feed:
 * the record updates live (both collections are onSnapshot subscriptions), so
 * a resolution that failed this predicate did not appear late, it never
 * appeared, and refreshing the page did not summon it either.
 *
 * Two everyday cases it silently dropped:
 *
 *   1. Guard A dispatches on nights, guard B closes it in the morning. B is
 *      not the assignee, so it is absent from B's shift; A's window has since
 *      closed, so `inWindow(resolvedAt)` fails there too. The resolution
 *      belonged to no shift at all.
 *   2. A report resolved without ever being dispatched has an empty
 *      `assignedGuardUid`, which `mine()` rejects outright.
 *
 * A resolution is now attributed to whoever RESOLVED it. `resolvedBy` is
 * stamped by the Resolve stage (dispatchWorkflow.js); the fall back to `assignedGuardUid` is
 * for documents resolved before that field existed, which would otherwise
 * drop out of shift records that currently show them.
 */
export function shiftActivity(shift, incidents, { nextShiftStart } = {}) {
  if (!shift?.timeIn) return { dispatches: [], resolutions: [], handled: [], offShift: [] }

  const from = shift.timeIn.getTime()
  // ── AN OPEN SHIFT HAS NO CEILING ────────────────────────────────────────
  //
  // `Date.now()` was the upper bound here, and it is the second half of the
  // "resolved reports do not sync" bug — the half that survived stamping
  // `resolvedBy`.
  //
  // `resolvedAt` is a Firestore SERVER timestamp. `Date.now()` is the clock
  // on whichever machine happens to be rendering this — the admin's, not the
  // guard's and not the server's. Comparing the two means an admin whose
  // workstation lags the server by a few seconds computes a window that ends
  // BEFORE the resolution it is meant to contain, so the row is filtered out
  // at exactly the moment it arrives. It then reappears only once local time
  // passes the stamp AND something re-renders, which for a quiet console can
  // be minutes — indistinguishable from a dead subscription, and 'fixed' by
  // a refresh, because reloading re-reads the clock.
  //
  // Clock skew of a second or two is normal; on a machine without NTP it is
  // routine. No amount of it should decide whether a shift record is correct.
  //
  // Infinity is also the honest bound: an OPEN shift has not ended, so
  // everything from clock-in onward belongs to it. Once the guard clocks out,
  // `timeOut` is itself a server timestamp and the comparison is
  // server-to-server, which is what `from` has always been.
  const to = shift.timeOut ? shift.timeOut.getTime() : Infinity
  const inWindow = (date) => {
    if (!date) return false
    const ms = new Date(date).getTime()
    return ms >= from && ms <= to
  }
  const mine = (uid) => Boolean(uid) && uid === shift.guardUid

  // `||`, not `??`: `resolvedBy` is written as '' when the actor is unknown,
  // and an empty string is not nullish — it would win the coalesce and defeat
  // the legacy fallback entirely.
  const resolverOf = (i) => i.resolvedBy || i.assignedGuardUid

  const dispatches = incidents.filter(
    (i) => mine(i.assignedGuardUid) && inWindow(i.dispatchedAt),
  )
  const resolutions = incidents.filter(
    (i) => mine(resolverOf(i)) && inWindow(i.resolvedAt),
  )

  // ── WORK DONE WHILE CLOCKED OUT ─────────────────────────────────────────
  //
  // A shift record shows what happened between clock-in and clock-out, which
  // is correct and is not the whole story. A guard who closes a ticket after
  // clocking out produces a real event that belonged to no shift at all: the
  // window that just ended excludes it, the next one has not started, and so
  // it appeared nowhere in the admin portal. Silently discarding a resolution
  // is indistinguishable, from the admin's side, from the feed being broken —
  // and it is how a genuine action disappears from the audit record.
  //
  // The gap is owned by the shift that PRECEDES it: everything after this
  // clock-out up to the guard's next clock-in (or now, if they have not
  // returned). Each gap therefore belongs to exactly one shift, so nothing is
  // listed twice across a guard's history.
  //
  // Kept out of `dispatches`/`resolutions` deliberately. Those two lists mean
  // "during this shift" and folding off-shift work into them would make the
  // timesheet lie. The drawer renders this separately and says what it is.
  const gapFrom = shift.timeOut ? shift.timeOut.getTime() : null
  const gapTo = nextShiftStart ? new Date(nextShiftStart).getTime() : Infinity
  const inGap = (date) => {
    if (gapFrom == null || !date) return false
    const ms = new Date(date).getTime()
    return ms > gapFrom && ms <= gapTo
  }

  const offShift = incidents
    .map((i) => {
      // Resolution wins the label when both fall in the gap — closing a
      // ticket is the later and more consequential of the two.
      if (mine(resolverOf(i)) && inGap(i.resolvedAt)) {
        return { incident: i, at: i.resolvedAt, kind: 'resolved' }
      }
      if (mine(i.assignedGuardUid) && inGap(i.dispatchedAt)) {
        return { incident: i, at: i.dispatchedAt, kind: 'dispatched' }
      }
      return null
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  // Distinct incidents touched during the shift — the headline "handled"
  // count. Off-shift work is NOT counted here: this figure sits beside
  // "time in" and "time out" and has to mean the same span they do.
  //
  // Annotations no longer contribute. They used to, while the drawer also
  // listed them; with the "Reports annotated" section removed, counting them
  // here would leave an admin a total they cannot reconcile against anything
  // on screen. Every number in the panel is now backed by a list beneath it.
  const handled = [...new Map(
    [...dispatches, ...resolutions].map((i) => [i.id, i]),
  ).values()]

  return { dispatches, resolutions, handled, offShift }
}
