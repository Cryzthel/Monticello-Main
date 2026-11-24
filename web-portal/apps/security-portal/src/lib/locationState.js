/**
 * What this device's location situation IS, as one pure decision.
 *
 * ── WHY THIS IS NOT INLINE IN THE HOOK ANY MORE ────────────────────────────
 * Three surfaces now describe the same device — the shell banner, the toast,
 * and the GPS badge on the map — and this rule has been got wrong three times
 * in three different ways, each one shipping a console that contradicted
 * itself on screen:
 *
 *   1. The banner fell silent on `sharing`, the officer's INTENT to share,
 *      rather than on evidence. An officer who had never granted the
 *      permission saw nothing at all.
 *   2. `permission === 'denied'` outranked a delivered position, so a phone
 *      reporting "GPS locked · ±14 m" carried "Location is blocked" directly
 *      above it, both describing the same device in the same second.
 *   3. A stale `locationError` outranked a delivered position, for the beat
 *      between a failed reading and the stream recovering.
 *
 * All three are the same mistake: letting a REPORT ABOUT the stream outrank
 * the stream. A fix is not an opinion about whether permission was granted —
 * it is the permission being exercised. So the rule is stated once, in order,
 * with the position checked first, and it is tested.
 */

/**
 * @param {object}  input
 * @param {boolean} input.onDuty         Telemetry runs only on an open shift.
 * @param {boolean} input.supported      Does this browser have geolocation.
 * @param {string}  [input.permission]   navigator.permissions state, or null.
 * @param {string}  [input.locationError] 'location-denied' | 'no-fix' | null.
 * @param {object}  [input.fix]          The last position, or null.
 * @param {boolean} [input.everFixed]    Has a position EVER arrived this session.
 * @param {boolean} [input.overdue]      Has the first-fix grace period expired.
 *
 * @returns {'off'|'ok'|'prompt'|'denied'|'waiting'}
 */
export function locationState({
  onDuty,
  supported,
  permission = null,
  locationError = null,
  fix = null,
  everFixed = false,
  overdue = false,
}) {
  // Off duty is not a fault. Telemetry is gated on an open shift by design —
  // an officer who has clocked out is a private citizen, and a console that
  // reported on their location would be reporting something it must not have.
  if (!onDuty || !supported) return 'off'

  // THE POSITION COMES FIRST, and that ordering is the whole fix. Nothing
  // below gets to speak over a fix that exists.
  if (fix) return 'ok'

  /**
   * A denial is only believable from a device that has never located itself.
   *
   * `everFixed` latches for the session: once coordinates have arrived, the
   * permission was granted, whatever a registry says afterwards. A permission
   * genuinely revoked mid-shift stops the stream, and the officer learns that
   * from the absent `fix` above rather than from a record that may be stale,
   * answering for a tunnelled origin, or never updated after the user changed
   * it in a system sheet.
   */
  const denied =
    !everFixed && (permission === 'denied' || (permission !== 'granted' && locationError === 'location-denied'))
  if (denied) return 'denied'

  // Permission is in hand and no position has come back. There is no button
  // that helps; the device is trying. Said only once it has had long enough,
  // so a cold lock does not flash a problem on every load.
  if (permission === 'granted' || everFixed) return overdue || locationError ? 'waiting' : 'ok'

  // Never asked, or asked and not yet answered. The only state a press fixes.
  return 'prompt'
}
