import { useEffect, useRef, useState } from 'react'
import { OFF_ROUTE_METERS } from '@/lib/routeProgress'

/**
 * Has the unit been off the plotted route long enough to say so?
 *
 * ── WHY A DISTANCE THRESHOLD ALONE WAS NOT ENOUGH ──────────────────────────
 * `isOffRoute` answers the instantaneous question — is this fix further than
 * OFF_ROUTE_METERS from the line — and it is correct. It was also being
 * rendered directly, which made the console's off-route warning a function of
 * a single GPS sample.
 *
 * A phone's fix inside a built-up subdivision does not sit still. It walks
 * twenty to thirty metres between readings while the handset is on a
 * passenger seat going nowhere, which is exactly the magnitude of the
 * threshold. So a unit driving correctly down the plotted road would throw a
 * warning, clear it on the next fix, and throw it again a few seconds later —
 * an amber banner blinking on and off at an officer who is doing nothing
 * wrong. That teaches them to ignore the banner, which costs the one time it
 * is true.
 *
 * ── WHAT THE TIME BUFFER ACTUALLY BUYS ─────────────────────────────────────
 * Drift is uncorrelated between samples and a wrong turn is not. A fix that
 * strays because of noise is back inside the corridor within a reading or
 * two; a unit that has actually left the route stays out and gets further
 * away. Requiring the condition to HOLD turns a measurement that cannot
 * distinguish them into one that can, without touching the distance at all.
 *
 * Five seconds, which at patrol speed is 30-60 m of travel — far enough to
 * confirm a departure, short enough that the warning still arrives while the
 * officer can act on it.
 *
 * ── THE RECOVERY IS INSTANT, AND THAT ASYMMETRY IS DELIBERATE ──────────────
 * Coming back onto the route clears the state on the very next fix, with no
 * countdown. The two errors are not equally expensive: a warning that lingers
 * after an officer has rejoined is the console being wrong about the present,
 * while a warning that is slow to appear is only the console being careful.
 */
export const OFF_ROUTE_SUSTAIN_MS = 5000

/**
 * @param {null | { offsetM: number }} progress
 * @returns {boolean} true only once the unit has been beyond the threshold
 *   continuously for OFF_ROUTE_SUSTAIN_MS.
 */
export function useOffRoute(progress, { sustainMs = OFF_ROUTE_SUSTAIN_MS } = {}) {
  const [off, setOff] = useState(false)

  // The instant reading, mirrored so the timer below can re-check it when it
  // fires rather than closing over the value it was armed with.
  const strayingRef = useRef(false)
  const straying = Boolean(progress) && progress.offsetM > OFF_ROUTE_METERS
  strayingRef.current = straying

  useEffect(() => {
    if (!straying) {
      // Back on the line, or no fix at all. Either way there is nothing to
      // warn about, and the pending timer must not fire into a cleared state.
      setOff(false)
      return undefined
    }
    if (off) return undefined

    /**
     * A TIMER, not a count of consecutive fixes.
     *
     * Fixes arrive on a cadence this hook does not control and cannot see —
     * the telemetry interval is configurable, a stationary device heartbeats
     * more slowly than a moving one, and the simulator produces them at a
     * different rate again. "Three readings in a row" would therefore mean
     * anything from one second to a minute depending on circumstances nobody
     * reading this code would think to check. Five seconds is five seconds.
     */
    const id = setTimeout(() => {
      if (strayingRef.current) setOff(true)
    }, sustainMs)
    return () => clearTimeout(id)
  }, [straying, off, sustainMs])

  return off
}
