import { createContext, useContext } from 'react'
import { useGuardTelemetry } from '@/hooks/useGuardTelemetry'

/**
 * One telemetry stream for the whole console, readable from anywhere.
 *
 * ── WHY A PROVIDER AND NOT JUST THE HOOK ────────────────────────────────────
 * `useGuardTelemetry` opens a `watchPosition` watch and a heartbeat. Calling
 * it twice would open two of each, so it can only be mounted once — and it was
 * mounted in `DispatchWatchdog`, above the router, where its return value had
 * nowhere to go and was discarded.
 *
 * Moving the call into the shell instead would have put it inside a component
 * every page re-mounts, restarting the GPS watch on every navigation. So the
 * hook stays mounted once, above the routes, and this publishes what it knows
 * to whoever needs it — currently the officer-facing location notice.
 */
const GuardTelemetryContext = createContext({
  mode: 'off',
  sharing: false,
  locationError: null,
  activeIncidentId: null,
  fix: null,
})

export function GuardTelemetryProvider({ children }) {
  const telemetry = useGuardTelemetry()
  return (
    <GuardTelemetryContext.Provider value={telemetry}>{children}</GuardTelemetryContext.Provider>
  )
}

/**
 * `{ mode, sharing, locationError, activeIncidentId, fix }` for this officer.
 *
 * `fix` is this device's own last position, `{ lat, lng, accuracy, ... }` or
 * null. It is the same value the telemetry document carries, offered locally
 * so the dispatch route can start from it without a round trip through
 * Firestore — see the note on it in useGuardTelemetry.
 */
export function useGuardTelemetryState() {
  return useContext(GuardTelemetryContext)
}

export default GuardTelemetryProvider
