import GuardStatusWidget from './GuardStatusWidget'

/**
 * Guard-specific extras slotted into AppShell's top bar. Notifications, search
 * and the profile menu are already provided by the shared DashboardLayout.
 *
 * ── WHAT WAS REMOVED, AND WHAT REPLACED IT ────────────────────────────────
 * A "Sound on / Muted / Enable sound" pill used to sit beside the duty widget.
 * It is gone: alert audio is simply ON by default now, and the browser's
 * autoplay gate is satisfied by `installGestureUnlock()` in
 * shared/lib/alertSound.js, which arms the audio context on the first click or
 * keypress anywhere in the console.
 *
 * That is the whole reason the button could be deleted rather than merely
 * hidden. Its visible job was muting — a preference almost nobody changed —
 * but its real job was BEING the user gesture the browser requires before a
 * page may make noise. Deleting it without replacing that gesture would have
 * left a guardhouse console silent for an entire shift with nothing on screen
 * saying so.
 *
 * Mute and a "Test sound" button remain on the Settings page, which is where a
 * once-a-month preference belongs. The header now carries only the indicator
 * that actually changes during a shift: on/off duty.
 */
export default function GuardHeaderActions() {
  return (
    <div className="flex items-center gap-3">
      <GuardStatusWidget />
    </div>
  )
}
