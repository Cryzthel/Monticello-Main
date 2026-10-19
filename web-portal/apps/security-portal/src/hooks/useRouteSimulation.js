import { useEffect, useState } from 'react'
import { interpolateAlong, measureLine } from '@/lib/routeProgress'

/** Patrol pace for the demonstration drive. */
export const SIMULATION_SPEED_KMH = 25
/** Emit a position this often — the turn card and voice need nothing finer. */
const TICK_MS = 200

/**
 * A pretend unit walked along the plotted route, for demonstrating and
 * rehearsing turn-by-turn guidance (restored 2026-10-19 at the user's request,
 * inside the Start Navigation modal).
 *
 * ── THE SAFETY RULES THE FIRST VERSION HAD, KEPT ────────────────────────────
 *  • ZERO database references. The simulated fix never reaches Firestore, the
 *    telemetry document, the arrival stamp or any other console — it only
 *    replaces the fix the turn card, the marker and the voice are computed
 *    from, on this screen.
 *  • Off by default, and only while a navigation session runs.
 *  • Labelled on screen while running: "Simulated" in amber, in the modal and
 *    the top banner, so nobody mistakes the moving marker for a real unit.
 *
 * `setTimeout` ticks rather than `requestAnimationFrame`: rAF stops in a
 * background tab, and the drive should keep its pace while the officer glances
 * at another window. It stops at the destination and holds there.
 *
 * Returns `{ lat, lng, accuracy, capturedAt }` or null.
 */
export function useRouteSimulation({ coordinates, running, speedKmh = SIMULATION_SPEED_KMH }) {
  const [position, setPosition] = useState(null)

  useEffect(() => {
    if (!running || !Array.isArray(coordinates) || coordinates.length < 2) {
      setPosition(null)
      return undefined
    }
    const { total } = measureLine(coordinates)
    if (!(total > 0)) return undefined
    const metresPerSecond = (Math.max(1, speedKmh) * 1000) / 3600
    const startedAt = Date.now()
    let timer = null

    const tick = () => {
      const travelled = Math.min(total, ((Date.now() - startedAt) / 1000) * metresPerSecond)
      const point = interpolateAlong(coordinates, travelled)
      if (point) setPosition({ lat: point[1], lng: point[0], accuracy: 5, capturedAt: Date.now() })
      if (travelled < total) timer = setTimeout(tick, TICK_MS)
    }
    tick()
    return () => clearTimeout(timer)
  }, [running, coordinates, speedKmh])

  return running ? position : null
}

export default useRouteSimulation
