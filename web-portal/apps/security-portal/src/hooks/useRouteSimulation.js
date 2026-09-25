import { useEffect, useRef, useState } from 'react'
import { interpolateAlong, measureLine } from '@/lib/routeProgress'

/**
 * A pretend unit walking the plotted route, for demonstrations.
 *
 * ── THIS INVENTS DATA, SO READ THE RULES ────────────────────────────────────
 * Every other number on the dispatch map is derived from a position a real
 * device reported. This one is not: it is a clock multiplied by a speed. That
 * makes it useful for showing the navigation view working without two people
 * and a motorcycle, and dangerous for exactly the same reason, so it is built
 * to be impossible to mistake for the real thing:
 *
 *   1. IT NEVER WRITES. No Firestore, no telemetry, nothing leaves this
 *      browser tab. Another console watching the same call sees the truth.
 *      This is the property that matters most — a simulation that published
 *      would put a fake moving guard on every screen in the guardhouse.
 *   2. It is off by default and lives behind the map's controls drawer, which
 *      is itself collapsed, so reaching it takes two deliberate actions.
 *   3. While it runs, the card's "Live" pill is REPLACED by an amber
 *      "Simulated" one. The badge takes over the very element that would
 *      otherwise assert the data is real, rather than sitting beside it.
 *   4. It stops itself when the route it was walking goes away.
 *
 * ── IT MOVES ALONG THE REAL GEOMETRY ────────────────────────────────────────
 * Positions come from `interpolateAlong` over the route Mapbox actually
 * returned, so the pretend unit is always on a real road, and every figure
 * downstream — remaining distance, ETA, the active maneuver, the covered
 * polyline — is computed by the same code that handles a real fix. Nothing is
 * special-cased for the simulation, which is what makes the simulation worth
 * having: it exercises the real path.
 *
 * @param {object} options
 * @param {Array<[number, number]>} options.coordinates The route geometry.
 * @param {number} options.speedKmh From the routing profile's `simKmh`.
 * @param {boolean} options.running
 * @returns {{ lat: number, lng: number } | null} null when not running.
 */
export function useRouteSimulation({ coordinates, speedKmh, running }) {
  const [position, setPosition] = useState(null)
  const frameRef = useRef(0)

  useEffect(() => {
    if (!running || !Array.isArray(coordinates) || coordinates.length < 2) {
      setPosition(null)
      return undefined
    }

    const { total } = measureLine(coordinates)
    const metresPerSecond = (Math.max(1, speedKmh || 1) * 1000) / 3600
    if (!(total > 0)) return undefined

    let startedAt = null
    let lastEmit = 0

    /**
     * ~5 updates a second, not 60.
     *
     * Each emission re-renders the dashboard and pushes a new GeoJSON payload
     * into the map's source. At a full frame rate that is sixty source swaps a
     * second to move a dot a few pixels, which costs far more than it shows —
     * and a real fix arrives every five to thirty seconds anyway, so 5 Hz is
     * already an order of magnitude smoother than the thing being imitated.
     */
    const EMIT_EVERY_MS = 200

    const tick = (now) => {
      if (startedAt === null) startedAt = now
      const travelled = ((now - startedAt) / 1000) * metresPerSecond
      const done = travelled >= total

      if (done || now - lastEmit >= EMIT_EVERY_MS) {
        lastEmit = now
        const point = interpolateAlong(coordinates, Math.min(travelled, total))
        if (point) setPosition({ lat: point[1], lng: point[0] })
      }

      // Stops at the destination and stays there, rather than looping. A unit
      // that arrives and then teleports back to the start would be the one
      // behaviour no real dispatch has ever shown.
      if (!done) frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [running, coordinates, speedKmh])

  return position
}

export default useRouteSimulation
