import { useEffect, useState } from 'react'
import { MapPinOff, Navigation } from 'lucide-react'

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
export default function LocationAccessNotice({ mode, sharing, locationError }) {
  const [permission, setPermission] = useState(null)
  const [asking, setAsking] = useState(false)

  const onDuty = mode !== 'off'

  // The Permissions API answers without prompting, so the notice can tell
  // "never asked" from "refused" before spending the one prompt available.
  useEffect(() => {
    if (!onDuty || typeof navigator === 'undefined' || !navigator.permissions?.query) return undefined
    let cancelled = false
    let status = null
    const sync = () => !cancelled && setPermission(status?.state ?? null)

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        if (cancelled) return
        status = result
        sync()
        result.addEventListener('change', sync)
      })
      .catch(() => {
        // Safari on older iOS has no Permissions API for geolocation. The
        // notice still works; it just cannot pre-empt the prompt.
      })

    return () => {
      cancelled = true
      status?.removeEventListener('change', sync)
    }
  }, [onDuty])

  const denied = locationError === 'location-denied' || permission === 'denied'
  const missing = locationError === 'no-fix'

  // Nothing to say while a position is flowing.
  if (!onDuty || (sharing && !locationError && !denied)) return null
  if (!denied && !missing && permission === 'granted') return null

  function requestAccess() {
    if (!navigator.geolocation) return
    setAsking(true)
    navigator.geolocation.getCurrentPosition(
      () => setAsking(false),
      () => setAsking(false),
      // The same options the telemetry watch uses while responding, so the
      // permission this prompt buys is the one the stream actually needs.
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
    )
  }

  const Icon = denied ? MapPinOff : Navigation

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-hairline bg-warning/10 px-4 py-2.5 text-caption text-text-primary"
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {denied
            ? 'Location is blocked — dispatch cannot see you'
            : missing
              ? 'No GPS fix — dispatch cannot see you'
              : 'Share your location so dispatch can route to you'}
        </p>
        <p className="mt-0.5 leading-snug text-text-secondary">
          {denied
            ? 'Allow location for this site in your browser settings, then reload. Until then you will not appear on the dispatch map and routes cannot be measured from your position.'
            : missing
              ? 'Your device has location switched on but cannot get a fix. Step outside or into the open; the stream resumes on its own.'
              : 'Your position is only shared while you are clocked in, and it is what lets the guardhouse send the nearest unit to a call.'}
        </p>
      </div>

      {!denied ? (
        <button
          type="button"
          onClick={requestAccess}
          disabled={asking}
          className="btn btn-sm btn-outline shrink-0"
        >
          {asking ? 'Waiting…' : 'Enable location'}
        </button>
      ) : null}
    </div>
  )
}
