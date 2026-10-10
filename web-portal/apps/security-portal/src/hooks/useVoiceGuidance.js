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
 * driver expects them and a unit sitting still says nothing new. Each
 * threshold fires ONCE per step — keyed by step index — so creeping back and
 * forth over 200m in traffic cannot make it repeat itself, which is the
 * failure that makes people mute navigation for good.
 *
 * ── WHICH STEP IT IS ON IS NOT THIS HOOK'S DECISION ─────────────────────────
 * Everything here keys off `progress.step.index`, and that index is now
 * physically gated: it does not advance until the unit has been within
 * WAYPOINT_RADIUS_M of the corner the current step ends at (see
 * `gateStepIndex`). So "stay locked on step one until step one is actually
 * completed" is enforced upstream, in pure tested code, rather than by this
 * hook second-guessing it — which matters, because a second opinion about
 * which step is current is how the card and the voice end up disagreeing.
 *
 * ── NOTHING IS SPOKEN UNTIL SOMEBODY ASKS ───────────────────────────────────
 * Browsers refuse speechSynthesis until a user gesture, and they are right to:
 * a console that started talking on page load, on a shared machine, at night,
 * would be turned off and never turned back on. `enabled` is switched by
 * Start Navigation, so the first utterance is always downstream of a click.
 */

/** Metres before a maneuver at which to speak. Descending, coarse to fine. */
const THRESHOLDS = [400, 200, 60]

/** Inside this, the instruction is "now" rather than "in N metres". */
const IMMINENT_M = 25

/** How close counts as arrived, on the last step. */
const ARRIVED_M = 30

/**
 * ── THE REPEAT, AND WHY IT IS BOUNDED ──────────────────────────────────────
 *
 * A unit that has not moved has heard its instruction once, possibly while
 * still parking, possibly over a slammed door. The distance thresholds above
 * will not fire again — they are keyed per step and the distance has not
 * changed — so without this the console says one sentence and then goes quiet
 * for as long as the officer sits there.
 *
 * ── THE CAP IS GONE, BECAUSE THE BUTTON IS GONE ───────────────────────────
 * This was capped at three repeats per step, and the cap was defensible only
 * while a Repeat button existed: an officer who needed a fourth could ask for
 * it. That button has been removed — the automated repeat is now the entire
 * mechanism — so a cap would mean an officer who missed the first three
 * prompts has no way at all to hear the instruction again, which is the exact
 * situation the repeat exists for.
 *
 * So it continues for as long as the step does not change, which is precisely
 * "stationary, or has not yet reached the turn". A unit that is driving never
 * hears a repeat at all, because reaching the corner starts a new step.
 *
 * WHAT STOPS IT, since nothing else does now: the session. Spoken guidance
 * only runs while `enabled`, Exit navigation clears that, and the route going
 * away clears it too. A console left talking is a console somebody left
 * navigating, with a red button on screen to end it — which is a different
 * and much more visible state than the silent-forever one a cap produces.
 *
 * Arrival also stops it: once the last step is reached the hook falls into
 * the `@arrived` branch, which speaks once and is keyed like every other
 * prompt.
 */
const REPEAT_MS = 30_000

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

/**
 * Returns nothing. It briefly handed out a `repeat()` for the panel's Repeat
 * button; that button is gone and the timer below covers what it was for.
 */
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

  /**
   * What the repeat timer and the Repeat button both say.
   *
   * A ref rather than a dependency, because the alternative is re-arming a
   * 30-second interval on every telemetry fix — which, since the fixes arrive
   * faster than the interval, means it never fires at all. The classic
   * version of this bug looks like a feature that simply does nothing.
   */
  const phraseRef = useRef(null)

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

    // Kept current for the repeat timer and the button, whether or not
    // anything is spoken on this fix.
    phraseRef.current =
      distanceToManeuver > IMMINENT_M
        ? `In ${formatDistance(distanceToManeuver)}, ${instruction}`
        : instruction

    /**
     * THE PROMPT RIGHT AFTER A TURN.
     *
     * Crossing into a new step means the maneuver just happened — and now
     * means it for real, because the index only moves once the unit has
     * physically been at that corner. The driver is mid-junction, has stopped
     * thinking about the turn they are completing, and the useful thing to
     * hear is what comes next — not silence until they are 400m from it,
     * which on a short subdivision road can be the whole leg.
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

  /**
   * The repeat interval, re-armed on each STEP rather than on each fix.
   *
   * `progress?.step?.index` as the dependency and not `progress`: telemetry
   * lands every few seconds, so depending on the whole object would tear this
   * timer down and rebuild it before it ever reached 30 seconds. The interval
   * therefore belongs to the step, which is exactly the thing it is repeating.
   */
  const stepIndex = progress?.step?.index ?? null
  useEffect(() => {
    if (!enabled || stepIndex == null) return undefined
    const id = setInterval(() => {
      // Never talk over a prompt already in flight: if the synth is
      // mid-sentence this tick simply passes, which also means a slow device
      // cannot build a backlog of identical instructions.
      if (window.speechSynthesis?.speaking) return
      const phrase = phraseRef.current
      if (phrase) speak(phrase)
    }, REPEAT_MS)
    return () => clearInterval(id)
  }, [enabled, stepIndex, routeKey])
}
