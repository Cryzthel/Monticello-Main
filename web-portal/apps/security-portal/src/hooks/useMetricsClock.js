import { useEffect, useState } from 'react'

/**
 * A clock that advances on an interval, for metrics measured against "now".
 *
 * ── THE HALF OF "REAL-TIME" THAT A LISTENER DOES NOT COVER ────────────────
 * The Response Metrics page reads its incidents through `onSnapshot`, so a
 * status change made on the Live Dispatch map reaches it the moment it lands —
 * that half was already true and is not what this hook is for.
 *
 * The other half is that three of those metrics are arithmetic against the
 * present: the rolling shift window, the overdue count, and the on-site
 * deadline. React only recomputes a memo when its dependencies change, and
 * `Date.now()` is not a dependency — so with no new snapshot arriving, those
 * three froze at whatever instant the last Firestore write happened to occur.
 *
 * On a quiet shift that is the dangerous case rather than the harmless one: a
 * dispatcher watching a page with no traffic sees "Overdue 0" and a healthy
 * ETA indefinitely, while calls filed twenty minutes ago quietly breach. The
 * numbers were not wrong when they were computed; they simply stopped being
 * about now.
 *
 * ── 15 SECONDS, NOT ONE ───────────────────────────────────────────────────
 * Every value derived from this is rendered to the minute (`formatMinutes`),
 * so a per-second tick would re-render the page sixty times to change nothing
 * fifty-nine of them. Fifteen seconds is a quarter of the smallest visible
 * unit — fast enough that no reading is ever more than a quarter-minute stale,
 * cheap enough to leave running all shift. The same interval and the same
 * reasoning as the dispatch drawer's ETA tick.
 *
 * Returns epoch ms rather than a Date so callers can hand it straight to the
 * metrics functions and compare it without allocating.
 */
export function useMetricsClock(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
