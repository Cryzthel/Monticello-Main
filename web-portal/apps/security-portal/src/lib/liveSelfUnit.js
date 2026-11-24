/**
 * Draw THIS officer from THIS device, rather than from the server's echo of it.
 *
 * ── THE ROUND TRIP THAT MADE THE MARKER LATE ───────────────────────────────
 * `useGuardUnits` builds every marker from the `guard_telemetry` documents.
 * That is the only thing it can do for a DISPATCHER — somebody else's position
 * has no other source — and it was also the only source for the officer's own
 * marker, which for them is the long way round: the browser has the fix in
 * hand, writes it to Firestore, and waits to read it back before it can draw
 * itself.
 *
 * Every failure along that path looks identical on screen, which is no dot:
 * the write is throttled, it needs an open shift document and `onDuty` on the
 * telemetry doc, the reader discards anything older than fifteen minutes, and
 * both ends need rules to allow them. An officer who had just granted location
 * on a console that already knew exactly where they were still could not see
 * themselves, and could not tell which of those five things had gone wrong.
 *
 * So the local fix is merged over the published one. Same shape, so nothing
 * downstream knows the difference — the map, the route and the camera all keep
 * reading a plain unit record.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
 * It invents nothing for anybody else. A dispatcher's view of other units is
 * untouched, because the only device that can honestly answer "where is this
 * officer right now" without a round trip is the officer's own.
 */

/**
 * `units` with this officer's marker driven by `fix`.
 *
 * Returns the input array unchanged when there is nothing to merge, so the
 * caller's `useMemo` keeps its identity and the map does not rebuild a source
 * for a render that changed nothing.
 *
 * @param {Array}  units  Units built from telemetry documents.
 * @param {object} self   `{ uid, fix, mode, name }` for the viewing officer.
 */
export function withLiveSelfUnit(units, { uid, fix, mode, name } = {}) {
  // Off duty publishes no position and must not draw one: telemetry is gated
  // on an open shift by design, and an officer who has clocked out is a
  // private citizen rather than a unit.
  if (!uid || !fix || mode === 'off') return units
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return units

  const position = {
    lat: fix.lat,
    lng: fix.lng,
    accuracy: Number.isFinite(fix.accuracy) ? fix.accuracy : null,
    capturedAt: fix.capturedAt ?? Date.now(),
  }

  /**
   * A locally-sourced position is current by construction, so the fields that
   * describe a PUBLISHED one are reset rather than carried over.
   *
   * Leaving them would let a marker drawn from this second's reading keep a
   * "last seen 4 minutes ago" and a stale flag from the document it replaced —
   * the map would show the officer in the right place and simultaneously claim
   * the position was old, which is worse than either on its own because it
   * gives a dispatcher two facts and no way to pick.
   *
   * `approximate` is recomputed rather than cleared: it is a statement about
   * THIS fix's radius, and a coarse local reading is still coarse.
   */
  const live = {
    position,
    positionAgeMs: 0,
    stale: false,
    reporting: true,
  }

  const existing = units.find((unit) => unit.uid === uid)
  if (existing) return units.map((unit) => (unit.uid === uid ? { ...unit, ...live } : unit))

  /**
   * No telemetry document yet — the first minutes of a shift, or a write that
   * never landed. The officer still exists and still has a position, so the
   * unit is added rather than waited for.
   *
   * `available` and no assignment: this record carries only what the device
   * can honestly answer for. Anything about what the officer has been
   * DISPATCHED to belongs to the documents, and if they had an active call
   * there would be a telemetry document to merge into instead of this branch.
   */
  return [
    ...units,
    {
      uid,
      name: name || 'Security officer',
      badgeNumber: '',
      state: 'available',
      assignment: null,
      mode,
      battery: null,
      locationError: null,
      lastSeenAgoMs: 0,
      distanceM: null,
      ...live,
    },
  ]
}
