/**
 * The shift vocabulary, for both portals.
 *
 * ── WHY THIS MOVED ─────────────────────────────────────────────────────────
 * These three lived in `apps/admin-portal/src/lib/securityAccounts.js`, which
 * was correct while a shift was something an ADMIN assigned to an account. It
 * is not any more: a guard picks their shift at clock-in, so the guardhouse
 * needs the same list — and the guardhouse cannot import from the admin app.
 * One list in `@shared` is what keeps the clock-in control and the admin's
 * shift history naming the same three things. `securityAccounts.js` re-exports
 * from here, so every existing import still resolves.
 *
 * Each option carries the clock window because a guardhouse roster is a human
 * artefact: "Night shift · 22:00–06:00" is what is pinned on the wall, and a
 * portal that renders "shift_3" instead is asking an operator to translate.
 */
export const SHIFTS = [
  { value: 'morning', label: 'Morning shift', window: '06:00 – 14:00', startHour: 6, endHour: 14 },
  { value: 'evening', label: 'Evening shift', window: '14:00 – 22:00', startHour: 14, endHour: 22 },
  { value: 'night', label: 'Night shift', window: '22:00 – 06:00', startHour: 22, endHour: 6 },
]

export const SHIFT_BY_VALUE = Object.fromEntries(SHIFTS.map((s) => [s.value, s]))

/**
 * The shift whose window contains `date` — the sensible default for a guard
 * clocking in right now.
 *
 * It is a DEFAULT and never a constraint. A guard arriving ten minutes early,
 * relieving someone late, or covering a double would otherwise be forced to
 * file their shift under the wrong name, and the timesheet an admin audits is
 * worth more than the convenience of not having a control. The clock-in picker
 * seeds itself with this and then gets out of the way.
 *
 * Night wraps midnight, which is why it is tested by exclusion rather than by
 * the same `start <= h < end` the other two use.
 */
export function shiftForTime(date = new Date()) {
  const hour = date.getHours()
  const match = SHIFTS.find((s) => s.startHour < s.endHour && hour >= s.startHour && hour < s.endHour)
  return (match ?? SHIFTS.find((s) => s.startHour > s.endHour) ?? SHIFTS[0]).value
}

/**
 * Elapsed time as HH:MM:SS, for a counter that ticks.
 *
 * Zero-padded and fixed-width on purpose: a timer whose digits change width
 * makes the text beside it jump once a second, which is the kind of motion a
 * console full of live data should never spend. `tabular-nums` at the call
 * site does the rest.
 *
 * Hours are NOT capped at 24. A guard covering a double should see 26:14:03
 * rather than a counter that silently wrapped to 02:14:03 — the timesheet this
 * mirrors bills the real number.
 */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** The same span in the compact prose form a status pill wants: "6h 42m". */
export function formatElapsedShort(ms) {
  const total = Math.max(0, Math.floor(ms / 60000))
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`
}
