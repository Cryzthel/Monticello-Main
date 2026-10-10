import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Which way the device ITSELF is pointing, from the hardware compass.
 *
 * ── THIS IS NOT THE SAME FACT AS THE ROUTE BEARING ─────────────────────────
 * The map already draws a heading beam from `progress.bearing`, which is the
 * direction of the ROAD at the unit's position. The two agree while a vehicle
 * is moving and they are different questions, and the difference is the whole
 * reason this exists:
 *
 *   route bearing   which way the road goes here. Needs movement to mean
 *                   anything, and is a property of the line, not the officer.
 *   compass heading which way the officer is FACING. True while standing
 *                   still, which is exactly when somebody is deciding which
 *                   way to walk out of a vehicle into a dark subdivision.
 *
 * A guard parked at a gate, looking for lot 12, gets nothing from the first
 * and everything from the second.
 *
 * ── THE COMPASS IS THE VIEWER'S OWN, AND STAYS ON THIS DEVICE ──────────────
 * Nothing here is published. The cone is drawn on the signed-in officer's own
 * marker, on their own console, from their own hardware — a dispatcher
 * watching that officer from the guardhouse desk does not see a cone, and
 * should not: their console has no idea which way that phone is pointing, and
 * the honest alternative would be streaming a 60 Hz orientation feed to
 * Firestore to animate a wedge. The position heartbeat is already rate-limited
 * to protect the quota (see TELEMETRY_CADENCE); a compass feed would be two
 * orders of magnitude noisier and tell a dispatcher nothing they act on.
 *
 * ── THE THREE WAYS A BROWSER REPORTS THIS, AND WHY IT IS NOT ONE ───────────
 *   webkitCompassHeading  iOS/Safari. Already a TRUE-north compass bearing,
 *                         clockwise, no conversion.
 *   deviceorientationabsolute  Chrome on Android. `alpha` is counter-clockwise
 *                         from east-ish, so the bearing is `360 - alpha`.
 *   deviceorientation with absolute === true  the same thing arriving on the
 *                         older event name, which some Android builds still
 *                         use. A non-absolute event is RELATIVE to however the
 *                         device happened to be held when the page loaded, and
 *                         is therefore refused: an arbitrary offset is worse
 *                         than no cone, because a cone asserts a direction.
 *
 * ── iOS NEEDS A GESTURE, AND THE CONE IS NEEDED BEFORE THERE IS ONE ───────
 * Safari gates the orientation events behind `requestPermission()`, which
 * throws unless it is called from a user gesture. That was fine while the
 * cone only appeared during navigation, because Start Navigation IS a
 * gesture and it happened at the exact moment the cone became useful.
 *
 * The cone is now wanted in STANDBY — an officer looking at an alert,
 * deciding which way to walk, before they have pressed anything. There is no
 * press to hang the request on, and asking on mount throws.
 *
 * So the hook arms a ONE-SHOT listener for the next real interaction with the
 * page, whatever it is, and spends it on the permission request. That is the
 * standard way out of this and it is worth being plain about what it costs:
 * on iOS the officer's first tap anywhere raises a permission sheet they did
 * not explicitly ask for. It is their own console, the sheet names the
 * sensor, a refusal is remembered and simply leaves the cone off, and the
 * alternative is a feature that silently never works on half the handsets a
 * guard might carry. `request` is still exported and still called from Start
 * Navigation, so on the path where there IS a deliberate gesture the sheet
 * arrives attached to it.
 */

/**
 * Degrees of change below which a new reading is ignored.
 *
 * A phone lying on a passenger seat reports sub-degree jitter continuously.
 * Without a floor this would set React state at the sensor's rate — 60 times
 * a second on some devices — and re-render the dashboard to move a wedge by
 * a quarter of a degree. 2° is under what the eye reads as movement on a
 * 54px cone and cuts the update rate to roughly what a turning hand produces.
 */
const MIN_DELTA_DEG = 2

/** Shortest signed angular distance between two bearings, in degrees. */
function delta(a, b) {
  return Math.abs(((b - a + 540) % 360) - 180)
}

function headingFrom(event) {
  // iOS first: it is already true north and needs no arithmetic.
  if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
    return event.webkitCompassHeading
  }
  if (!event.absolute || typeof event.alpha !== 'number' || Number.isNaN(event.alpha)) return null
  return (360 - event.alpha) % 360
}

export function useDeviceHeading({ enabled = true } = {}) {
  const [heading, setHeading] = useState(null)
  const [permission, setPermission] = useState('unknown')
  const headingRef = useRef(null)

  const request = useCallback(async () => {
    const api = globalThis.DeviceOrientationEvent
    if (typeof api?.requestPermission !== 'function') {
      // Android and desktop: no gate to pass. Reported as granted so a caller
      // cannot tell "not needed" apart from "allowed", which is the only
      // distinction that would make it write two code paths for one outcome.
      setPermission('granted')
      return true
    }
    try {
      const result = await api.requestPermission()
      setPermission(result)
      return result === 'granted'
    } catch {
      // Thrown when the call did not come from a user gesture. Not an error
      // worth surfacing — the cone is an enhancement, and the marker, the
      // route and every figure on the panel are unaffected by its absence.
      setPermission('denied')
      return false
    }
  }, [])

  /**
   * Spend the next interaction on the permission sheet, once.
   *
   * Only where a sheet actually exists — `requestPermission` is absent on
   * Android and desktop, where `request` resolves immediately and this never
   * arms. `once: true` on every listener, and the effect tears them all down
   * as soon as any of them fires, so a declined sheet is not re-raised on the
   * next tap.
   */
  useEffect(() => {
    if (!enabled || permission !== 'unknown') return undefined
    if (typeof globalThis.DeviceOrientationEvent?.requestPermission !== 'function') return undefined

    const ask = () => {
      request()
    }
    const events = ['pointerdown', 'touchend', 'keydown']
    events.forEach((type) => globalThis.addEventListener(type, ask, { once: true, passive: true }))
    return () => events.forEach((type) => globalThis.removeEventListener(type, ask))
  }, [enabled, permission, request])

  useEffect(() => {
    if (!enabled || permission === 'denied') return undefined
    if (typeof globalThis.addEventListener !== 'function') return undefined

    const onOrientation = (event) => {
      const next = headingFrom(event)
      if (next == null) return
      const last = headingRef.current
      if (last != null && delta(last, next) < MIN_DELTA_DEG) return
      headingRef.current = next
      setHeading(next)
    }

    // Both names, because which one a device fires is not knowable in advance
    // and listening to the wrong one alone is a silent no-op. `headingFrom`
    // refuses a non-absolute reading, so the older event cannot smuggle in a
    // relative angle.
    globalThis.addEventListener('deviceorientationabsolute', onOrientation, true)
    globalThis.addEventListener('deviceorientation', onOrientation, true)
    return () => {
      globalThis.removeEventListener('deviceorientationabsolute', onOrientation, true)
      globalThis.removeEventListener('deviceorientation', onOrientation, true)
    }
  }, [enabled, permission])

  // Dropped the moment it stops being listened for, so a stale wedge is never
  // left pointing somewhere the officer no longer is.
  useEffect(() => {
    if (enabled) return
    headingRef.current = null
    setHeading(null)
  }, [enabled])

  return { heading, permission, request }
}
