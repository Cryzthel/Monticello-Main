import { useEffect, useState } from 'react'

/**
 * A clock that ticks, for state that becomes true by the passage of time alone.
 *
 * ── WHY THIS IS NEEDED ──────────────────────────────────────────────────────
 * Everything else in these consoles re-renders because Firestore pushed a
 * change. An unattended SOS pushes nothing: the alert was written once, nobody
 * has touched it since, and that is the entire problem with it. Derive the
 * "Unattended" badge from `Date.now()` inside a render and it appears on the
 * next unrelated snapshot — which, on a quiet console at 3am, may be never.
 *
 * So the components that show a time-derived state subscribe to this instead,
 * and the helpers that decide take `nowMs` as an argument rather than reading
 * the clock themselves (see `operationsTargets.js`). That also keeps every row
 * in a table judged against ONE present, rather than each render reading its
 * own slightly different one.
 *
 * ── THE INTERVAL ────────────────────────────────────────────────────────────
 * 30 seconds by default. The escalation window is configurable down to one
 * minute, so half a minute is the coarsest tick that cannot make a badge look
 * a whole window late; anything finer re-renders a table for nothing.
 */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return undefined

    // Re-read on mount as well as on each tick: a tab left in the background
    // has been throttled, and the first thing the operator sees on coming back
    // should not be a stale present.
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}

export default useNow
