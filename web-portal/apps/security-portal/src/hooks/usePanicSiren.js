import { useEffect, useRef } from 'react'
import { playAlert } from '@shared/lib/alertSound'
import { panicSirenStep } from '@shared/lib/panicSiren'
import { getSettings } from '@shared/lib/systemSettingsStore'

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
 * @param {{ready?: boolean}} [options] `ready` is false while the subscription
 *   is still loading. Without it this cannot tell an unloaded placeholder from
 *   a genuinely quiet console, and sounds the alarm on page open — see
 *   panicSirenStep.
 */
export function usePanicSiren(alerts, { ready = true } = {}) {
  // Ids already announced. Not state — changing it must never itself cause a
  // render, and nothing displays it.
  const announced = useRef(null)

  useEffect(() => {
    const ids = (alerts ?? []).map((alert) => alert.id)
    const { seen, ring } = panicSirenStep(announced.current, ids, ready)
    announced.current = seen
    // Admin › Settings › Emergency sound alerts. Read at the moment of ringing,
    // so a change applies to the next alert without a reload. Off silences
    // only the siren — the banner and the map node still show every alert.
    // Both halves come from the same settings snapshot: whether the siren
    // sounds at all, and how loud the console was told to be.
    const settings = getSettings()
    if (ring && settings.sos.sirenEnabled) {
      playAlert('panic', { volume: settings.guardhouse.sirenVolume })
    }
  }, [alerts, ready])
}
