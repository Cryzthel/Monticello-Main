import { useEffect, useRef } from 'react'
import { loopAlert } from '@shared/lib/alertSound'
import { panicSirenStep } from '@shared/lib/panicSiren'
import { getSettings } from '@shared/lib/systemSettingsStore'
import { effectiveSirenVolume, loadGuardPrefs } from '@/lib/guardPrefs'

/**
 * Sounds the alarm when a panic alert arrives.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 * `alertSound.js` has carried a `critical` pattern — three rising pulses,
 * written for exactly this — since it was added, and nothing ever played it on
 * a panic event. `useIncidentAlerts` fires it, but that hook watches
 * `incidents`; the SOS button writes to `panic_alerts`, a different collection
 * it never subscribes to. So the loudest signature in the system was reserved
 * for a high-priority *report*, and an actual panic button press made no sound
 * at all.
 *
 * With the floating banner removed, sound is now half of how a guard learns an
 * SOS exists — the other half being the node on the map. That makes this the
 * load-bearing part of the alert, not a flourish.
 *
 * ── WHY IT TAKES ALERTS RATHER THAN OPENING ITS OWN LISTENER ───────────────
 * The dispatch page already subscribes to `panic_alerts` to draw the map layer.
 * A second `onSnapshot` on the same query would be a duplicate listener, a
 * duplicate read bill, and — worse — a second source of truth that can disagree
 * with the map about which alerts exist. This derives from the array the map is
 * already rendering, so the sound and the node can never diverge.
 *
 * ── WHERE THE RULES LIVE ───────────────────────────────────────────────────
 * In `panicSirenStep`, not here: silence on first paint, one alarm per batch,
 * and ringing again for a reopened alert are decisions worth testing, and
 * everything in this file is a ref and an effect around them.
 */
/**
 * @param {Array} alerts The live panic alerts.
 * @param {{ready?: boolean, muted?: boolean}} [options] `ready` is false while
 *   the subscription is still loading — without it this cannot tell an
 *   unloaded placeholder from a genuinely quiet console, and sounds the alarm
 *   on page open (see panicSirenStep). `muted` is the operator's own explicit
 *   silence, which stops the loop without touching any alert's status: the
 *   emergency is still on screen and still unresolved, the room is just quiet.
 */
export function usePanicSiren(alerts, { ready = true, muted = false } = {}) {
  // Ids already announced. Not state — changing it must never itself cause a
  // render, and nothing displays it.
  const announced = useRef(null)

  const count = (alerts ?? []).length

  /**
   * ── THE ALARM NOW HOLDS, RATHER THAN ANNOUNCING ─────────────────────────
   *
   * This used to play one wail per batch of new alerts and then fall silent.
   * That is the right shape for a NOTIFICATION — something happened, look at
   * your screen — and the wrong one for an emergency that is still happening:
   * a guard who was away from the desk for the one 2.6-second wail had no
   * second chance, and a console with four unattended SOS alerts on it sounded
   * exactly like a console with none.
   *
   * So the siren is now a function of STATE rather than of events. It sounds
   * for as long as there is an unresolved alert and stops when the last one
   * clears — which, because the subscription filters on
   * `status in ('active','acknowledged')`, happens the moment dispatch marks
   * the last one resolved, on every console at once.
   *
   * `announced` survives for one job the loop cannot do: the first wail of a
   * NEW alert must not wait for the current one to finish its gap. Arriving
   * alerts restart the loop so the sound changes at the moment the queue does.
   */
  const everyId = (alerts ?? []).map((alert) => alert.id).join('|')

  useEffect(() => {
    const ids = (alerts ?? []).map((alert) => alert.id)
    const { seen } = panicSirenStep(announced.current, ids, ready)
    announced.current = seen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyId, ready])

  /**
   * ── THE ALARM IS ON OR OFF; IT DOES NOT RE-ANNOUNCE ─────────────────────
   *
   * This keyed on `everyId` — the set of alert ids — so that a NEW alert got a
   * fresh wail immediately rather than waiting out the current gap. That was
   * the double-ringtone bug.
   *
   * Changing the key tore the loop down and started a new one, and a 2.6s
   * siren was usually still sounding when that happened: the old `stop` only
   * cancelled the timer, so the new wail landed on top of the old one at
   * double gain. Two alerts arriving in quick succession is one Firestore
   * snapshot each, which is exactly how an SOS burst arrives.
   *
   * It was also solving a problem that no longer exists. The siren HOLDS now
   * rather than announcing, so when a second alert arrives the alarm is
   * already sounding — there is nothing to re-announce, and the only honest
   * change is to the count on the rail. A boolean is the whole dependency: is
   * there anything unresolved, or not.
   *
   * `stopAlerts` in the module makes the stacking impossible as well, but this
   * is the half that means it never gets attempted.
   */
  const hasAlerts = count > 0

  useEffect(() => {
    // `ready` keeps this silent while the subscription is still loading:
    // without it the hook would ring on the empty placeholder array and then
    // again on the first real snapshot. See panicSirenStep.
    if (!ready || !hasAlerts || muted) return undefined

    // Admin › Settings › Emergency sound alerts, read at the moment the alarm
    // starts. Off silences only the siren — the rail and the map node still
    // show every alert.
    const settings = getSettings()
    if (!settings.sos.sirenEnabled) return undefined

    // This officer's own level when they set one (Settings), else the
    // console-wide level an administrator chose.
    return loopAlert('panic', { volume: effectiveSirenVolume(loadGuardPrefs(), settings.guardhouse.sirenVolume) })
  }, [hasAlerts, ready, muted])
}
