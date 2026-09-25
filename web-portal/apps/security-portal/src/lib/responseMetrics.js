import { ACTIVE_STATUSES } from '@shared/theme/statusStyles'
import {
  computeMeanResolutionTime,
  computeMeanTimeToRespond,
  formatMinutes,
} from '@shared/lib/incidents'
import { minutesWaiting } from '@shared/lib/wpda'
import { responseTargetFor } from '@/lib/dispatch'

/**
 * Every number the Response Metrics page shows, computed in one place.
 *
 * ── WHY ONE FUNCTION AND NOT SIX INLINE MEMOS ─────────────────────────────
 * The metrics used to be assembled inside PerformancePage's render, which made
 * them impossible to state precisely anywhere and impossible to test at all.
 * More importantly it hid the thing that actually matters about this row: the
 * numbers are DERIVED, entirely, from the incident documents. Nothing is
 * stored, nothing is aggregated server-side, and no metric has a copy of a
 * fact that a status change would have to be remembered to update.
 *
 * That is what makes them synchronise. Each dispatch stage (see
 * lib/dispatchWorkflow.js) writes one document; the page's `onSnapshot` listener receives
 * that document; this function re-runs over the new array. There is no second
 * write, no cache, no refresh button, and no path by which a metric can be
 * stale while the map is current — because there is nowhere for a stale value
 * to live.
 *
 * ── EVERY CLOCK-RELATIVE VALUE TAKES THE SAME `now` ───────────────────────
 * Three of these measure against the present: the shift window, the overdue
 * count, and the on-site deadline. Read from `Date.now()` independently they
 * would each sample a slightly different instant, and — worse — they would
 * only ever be re-read when a Firestore snapshot happened to arrive. A shift
 * with no new reports for twenty minutes would show an Overdue count frozen at
 * whatever it was twenty minutes ago, which is precisely the number a
 * dispatcher would act on.
 *
 * So `now` is a parameter. The page passes a value that ticks (see its
 * `useMetricsClock`), and the whole row advances together.
 */

// A rolling window (not a calendar-day count) is the correct match for a 24/7
// guardhouse — it also avoids the stat spuriously dropping to 0 right after
// midnight, which a strict toDateString() comparison would do.
export const SHIFT_WINDOW_HOURS = 12

// The dispatch SLA the Overdue card counts against. A report that has been
// Dispatched for longer than this without being closed is the thing a
// supervisor is looking for on this page.
export const OVERDUE_SLA_MINUTES = 20

/**
 * How long until the next open call breaches its on-site target.
 *
 * ── A DEADLINE, NOT A PREDICTION ──────────────────────────────────────────
 * Nothing in this system knows where a patrol unit is — no guard location
 * stream, no routing service — so an "ETA" here can only honestly mean "the
 * soonest response window still running". That is the same arithmetic
 * `dispatchEta` does for a single report (see lib/dispatch.js), reduced across
 * every call that has not yet been marked On-Site.
 *
 * The SOONEST rather than the average, deliberately. An average across one
 * call that is four minutes overdue and three that were filed a minute ago
 * reads as comfortable, and the four-minute one is the whole reason anybody
 * looked at the number. A dispatcher wants the next thing due.
 */
function nextOnSiteDeadline(reports, now) {
  // On-Site is the state this deadline measures TO, so a call already at it
  // has no window left to run. Resolved is excluded by ACTIVE_STATUSES.
  const open = reports.filter(
    (report) => ACTIVE_STATUSES.has(report.status) && report.status !== 'On-Site' && report.reportedAt,
  )
  if (!open.length) return null

  return open.reduce((soonest, report) => {
    const remaining = responseTargetFor(report.severity) - minutesWaiting(report.reportedAt, now)
    return soonest === null || remaining < soonest ? remaining : soonest
  }, null)
}

/**
 * @param {Array} reports Mapped incident documents (see mapIncidentDoc).
 * @param {number} now Epoch ms every clock-relative metric measures against.
 */
export function computeResponseMetrics(reports = [], now = Date.now()) {
  const shiftCutoff = now - SHIFT_WINDOW_HOURS * 3600000

  const resolved = reports.filter((report) => report.status === 'Resolved')
  const activeReports = reports.filter((report) => ACTIVE_STATUSES.has(report.status))

  // ── RESOLUTION RATE ─────────────────────────────────────────────────────
  // Of every report on file in the queried window, the share that reached
  // Resolved. Not "of the reports closed today" — that ratio is always 100%.
  const resolutionRate = reports.length ? resolved.length / reports.length : null

  const onSiteEtaMinutes = nextOnSiteDeadline(reports, now)

  return {
    activeReports,
    activeCount: activeReports.length,

    overdueCount: reports.filter(
      (report) =>
        report.status === 'Dispatched' && minutesWaiting(report.reportedAt, now) > OVERDUE_SLA_MINUTES,
    ).length,

    resolvedThisShift: resolved.filter(
      (report) => report.resolvedAt && new Date(report.resolvedAt).getTime() >= shiftCutoff,
    ).length,

    // ── THE TWO DURATIONS COME FROM THE SHARED FORMULAS ───────────────
    // Report -> dispatch and report -> resolution both already had a single
    // definition in shared/lib/incidents. Re-deriving them here would have
    // been a second opinion about the same question, which is the specific
    // way the two portals' "mean time to respond" drifted apart before those
    // helpers existed. Both skip reports missing the relevant stamp — an
    // undispatched call counted as zero would make a backlog look like
    // instant service.
    avgDispatchTime: computeMeanTimeToRespond(reports),
    avgResolutionTime: computeMeanResolutionTime(resolved),

    onSiteEtaMinutes,
    // Rendered here rather than in the card, so the sign convention and the
    // "no open calls" case are stated once. A negative remainder is a breach,
    // and it is named as one — "0m left" would be a comfortable way to write
    // "this is late".
    onSiteEta:
      onSiteEtaMinutes == null
        ? 'No open calls'
        : onSiteEtaMinutes <= 0
          ? `Overdue ${formatMinutes(-onSiteEtaMinutes)}`
          : `${formatMinutes(onSiteEtaMinutes)} left`,
    onSiteEtaBreached: onSiteEtaMinutes != null && onSiteEtaMinutes <= 0,

    resolutionRate,
    resolutionRateLabel:
      resolutionRate == null ? 'No data yet' : `${Math.round(resolutionRate * 100)}%`,
    resolvedCount: resolved.length,
  }
}
