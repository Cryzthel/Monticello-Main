import { useEffect, useRef } from 'react'
import { formatDistance } from '@/lib/directions'

/**
 * Speaks the turn-by-turn instructions aloud.
 *
 * ── WHY THIS IS WORTH HAVING ON A GUARDHOUSE CONSOLE ────────────────────────
 * The one moment an officer most needs the next turn is the one moment they
 * must not be reading a screen. Inside a gated subdivision a wrong turn is a
 * locked back gate and four minutes, and the map is on a laptop on the
 * passenger seat. Saying it out loud is the only delivery that works while
 * driving.
 *
 * ── IT ANNOUNCES AT DISTANCES, NOT ON A TIMER ───────────────────────────────
 * Thresholds are metres before the maneuver, so the prompts land where a
 * driver expects them and a unit sitting still says nothing. Each threshold
 * fires ONCE per step — keyed by step index — so creeping back and forth over
 * 200m in traffic cannot make it repeat itself, which is the failure that
 * makes people mute navigation for good.
 *
 * ── NOTHING IS SPOKEN UNTIL SOMEBODY ASKS ───────────────────────────────────
 * Browsers refuse speechSynthesis until a user gesture, and they are right to:
 * a console that started talking on page load, on a shared machine, at night,
 * would be turned off and never turned back on. `enabled` comes from a toggle,
 * so the first utterance is always downstream of a click.
 */

/** Metres before a maneuver at which to speak. Descending, coarse to fine. */
const THRESHOLDS = [400, 200, 60]

/** Inside this, the instruction is "now" rather than "in N metres". */
const IMMINENT_M = 25

/** How close counts as arrived, on the last step. */
const ARRIVED_M = 30

function speak(text) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  if (!synth) return
  // Cancel first: a queued prompt that arrives after the turn it describes is
  // worse than silence, and these are seconds apart by design.
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.05
  utterance.volume = 1
  synth.speak(utterance)
}

export function useVoiceGuidance(progress, { enabled, routeKey }) {
  // Which prompts have already been spoken, as `${stepIndex}@${threshold}`.
  const spokenRef = useRef(new Set())
  const lastRouteRef = useRef(routeKey)

  // The step the last prompt was about, so a change of step reads as "a turn
  // was just taken" rather than being inferred from distance.
  //
  // Declared HERE, above the route-change reset below, and not beside the
  // effect that reads it: the reset runs during render, so a `const` declared
  // further down is still in its temporal dead zone and touching it throws.
  // The build does not catch that — it is a runtime ReferenceError on the
  // first route change.
  const lastIndexRef = useRef(null)

  // A new route is a new set of instructions; the old ones must be sayable
  // again. Clearing on routeKey rather than on every render is what stops a
  // re-render re-announcing the turn the officer just took.
  if (lastRouteRef.current !== routeKey) {
    lastRouteRef.current = routeKey
    spokenRef.current = new Set()
    lastIndexRef.current = null
  }

  useEffect(() => {
    if (!enabled) {
      window.speechSynthesis?.cancel()
    }
  }, [enabled])

  // Stop talking when the component goes away — a drawer closing mid-sentence
  // should not finish the sentence.
  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  useEffect(() => {
    if (!enabled || !progress?.step) return

    const { index, upcoming, distanceToManeuver, isLast } = progress.step
    const instruction = upcoming?.instruction
    if (!instruction) return

    const spoken = spokenRef.current

    /**
     * THE PROMPT RIGHT AFTER A TURN.
     *
     * Crossing into a new step means the maneuver just happened. The driver is
     * mid-junction, has stopped thinking about the turn they are completing,
     * and the useful thing to hear is what comes next — not silence until they
     * are 400m from it, which on a short subdivision road can be the whole leg.
     *
     * Only when the next maneuver is far enough away to be worth previewing.
     * Inside the top threshold the distance prompt below is about to fire
     * anyway, and hearing the same instruction twice in three seconds is how a
     * driver learns to stop listening.
     */
    const previous = lastIndexRef.current
    lastIndexRef.current = index
    if (previous != null && index > previous && distanceToManeuver > THRESHOLDS[0] && !isLast) {
      const key = `${index}@next`
      if (!spoken.has(key)) {
        spoken.add(key)
        speak(`Next, ${instruction}`)
        return
      }
    }

    if (isLast && progress.remainingM != null && progress.remainingM <= ARRIVED_M) {
      const key = `${index}@arrived`
      if (!spoken.has(key)) {
        spoken.add(key)
        speak('You have arrived.')
      }
      return
    }

    if (distanceToManeuver <= IMMINENT_M) {
      const key = `${index}@now`
      if (!spoken.has(key)) {
        spoken.add(key)
        speak(instruction)
      }
      return
    }

    // The tightest threshold the unit has already passed, so arriving at 180m
    // from a bad fix announces 200 and not 400 as well.
    const due = THRESHOLDS.find((t) => distanceToManeuver <= t)
    if (due == null) return

    const key = `${index}@${due}`
    if (spoken.has(key)) return
    spoken.add(key)
    speak(`In ${formatDistance(distanceToManeuver)}, ${instruction}`)
  }, [enabled, progress])
}
