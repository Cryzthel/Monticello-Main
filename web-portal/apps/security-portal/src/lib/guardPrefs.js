import { portalKey } from '@shared/config/portal'

const KEY = portalKey('guard-prefs')

/**
 * Guardhouse display preferences.
 *
 * ── DEVICE-LOCAL, AND SAID OUT LOUD ────────────────────────────────────────
 * Stored in localStorage, like the admin portal's notification toggles. That is
 * a real limitation and the settings page states it rather than implying these
 * follow the account: a guard signing in at a different terminal starts from
 * the defaults. Moving them to the account needs a per-user preferences
 * document and a Firestore rule to match, neither of which exists.
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
  /**
   * Routing graph for Acknowledge & Respond on the dispatch map — `driving` or
   * `walking` (see lib/directions.js). Set from the route badge's Drive/Walk
   * toggle rather than this page, so the next route starts on the graph this
   * terminal's unit actually uses.
   */
  routeProfile: 'driving',
  /**
   * Whether this device shares its position while its officer is on duty
   * with no active call, which is what draws them as an Available unit on
   * the dispatch map. Off still reports them on duty, with no position. During
   * a call the position is always shared; see lib/guardTelemetry.js.
   */
  shareIdleLocation: true,
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
