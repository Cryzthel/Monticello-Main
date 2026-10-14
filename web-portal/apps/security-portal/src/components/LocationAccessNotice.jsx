import { MapPinOff, Navigation } from '@shared/icons'
import { useLocationAccess } from '@/hooks/useLocationAccess'

/**
 * Tells the officer, on their own device, that dispatch cannot see them.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * `useGuardTelemetry` already streams a high-accuracy position and already
 * records why it failed — but its return value was discarded at the only place
 * it is mounted, so `location-denied` reached the DISPATCHER's unit list and
 * never reached the phone that was refusing. The officer's console looked
 * completely normal while they were invisible on the map their colleagues use
 * to send help, which is the one failure a guard must not have to infer.
 *
 * ── THE DECISION MOVED OUT, AND IT WAS WRONG WHILE IT LIVED HERE ───────────
 * Which state the device is in is now `useLocationAccess`, shared with the
 * toast. Two reasons, and the second is the important one.
 *
 * The first is that two surfaces reporting the same fact must not be able to
 * disagree about it.
 *
 * The second is that the version that lived here fell silent on
 * `sharing && !locationError && !denied`, and `sharing` is the officer's
 * INTENT to share rather than evidence of a position. An officer who had never
 * granted the permission — so no fix, and no error raised yet either — matched
 * that condition exactly, and this banner hid itself at the one moment it was
 * the only thing on screen that could have fixed the problem. See the long
 * note on `fix` in the hook.
 *
 * ── IT ASKS, IT DOES NOT NAG ────────────────────────────────────────────────
 * The browser only shows its permission sheet in response to a gesture, and
 * only once per origin until the user changes it — a page that calls
 * `getCurrentPosition` on load spends that one chance before the officer knows
 * what is being asked or why. So this explains first and puts the request
 * behind a button, and once the browser has been told "no" it stops asking and
 * says where the setting lives instead, because at that point only the browser
 * can undo it.
 *
 * ── ON DUTY ONLY ────────────────────────────────────────────────────────────
 * Nothing here runs off duty. Telemetry is gated on an open shift by design —
 * an officer who has clocked out is a private citizen, and a console that
 * asked for their location anyway would be asking for something it must not
 * have. That is also why this is a banner on the guard's own screen rather
 * than a blocking dialog: it reports a problem with a shift, not a wall.
 */
export default function LocationAccessNotice({ mode, locationError, fix }) {
  const { state, request, asking } = useLocationAccess({ mode, locationError, fix })

  // 'ok' is a position flowing; 'off' is off duty or a browser with no
  // geolocation at all. Neither is the officer's problem to see.
  if (state === 'ok' || state === 'off') return null

  const denied = state === 'denied'
  const waiting = state === 'waiting'

  const Icon = denied ? MapPinOff : Navigation

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-hairline bg-warning/10 px-4 py-2.5 text-caption text-text-primary"
    >
      <Icon size="sm" aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {denied
            ? 'Location is blocked — dispatch cannot see you'
            : waiting
              ? 'No GPS fix yet — dispatch cannot see you'
              : 'Turn on GPS so dispatch can route to you'}
        </p>
        <p className="mt-0.5 leading-snug text-text-secondary">
          {denied
            ? 'Allow location for this site in your browser settings, then reload. Until then you will not appear on the dispatch map and routes cannot be measured from your position.'
            : waiting
              ? 'Location is allowed and your device is still working on a fix. Step outside or into the open; the stream goes live on its own as soon as a position arrives.'
              : 'Allow location and your position goes live straight away. It is only shared while you are clocked in, and it is what lets the guardhouse send the nearest unit to a call.'}
        </p>
      </div>

      {!denied && !waiting ? (
        <button
          type="button"
          onClick={request}
          disabled={asking}
          className="btn btn-sm btn-outline shrink-0"
        >
          {asking ? 'Waiting…' : 'Enable location'}
        </button>
      ) : null}
    </div>
  )
}
