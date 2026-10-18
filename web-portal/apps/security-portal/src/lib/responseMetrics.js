import { ACTIVE_STATUSES } from '@shared/theme/statusStyles'
import { computeMeanTimeToRespond } from '@shared/lib/incidents'
import { minutesWaiting } from '@shared/lib/wpda'

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
 * The overdue count measures against the present. Read from `Date.now()` independently they
 * would each sample a slightly different instant, and — worse — they would
 * only ever be re-read when a Firestore snapshot happened to arrive. A shift
 * with no new reports for twenty minutes would show an Overdue count frozen at
 * whatever it was twenty minutes ago, which is precisely the number a
 * dispatcher would act on.
 *
 * So `now` is a parameter. The page passes a value that ticks (see its
 * `useMetricsClock`), and the whole row advances together.
 */

// The dispatch SLA the Overdue card counts against. A report that has been
// Dispatched for longer than this without being closed is the thing a
// supervisor is looking for on this page.
export const OVERDUE_SLA_MINUTES = 20

/**
 * Statuses that mean "in the queue, nobody assigned yet". Verified is a report
 * the guardhouse has looked at but not yet sent a unit to, so it is still
 * waiting for the one decision this console exists to make.
 */
const AWAITING_DISPATCH = new Set(['Pending', 'Verified'])

/**
 * ── WHAT THIS PAGE NO LONGER COMPUTES (2026-10-17) ─────────────────────────
 * On-Site ETA, Resolution Rate and Avg Resolution Time were removed from the
 * guardhouse with the Duty Status panel. They are outcome measures — how the
 * month went — and they belong to the administrator's Metrics page, which
 * computes its own resolution rate (admin usePortalMetrics). The guard view is
 * now only what needs acting on: what is open, what is waiting for a unit,
 * what is late, and how fast units are being assigned.
 *
 * @param {Array} reports Mapped incident documents (see mapIncidentDoc).
 * @param {number} now Epoch ms every clock-relative metric measures against.
 */
export function computeResponseMetrics(reports = [], now = Date.now()) {
  const activeReports = reports.filter((report) => ACTIVE_STATUSES.has(report.status))

  return {
    activeReports,
    activeCount: activeReports.length,

    awaitingDispatchCount: reports.filter((report) => AWAITING_DISPATCH.has(report.status)).length,

    overdueCount: reports.filter(
      (report) =>
        report.status === 'Dispatched' && minutesWaiting(report.reportedAt, now) > OVERDUE_SLA_MINUTES,
    ).length,

    // From the shared formula, so this and the admin's "mean time to respond"
    // cannot drift apart. Undispatched calls are skipped, not counted as zero.
    avgDispatchTime: computeMeanTimeToRespond(reports),
  }
}
