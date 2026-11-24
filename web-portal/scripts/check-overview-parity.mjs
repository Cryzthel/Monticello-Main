/**
 * Demonstrates the Admin Overview's parity invariants against adversarial
 * fixtures. Run from `web-portal`:
 *
 *   node scripts/check-overview-parity.mjs
 *
 * ── WHY A SCRIPT AND NOT A COMMENT ─────────────────────────────────────────
 * The claim the Overview makes is arithmetic: the category breakdown sums to
 * Total reports, and Resolved means the same thing in every place it appears.
 * That claim was previously made in prose, in three files, while being false -
 * SOS alerts were counted in the headline and dropped from the chart. A
 * sentence cannot notice when it stops being true.
 *
 * The derivation is pure and Firebase-free precisely so this can run in plain
 * Node with no test framework and nothing to install. The fixtures are the
 * cases that actually broke it: mixed-case categories, a retired category, a
 * missing category, SOS alerts both live and resolved, a soft-deleted report, a
 * report with no timestamp, a future timestamp, and an empty estate.
 *
 * Exits non-zero on any failed invariant.
 */

import {
  computeOverviewMetrics,
  incidentAsReport,
  panicAlertAsReport,
  percentage,
} from '../packages/shared/src/lib/overviewMetrics.js'
import { isPanicLive } from '../packages/shared/src/lib/panicStatus.js'
import { CATEGORY_LABELS } from '../packages/shared/src/lib/incidentCategories.js'

const NOW = new Date('2026-11-24T12:00:00Z').getTime()
const DAY = 86400000
const ago = (days) => new Date(NOW - days * DAY)

/*
  Incidents as `mapIncidentDoc` hands them over: a DISPLAY `status` and a
  derived `dispatchStage`. The two are given deliberately inconsistent values on
  `inc-stale` to prove which one the resolved count reads.
*/
const incidents = [
  { id: 'inc-1', category: 'Security', dispatchStage: 'resolved', status: 'Resolved', reportedAt: ago(1) },
  { id: 'inc-2', category: 'security', dispatchStage: 'responding', status: 'Dispatch in progress', reportedAt: ago(2) },
  { id: 'inc-3', category: 'SECURITY', dispatchStage: 'none', status: 'Pending', reportedAt: ago(3) },
  { id: 'inc-4', category: 'maintenance', dispatchStage: 'resolved', status: 'Resolved', reportedAt: ago(4) },
  // Retired category. Must count, in Others, not vanish.
  { id: 'inc-5', category: 'hazard', dispatchStage: 'none', status: 'Pending', reportedAt: ago(5) },
  // No category at all.
  { id: 'inc-6', dispatchStage: 'resolved', status: 'Resolved', reportedAt: ago(6) },
  { id: 'inc-7', category: null, dispatchStage: 'none', status: 'Pending', reportedAt: ago(6) },
  // A category nothing in the taxonomy knows.
  { id: 'inc-8', category: 'Goat on the green', dispatchStage: 'none', status: 'Pending', reportedAt: ago(7) },
  // Stage says resolved, display status is stale. The stage is authoritative.
  { id: 'inc-stale', category: 'medical', dispatchStage: 'resolved', status: 'Dispatch in progress', reportedAt: ago(8) },
  // Outside a 7-day window, inside a 30-day one.
  { id: 'inc-old', category: 'fire', dispatchStage: 'resolved', status: 'Resolved', reportedAt: ago(20) },
  // In the PREVIOUS 30-day period only - feeds the deltas, never the totals.
  { id: 'inc-prev', category: 'noise', dispatchStage: 'resolved', status: 'Resolved', reportedAt: ago(40) },
  // No usable timestamp: belongs to no period.
  { id: 'inc-undated', category: 'security', dispatchStage: 'none', status: 'Pending', reportedAt: null },
  // A future timestamp. The window is inclusive at `now`, so this is excluded.
  { id: 'inc-future', category: 'security', dispatchStage: 'none', status: 'Pending', reportedAt: new Date(NOW + 5 * DAY) },
]

const alerts = [
  { id: 'sos-live', status: 'active', createdAt: ago(1) },
  { id: 'sos-ack', status: 'acknowledged', createdAt: ago(2) },
  { id: 'sos-done', status: 'resolved', createdAt: ago(3) },
  // A status the vocabulary has never seen. panicStatus reads it as LIVE.
  { id: 'sos-weird', status: 'escalated-to-barangay', createdAt: ago(4) },
  { id: 'sos-old', status: 'resolved', createdAt: ago(40) },
]

const records = [
  ...incidents.map(incidentAsReport),
  ...alerts.map((alert) => panicAlertAsReport(alert, { live: isPanicLive(alert.status) })),
]

let failures = 0
function check(label, pass, detail = '') {
  if (!pass) failures += 1
  const mark = pass ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`)
}

function report(rangeDays, set = records) {
  const m = computeOverviewMetrics(set, rangeDays, NOW)
  const breakdownSum = m.categoryBreakdown.reduce((sum, row) => sum + row.count, 0)
  const breakdownResolved = m.categoryBreakdown.reduce((sum, row) => sum + row.resolved, 0)
  const shareSum = m.categoryBreakdown.reduce((sum, row) => sum + row.share, 0)
  const bucketSum = m.dailyCounts.reduce((sum, day) => sum + day.count, 0)

  console.log(`\n── ${rangeDays}-day window, ${set.length} records in the feed ──`)
  console.log(`  Total reports      ${m.totalReports}`)
  console.log(`  Resolved reports   ${m.resolvedReports}`)
  console.log(`  Resolution rate    ${m.resolutionRate}`)
  console.log(
    `  Breakdown          ${
      m.categoryBreakdown
        .map((row) => `${CATEGORY_LABELS[row.category]} ${row.count} (${row.share}%, ${row.resolved} resolved)`)
        .join(', ') || '(empty)'
    }`,
  )

  // 1. The breakdown sums to Total reports. THE REPORTED BUG.
  check('breakdown counts sum to Total reports', breakdownSum === m.totalReports, `${breakdownSum} vs ${m.totalReports}`)

  // 2. Resolved is the same number however it is reached.
  check(
    'breakdown resolved sums to Resolved reports',
    breakdownResolved === m.resolvedReports,
    `${breakdownResolved} vs ${m.resolvedReports}`,
  )
  const rateFromCounts = percentage(m.resolvedReports, m.totalReports)
  check(
    'resolution rate is exactly Resolved / Total',
    m.resolutionRate === (rateFromCounts == null ? 'No data yet' : `${rateFromCounts}%`),
    m.resolutionRate,
  )

  // 3. The volume chart's columns sum to the same total the cards show.
  check('day buckets sum to Total reports', bucketSum === m.totalReports, `${bucketSum} vs ${m.totalReports}`)

  // 4. Rounded shares stay consistent with the counts.
  check(
    'breakdown shares sum to 100% (or 0% on an empty period)',
    shareSum === (m.totalReports ? 100 : 0),
    `${shareSum}%`,
  )

  // 5. No NaN anywhere a percentage is printed.
  const printed = [m.resolutionRate, m.totalDelta?.text, m.resolvedDelta?.text, m.resolutionDelta?.text]
    .filter((value) => value != null)
    .join(' ')
  check('no NaN/Infinity in any printed figure', !/NaN|Infinity/.test(printed), printed || '(nothing to print)')

  // 6. Resolved can never exceed Total.
  check('Resolved <= Total', m.resolvedReports <= m.totalReports)

  // 7. The windowed incident documents are a subset of the window, not a
  //    second query.
  check(
    'incidentsInRange is the window\'s incident half',
    m.incidentsInRange.length === m.inRange.filter((r) => r.source === 'incident').length,
  )

  return m
}

console.log('Admin Overview parity check')

const thirty = report(30)
const seven = report(7)
report(30, [])

console.log('\n── the specific defect this refactor fixed ──')
// Before the refactor the breakdown was computed over incidents only, so its
// sum was short by exactly the number of SOS alerts in the window.
const sosInWindow = thirty.inRange.filter((r) => r.source === 'sos').length
const incidentsOnly = thirty.inRange.length - sosInWindow
console.log(`  SOS alerts in the 30-day window: ${sosInWindow}`)
console.log(`  Old breakdown sum would have been ${incidentsOnly}, beside a Total reports card reading ${thirty.totalReports}`)
check('the old shortfall is real, and is now closed', sosInWindow > 0 && incidentsOnly !== thirty.totalReports)

console.log('\n── normalisation: nothing is silently dropped ──')
// Four spellings of security plus the undated/future ones are excluded by the
// window, not by the taxonomy. Three incidents with no or unknown category and
// one retired category must all be present in Others.
const others = thirty.categoryBreakdown.find((row) => row.category === 'other')
check('casing variants collapse into one slice', thirty.categoryBreakdown.filter((r) => r.category === 'security').length === 1)
check('hazard / missing / unknown categories land in Others', others?.count === 4, `Others = ${others?.count}`)
check('SOS alerts have their own slice', thirty.categoryBreakdown.some((r) => r.category === 'sos'))

console.log('\n── resolved is read off the dispatch stage ──')
const medical = thirty.categoryBreakdown.find((row) => row.category === 'medical')
check(
  'a stale display status does not un-resolve a resolved stage',
  medical?.count === 1 && medical?.resolved === 1,
  `medical: ${medical?.count} reports, ${medical?.resolved} resolved`,
)

console.log('\n── the 7-day window is a strict subset of the 30-day one ──')
check('7-day total <= 30-day total', seven.totalReports <= thirty.totalReports, `${seven.totalReports} vs ${thirty.totalReports}`)
check('7-day window has its own buckets', seven.dailyCounts.length === 7)

console.log(failures ? `\n${failures} invariant(s) FAILED` : '\nAll invariants hold')
process.exit(failures ? 1 : 0)
