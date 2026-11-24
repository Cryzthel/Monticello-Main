/**
 * The signal state of a panic alert, as an operator reads it.
 *
 * Pure and dependency-free so it can be exercised directly — the mapping below
 * decides whether a live emergency is presented as closed, which is the one
 * mistake this vocabulary must not make.
 *
 * ── WIRE VALUE vs. WHAT IT MEANS ──────────────────────────────────────────
 * The mobile SOS button writes `status: 'active'`; `acknowledgePanicAlert`
 * moves it to 'acknowledged' and `resolvePanicAlert` to 'resolved' (see
 * panicAlerts.js). Those are lifecycle words. What a console needs to show is
 * what is happening on the ground, which is why the labels differ:
 * "acknowledged" tells you a row was touched, "Security Dispatched" tells you
 * someone is on their way.
 */
export const PANIC_SIGNAL = {
  active: { label: 'Active Emergency', tone: 'danger', live: true },
  acknowledged: { label: 'Security Dispatched', tone: 'warning', live: true },
  resolved: { label: 'Resolved', tone: 'success', live: false },
}

/**
 * Anything unrecognised reads as a LIVE emergency, never as resolved.
 *
 * The failure directions are not symmetric. Showing a closed alert as active
 * costs a guard a radio call to confirm; showing an active one as resolved
 * costs a resident their response. A status this code has never seen — a value
 * added later, a partial write, a typo in a seed script — is exactly the case
 * where the safe reading has to be automatic rather than remembered.
 */
export function panicSignal(status) {
  const key = String(status ?? '').trim().toLowerCase()
  return PANIC_SIGNAL[key] ?? PANIC_SIGNAL.active
}

/** True while the alert still needs someone. Drives the "live" counters. */
export function isPanicLive(status) {
  return panicSignal(status).live
}
