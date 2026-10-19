import { portalKey } from '@shared/config/portal'

const KEY = portalKey('guard-prefs')

/**
 * Guardhouse display preferences.
 *
 * ── A LOCAL CACHE OF THE ACCOUNT'S VALUE (2026-10-19) ──────────────────────
 * Stored in localStorage so the console reads it synchronously and keeps it
 * offline. `shareIdleLocation` is also kept on the account
 * (`users/{uid}.guardPreferences`) by GuardPrefsSync, which applies the
 * account's value here and writes a change made here back up, so it follows
 * the officer to every console.
 *
 * Every key here CHANGES SOMETHING. A settings page whose switches are
 * decorative is worse than no settings page, so anything that could not be
 * wired to a real behaviour was left out rather than added as a stub.
 *
 * `feedWindowHours` was removed under that rule, not because the preference was
 * a bad idea. It set `ActionFeed.windowHours` on the Incident Tickets page, and
 * that feed is gone — the queue is full width now, matching the Admin console.
 * With nothing left in this portal rendering an ActionFeed, the control had
 * become exactly the decorative switch the paragraph above forbids. A stored
 * value from before the change is harmless: the spread below simply carries an
 * unknown key nothing reads.
 */
export const GUARD_PREF_DEFAULTS = {
  /** Rows per screen in the ticket table — `compact` trades air for count. */
  density: 'comfortable',
  /*
   * `routeProfile` stood here and is gone — the same way `windowHours` went,
   * and for the same reason stated above. Its Ride / Walk control was deleted
   * from the map, so the stored value became a setting that silently decided
   * which road graph every route used with nothing on screen able to show or
   * change it. The dispatch map now pins the patrol default outright (see
   * DEFAULT_ROUTE_PROFILE). A stored value from before this is harmless: the
   * spread below carries an unknown key nothing reads.
   */
  /**
   * Whether this device shares its position while its officer is on duty
   * with no active call, which is what draws them as an Available unit on
   * the dispatch map. Off still reports them on duty, with no position. During
   * a call the position is always shared; see lib/guardTelemetry.js.
   */
  shareIdleLocation: true,
  /**
   * This officer's siren level, 0–1, or null to follow the level an
   * administrator set for every console (system_settings, Admin › Settings).
   * Kept on the account like the others, so it follows the officer
   * (2026-10-19, by request: an adjustable alarm volume on Guard Settings).
   */
  sirenVolume: null,
}

/** The level the siren should play at: this officer's, else the console-wide one. */
export function effectiveSirenVolume(prefs, adminVolume) {
  const own = prefs?.sirenVolume
  return typeof own === 'number' && own >= 0 && own <= 1 ? own : adminVolume
}

// The last saved value, so a choice made where localStorage throws (private
// mode) still holds for this session instead of reverting on the next read.
let memory = null
const listeners = new Set()

export function loadGuardPrefs() {
  if (memory) return { ...memory }
  try {
    return { ...GUARD_PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...GUARD_PREF_DEFAULTS }
  }
}

export function saveGuardPrefs(prefs) {
  memory = { ...GUARD_PREF_DEFAULTS, ...prefs }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* private mode — `memory` keeps the choice for this session */
  }
  listeners.forEach((listener) => listener({ ...memory }))
}

/** Called with the new prefs whenever they are saved on this device. Returns the unsubscribe. */
export function subscribeGuardPrefs(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
