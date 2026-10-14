import { useCallback, useEffect, useRef, useState } from 'react'
import { ONE_SHOT_POSITION_OPTIONS, isUsableFix } from '@shared/lib/geolocation'
import { rememberFix } from '@/lib/guardTelemetry'
import { locationState } from '@/lib/locationState'

/**
 * What is wrong with this device's location, and whether we are allowed to ask.
 *
 * ── WHY THIS IS A HOOK AND NOT TWO COPIES OF THE SAME `IF` ─────────────────
 * Two surfaces now report this: the banner at the top of the shell, and a
 * toast. They must never disagree — a banner saying "allow location" above a
 * console with no toast, or a toast asking for something the banner says is
 * already blocked, is worse than either on its own, because the officer then
 * has to work out which one is lying.
 *
 * The decision is genuinely fiddly (see `state` below) and it is the kind that
 * drifts the moment it exists twice, so it lives here once and both surfaces
 * render it.
 */

/**
 * How long a device gets to produce its first position before the console says
 * anything about it.
 *
 * ── WHY THERE IS A GRACE PERIOD AT ALL ─────────────────────────────────────
 * A cold high-accuracy lock routinely takes twenty seconds — a GPS chip waking
 * with no almanac, a laptop enumerating access points — and for all of that
 * time the honest state is "working on it", not "no GPS fix". Without a delay
 * every officer would be shown a problem on every single load and watch it
 * disappear by itself, which teaches them to ignore the one time it does not.
 *
 * Twelve seconds: long enough that a warm device never trips it, short enough
 * that an officer who has just been handed a call is not left wondering.
 */
const FIRST_FIX_GRACE_MS = 12_000

/**
 * `{ state, request, asking }`.
 *
 * `state` is one of:
 *
 *   off        off duty, or no geolocation support. Say nothing: telemetry is
 *              gated on an open shift by design, and an officer who has
 *              clocked out is a private citizen.
 *   ok         a usable position is flowing. Nothing to report.
 *   prompt     never asked, or asked and not yet answered. We may ask, and
 *              asking is the whole point — this is the only state where a
 *              button can fix the problem in one press.
 *   denied     the browser has been told no. We may NOT ask again; only its
 *              own settings can undo it, so the copy has to point there.
 *   waiting    permission is granted and no position has arrived yet, past the
 *              grace period above. Nothing to press — the device is trying.
 */
export function useLocationAccess({ mode, locationError, fix }) {
  const [permission, setPermission] = useState(null)
  const [asking, setAsking] = useState(false)
  /** Has the grace period expired without a position? */
  const [overdue, setOverdue] = useState(false)

  const onDuty = mode !== 'off'
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.geolocation)

  /**
   * ── THE PERMISSIONS API IS THE AUTHORITY, THE ERROR CODE IS NOT ──────────
   * It answers without prompting, so this can tell "never asked" from
   * "refused" before spending the one prompt a browser gives per origin.
   *
   * A geolocation error code describes ONE failed reading; this describes the
   * standing grant. When they disagree the grant is what is true — which is
   * the bug that put "Location is blocked" on consoles where officers had
   * allowed it.
   */
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
        // Safari on older iOS has no geolocation entry. Everything still
        // works; it simply cannot pre-empt the prompt.
      })

    return () => {
      cancelled = true
      status?.removeEventListener('change', sync)
    }
  }, [onDuty])

  /**
   * The grace timer, restarted whenever there is a reason to wait again.
   *
   * Keyed on having a fix rather than on time: the moment one arrives the
   * timer is irrelevant, and if the stream later dries up the officer is
   * already being told by `locationError` rather than by this.
   */
  useEffect(() => {
    if (!onDuty || fix) {
      setOverdue(false)
      return undefined
    }
    const timer = setTimeout(() => setOverdue(true), FIRST_FIX_GRACE_MS)
    return () => clearTimeout(timer)
  }, [onDuty, fix])

  /**
   * Has this device EVER delivered a position in this session? Latched, and
   * never reset by an error — see `locationState` for what it buys.
   */
  const everFixed = useRef(false)
  if (fix) everFixed.current = true

  const state = locationState({
    onDuty,
    supported,
    permission,
    locationError,
    fix,
    everFixed: everFixed.current,
    overdue,
  })

  /**
   * Ask the browser for a position, which is what makes it show its sheet.
   *
   * ── IT MUST BE CALLED FROM A GESTURE, AND THERE IS ONE CHANCE ───────────
   * The sheet only appears in response to a user action, and only once per
   * origin until the person changes it in settings. That is why nothing here
   * requests on mount: a page that spends the prompt before the officer knows
   * what is being asked, or why, has thrown away the only chance to explain
   * itself.
   */
  const request = useCallback(() => {
    if (!navigator.geolocation) return
    setAsking(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAsking(false)
        /**
         * ── THE POSITION GOES LIVE NOW, NOT ON THE NEXT CALLBACK ──────────
         * Granting the permission releases the `watchPosition` already
         * running in `useGuardTelemetry`, so the stream resumes on its own —
         * but on its own cadence, which can be seconds away. This hands the
         * fix it just bought straight to the module `lastFix`, so everything
         * reading `getLastFix()` — the navigation camera most of all — is
         * correct from the press rather than from the next tick.
         *
         * Guarded by `isUsableFix` for the same reason the stream is: a
         * desktop with no radio answers this prompt from its IP address, and
         * a coarse reading must not become the position the camera flies to
         * just because a person pressed a button to get it.
         */
        if (isUsableFix(position.coords)) rememberFix(position)
      },
      () => setAsking(false),
      ONE_SHOT_POSITION_OPTIONS,
    )
  }, [])

  return { state, request, asking }
}
