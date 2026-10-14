import { LocateFixed, LocateOff, Loader2 } from '@shared/icons'

/**
 * Whether this device knows where it is, stated on the map itself.
 *
 * ── WHY THE CONSOLE SHOULD SAY THIS OUT LOUD ───────────────────────────────
 * Everything else on this page reports a position only by DRAWING one. A dot
 * on the map is the same picture whether it came from a 6 m satellite lock or
 * a 40 m access-point scan, and the absence of a dot is the same picture
 * whether the permission was refused, the shift is closed, or the chip is
 * still warming up. An officer comparing their laptop against their phone —
 * which is how this bug was found — had nothing to compare except two dots in
 * different places.
 *
 * So the one fact that distinguishes those cases gets said in words: the
 * accuracy radius the browser itself reported.
 *
 * ── IT PRINTS THE NUMBER, NOT A VERDICT ────────────────────────────────────
 * "GPS Locked (High Accuracy)" was the brief's wording and it is nearly right.
 * What it leaves out is the number, which is the part that settles an
 * argument: ±8 m and ±95 m are both "locked", both draw an identical dot, and
 * only one of them can tell you which side of a street somebody is on. The
 * badge therefore reads `GPS locked · ±8 m` — the verdict for the glance, the
 * radius for the question the glance provokes.
 *
 * ── AND IT IS QUIET WHEN THINGS ARE FINE ───────────────────────────────────
 * A console that shouts about working hardware trains people to stop reading
 * it. Locked is a hairline chip in secondary text; only the states that need
 * acting on take a colour. Nothing here is a control — the thing to press
 * when location is off is the banner and the toast, which say so in words and
 * carry the button (see LocationAccessToast).
 */

/**
 * Metres. At or under this the fix came from real positioning hardware and is
 * good enough to place somebody on a street; above it, the browser is
 * answering from something coarser and the badge says so rather than claiming
 * a lock it does not have.
 *
 * The same 100 m the rest of the console uses to mean "approximate" — see
 * `GPS_ACCURACY_LIMIT_M`. Imported rather than repeated so this badge and the
 * unit list cannot end up disagreeing about what a good fix is.
 */
import { GPS_ACCURACY_LIMIT_M } from '@/lib/routeOrigin'

export default function GpsLockBadge({ mode, locationError, fix }) {
  // Off duty is not a fault and not a state worth a chip: telemetry is gated
  // on an open shift by design, so there is nothing here to report on.
  if (mode === 'off') return null

  const accuracy = Number.isFinite(fix?.accuracy) ? Math.round(fix.accuracy) : null
  /**
   * ── A FIX IN HAND OUTRANKS A STALE ERROR ────────────────────────────────
   * `blocked` was `locationError === 'location-denied'` on its own, which let
   * one failed reading label a device that is, at this moment, delivering
   * coordinates. The stream recovering clears the error a beat later, so the
   * window is short — and a badge whose whole job is to say whether this
   * device knows where it is must not spend that window saying the opposite
   * of the dot on the map beside it.
   *
   * Same rule as `useLocationAccess`, stated the same way: the position is
   * the evidence, everything else is a report about it.
   */
  const blocked = !fix && locationError === 'location-denied'
  const locked = Boolean(fix)
  const precise = locked && (accuracy === null || accuracy <= GPS_ACCURACY_LIMIT_M)

  let Icon = Loader2
  let text = 'Finding your position…'
  let tone = 'text-text-secondary'
  let spin = true

  if (blocked) {
    Icon = LocateOff
    text = 'Location blocked'
    tone = 'text-warning'
    spin = false
  } else if (locked) {
    Icon = LocateFixed
    spin = false
    // The radius is the whole point, so it is only left off when the browser
    // genuinely did not supply one.
    /**
     * ── THE RADIUS, WITHOUT THE WORDS ───────────────────────────────────
     * The coarse branch read "Approximate position · ±400 m" and has been cut
     * to the number alone. Two words of prose above the route panel were
     * saying what the figure beside them already said, on the one strip of
     * screen a driver glances at — and "approximate" is a judgement the
     * reader can make faster from "±400 m" than from being told.
     *
     * The number stays, and so does the amber. Dropping the whole badge on a
     * coarse fix was the other option and it is worse: silence there would be
     * indistinguishable from a precise lock, which is exactly the confusion
     * between a laptop and a phone that this badge was added to settle.
     */
    text = precise
      ? `GPS locked${accuracy === null ? '' : ` · ±${accuracy} m`}`
      : `±${accuracy} m`
    tone = precise ? 'text-text-secondary' : 'text-warning'
  }

  return (
    <div
      // `pointer-events-none`: it sits over a draggable canvas and is a
      // readout, not a control, so a drag that starts on it must still pan
      // the map rather than dying on a chip.
      className="pointer-events-none inline-flex items-center gap-1.5 rounded-full border border-hairline bg-base-850/95 px-2.5 py-1 shadow-overlay"
      role="status"
      aria-live="polite"
    >
      <Icon
        size="sm"
        aria-hidden="true"
        className={`shrink-0 ${tone} ${spin ? 'animate-spin' : ''}`}
      />
      <span className={`whitespace-nowrap text-2xs font-medium tabular-nums ${tone}`}>{text}</span>
    </div>
  )
}
