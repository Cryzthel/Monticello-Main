/**
 * Every figure the Admin Overview shows, derived from ONE array.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The Overview already read its data through a single hook (`usePortalMetrics`)
 * and still showed numbers that disagreed, because "one hook" was never the
 * problem. The problem is that a hook can hand out several arrays, and a widget
 * that counts a DIFFERENT array from the card above it will disagree with that
 * card forever, however live both of them are.
 *
 * The specific disagreement that was reported:
 *
 *   Total reports      = incidents in the window + SOS alerts in the window
 *   Resolved reports   = the same two sets, resolved
 *   Category breakdown = incidents in the window ONLY
 *   "N in range"       = a THIRD count, re-summed from the volume chart's
 *                        midnight day buckets
 *
 * So on any estate with a single SOS alert in the period, the donut's slices
 * summed to one less than the Total reports card beside them, and its caption
 * ("N incidents categorized in this timeframe") stated that smaller number as
 * a fact. The previous code knew: "Kept out of `inRange` itself: the volume
 * chart and category donut are about incident categories, and an SOS has none."
 * That is a reason for an SOS to have no category, not a reason for it to be
 * counted in the headline and dropped from the chart that explains it.
 *
 * ── THE FIX IS A SHAPE, NOT A FILTER ────────────────────────────────────────
 * Incidents and SOS alerts are projected into one REPORT RECORD, and after that
 * nothing downstream knows or cares which collection a row came from. Totals,
 * resolved, the breakdown, the day buckets and the recent-activity count are
 * all `records.filter(...).length` over the same array. A figure can no longer
 * be computed from a different population than the figure next to it, because
 * there is only one population.
 *
 * An SOS gets the `sos` category bucket (see incidentCategories.js), which is
 * what makes the breakdown sum to the total exactly rather than approximately.
 *
 * ── PURE, AND DELIBERATELY FIREBASE-FREE ───────────────────────────────────
 * Nothing here imports the SDK, so the parity claims this module makes can be
 * exercised in Node against fixtures — see scripts/check-overview-parity.mjs,
 * which is how "the breakdown sums to the total" is demonstrated rather than
 * asserted in a comment. `selectInRange` and `computeDailyCounts` MOVED here
 * from incidents.js for that reason and are re-exported from there, so the one
 * windowing rule is still the one windowing rule.
 */

// RELATIVE, not the usual `@shared/lib/...` alias, and deliberately so: the
// alias is a Vite resolution that plain Node knows nothing about, and a module
// whose parity claims cannot be run outside a browser build is a module whose
// parity claims are back to being prose. Same directory, same file; the only
// thing the relative form costs is consistency with its neighbours, and the
// only thing it buys is `node scripts/check-overview-parity.mjs`.
import { INCIDENT_CATEGORIES, SOS_CATEGORY, normalizeCategory } from './incidentCategories.js'

/**
 * ── THE ONE DEFINITION OF "RESOLVED" ───────────────────────────────────────
 *
 * An incident's state is layered, and the two layers are not interchangeable:
 *
 *   status         the five wire values the resident app reads, mapped to a
 *                  display label by STATUS_TO_DISPLAY. Distinguishes Pending
 *                  from Verified, which the stage does not.
 *   dispatchStage  the three-stage machine firestore.rules enforces as whole
 *                  transitions (see dispatchStage.js).
 *
 * Resolved is read off the STAGE. For every document that has no stored
 * `dispatchStage` the two are already identical — `deriveDispatchStage` folds
 * the same three wire values (`resolved`, `closed`, `false_alarm`) into the
 * `resolved` stage that `STATUS_TO_DISPLAY` folds into the `Resolved` label —
 * so this changes no existing count. Where a stored stage and a stale `status`
 * DO disagree, the stage is the field the rules validated, and the console's
 * own dispatch UI is already reading it. One field, asked one way.
 *
 * Note what this is not: it is not `status !== 'Resolved'` and it is not
 * `ACTIVE_STATUSES.has(status)`. Both of those expressions were live in the
 * metrics hook at the same time, meaning the same thing by two routes.
 */
export function isResolvedStage(stage) {
  return stage === 'resolved'
}

/** Resolved, for a mapped incident (one that has been through mapIncidentDoc). */
export function isResolvedIncident(incident) {
  return isResolvedStage(incident?.dispatchStage)
}

/**
 * A report record — the single shape every Overview figure counts.
 *
 * `reportedAt` is a Date or null. A record with no usable timestamp cannot be
 * placed in a window and is dropped by `selectInRange`, which is the only
 * exclusion in this module that is not spelled out on screen. It is also the
 * old behaviour and the right one: a report with no time is not evidence about
 * any particular period.
 */
function toRecord({ id, source, reportedAt, category, resolved, doc }) {
  const at = reportedAt ? new Date(reportedAt) : null
  return {
    id,
    source,
    // The document this record was projected from.
    //
    // ── WHY THE RECORD CARRIES ITS SOURCE DOCUMENT ───────────────────────
    // A record holds only what the arithmetic needs, so a TABLE cannot be
    // built from one, and two surfaces still need the documents windowed: the
    // Overview's recent-activity table and System Metrics' phase hot-spots,
    // which reads a `phase` field no record has. Those could each window the
    // incidents array again - and a second windowing call, however identical
    // its rule, is the shape this whole refactor exists to remove. Keeping the
    // document on the record means `selectIncidentDocs` below is a projection
    // of the ONE window rather than a second one.
    doc,
    reportedAt: at && !Number.isNaN(at.getTime()) ? at : null,
    // Normalised ONCE, here. Every consumer downstream receives a canonical
    // key, so no widget can re-bucket a raw Firestore string and end up with
    // a 'Security' slice beside a 'security' one.
    category: normalizeCategory(category),
    resolved: Boolean(resolved),
  }
}

/** A mapped incident document as a report record. */
export function incidentAsReport(incident) {
  return toRecord({
    id: incident.id,
    source: 'incident',
    reportedAt: incident.reportedAt,
    category: incident.category,
    resolved: isResolvedIncident(incident),
    doc: incident,
  })
}

/**
 * The incident DOCUMENTS inside an already-windowed set of records.
 *
 * A projection of the one window, not a second window. See `doc` on the record
 * for why that distinction is the point.
 */
export function selectIncidentDocs(records) {
  return records.filter((record) => record.source === 'incident').map((record) => record.doc)
}

/**
 * A panic alert as a report record.
 *
 * ── SOS ALERTS COUNT AS REPORTS (2026-10-29, by request) ───────────────────
 * An emergency raised from the app is a report like any other: it feeds Total
 * reports, and once resolved it feeds Resolved reports, in the same snapshot
 * that moves it off the live SOS list. Windowed by when it was RAISED, exactly
 * as an incident is windowed by when it was filed.
 *
 * `resolved` is the inverse of `isPanicLive`, which the caller supplies — the
 * panic vocabulary reads any status it does not recognise as a LIVE emergency
 * (panicStatus.js explains why that asymmetry is deliberate), and this module
 * must not quietly adopt the opposite default by testing for `'resolved'`
 * itself.
 *
 * The category is `sos`. That is the whole reason the breakdown can sum to the
 * total: an SOS has no incident category, but it cannot be allowed to have NO
 * bucket while it is being counted in the headline.
 */
export function panicAlertAsReport(alert, { live }) {
  return toRecord({
    id: alert.id,
    source: 'sos',
    reportedAt: alert.createdAt,
    category: SOS_CATEGORY,
    resolved: !live,
    doc: alert,
  })
}

/**
 * The records that fall inside a timeframe — the ONE windowing rule.
 *
 * Moved here from incidents.js unchanged (and re-exported from there, so every
 * existing import keeps working). It was always pure; it only lived next to the
 * Firebase writes because that is where the first caller was.
 *
 * [offsetDays] shifts the window backwards by whole periods, which is what the
 * "vs. previous period" deltas compare against: `offsetDays = days` gives the
 * period immediately before this one.
 *
 * Half-open at the start and inclusive at the end (`> start && <= end`) so two
 * adjacent windows never both claim the same record.
 *
 * [now] pins the window's end. A caller that memoises the result should pass a
 * value that ticks, or the window stops moving whenever the data does.
 */
export function selectInRange(records, days, offsetDays = 0, now = Date.now()) {
  if (!Number.isFinite(days)) return [...records]
  const end = now - offsetDays * 86400000
  const start = end - days * 86400000
  return records.filter((record) => {
    if (!record.reportedAt) return false
    const ms = new Date(record.reportedAt).getTime()
    if (Number.isNaN(ms)) return false
    return ms > start && ms <= end
  })
}

/**
 * Per-day counts for the volume chart.
 *
 * ── WHY THE BUCKETS CLAMP, AND WHY THAT IS NOT A FUDGE ─────────────────────
 * `selectInRange` measures a rolling window in milliseconds ending at `now`.
 * These buckets are LOCAL MIDNIGHTS, because a chart whose columns are not days
 * is unreadable. The two spans therefore cannot coincide: at noon, a 30-day
 * rolling window reaches back 29.5 days past the oldest midnight bucket, so a
 * report filed in that half-day was counted by the KPI card and drawn by no
 * column — and the chart's own "N in range" caption, which used to re-sum these
 * buckets, stated that smaller number.
 *
 * A record that is inside the window but older than the first bucket is counted
 * in the first bucket. The alternative is to drop it, and dropping it is what
 * made the caption disagree with the card. The caption is no longer derived
 * here at all (the page passes the authoritative count down), so the clamp's
 * only effect is that the leftmost column of a 30-day view can carry up to a
 * half-day of extra reports — visible, bounded, and preferable to a chart whose
 * columns sum to less than the total printed above them.
 *
 * Pass the same `now` the window used, or the buckets and the window drift
 * apart again on a page that has been open since before midnight.
 */
export function computeDailyCounts(records, days, now = Date.now()) {
  // `selectInRange` treats a non-finite `days` as "no window at all" and
  // returns everything. There is no such timeframe pill today (7d/30d/6m/1yr),
  // but a day-bucket loop given Infinity does not return, so the two have to
  // agree about what an unbounded range means here: no buckets, and a volume
  // chart with nothing to draw, rather than a hung tab.
  const buckets = []
  if (!Number.isFinite(days) || days <= 0) return buckets
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - i)
    buckets.push({ date: day, count: 0 })
  }
  if (!buckets.length) return buckets

  records.forEach((record) => {
    if (!record.reportedAt) return
    const reportedDay = new Date(record.reportedAt)
    if (Number.isNaN(reportedDay.getTime())) return
    reportedDay.setHours(0, 0, 0, 0)
    const at = reportedDay.getTime()
    // Clamped at the old end only. A record NEWER than the last bucket is a
    // future timestamp: `selectInRange` has already refused it, so anything
    // reaching here past the last bucket is a caller passing an unwindowed
    // array, and silently drawing it on today's column would be a lie.
    if (at < buckets[0].date.getTime()) {
      buckets[0].count += 1
      return
    }
    const bucket = buckets.find((b) => b.date.getTime() === at)
    if (bucket) bucket.count += 1
  })

  return buckets
}

/**
 * Rounded percentages that sum to exactly 100.
 *
 * ── WHY NOT Math.round PER ROW ─────────────────────────────────────────────
 * Independent rounding does not preserve the total: three equal slices round to
 * 33% each and a legend that adds up to 99%. Largest remainder gives every row
 * the percentage it is owed and hands the leftover points to the rows that were
 * rounded down hardest, so the printed shares sum to 100 whenever the counts
 * sum to the total — which is the whole claim this page is making.
 *
 * A zero total yields zero shares, not NaN. Every percentage on this page goes
 * through here or through `percentage` below; there is no bare division left.
 */
function largestRemainderShares(counts, total) {
  if (!total) return counts.map(() => 0)
  const exact = counts.map((count) => (count / total) * 100)
  const floors = exact.map((value) => Math.floor(value))
  let remaining = 100 - floors.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  const shares = [...floors]
  for (let i = 0; i < order.length && remaining > 0; i += 1) {
    shares[order[i].index] += 1
    remaining -= 1
  }
  return shares
}

/**
 * A whole-number percentage, or null when there is nothing to take a share of.
 *
 * Null rather than 0: "0%" is a measurement and an empty period has not made
 * one. Callers render the difference ("No data yet"), which is what stops a
 * fresh estate from being told its resolution rate is zero.
 */
export function percentage(part, total) {
  if (!total) return null
  return Math.round((part / total) * 100)
}

/**
 * Counts per category over one set of records, plus each bucket's resolved
 * count and its share of the set.
 *
 * Zero-count categories are omitted: the taxonomy is the set of buckets a count
 * CAN land in, not a set of rows the chart must always draw. Sorted by count
 * desc, then by canonical order, so equal counts hold still between renders
 * instead of swapping places on every snapshot.
 *
 * Because `toRecord` normalised the key and `normalizeCategory` routes anything
 * unrecognised into `other`, no record can fail to land in a bucket. That is
 * the invariant the parity script checks.
 */
export function computeBreakdown(records) {
  const counts = new Map()
  records.forEach((record) => {
    const key = record.category
    const bucket = counts.get(key) ?? { count: 0, resolved: 0 }
    bucket.count += 1
    if (record.resolved) bucket.resolved += 1
    counts.set(key, bucket)
  })

  const rows = [...counts.entries()]
    .map(([category, bucket]) => ({ category, ...bucket }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        INCIDENT_CATEGORIES.indexOf(a.category) - INCIDENT_CATEGORIES.indexOf(b.category),
    )

  const shares = largestRemainderShares(
    rows.map((row) => row.count),
    records.length,
  )
  return rows.map((row, index) => ({ ...row, share: shares[index] }))
}

/**
 * A period-over-period change, as the KPI chip needs it.
 *
 * `direction` is what the figure DID and `tone` is whether that is good news.
 * They come apart on any lower-is-better figure, and keeping them as separate
 * fields is what lets such a card render a green arrow pointing down. See
 * KpiCard.
 *
 * Null when the previous period had nothing to compare against — a delta
 * against zero is not a percentage, and printing `Infinity%` or `NaN%` is the
 * failure this returns null to avoid.
 */
export function formatDelta(current, previous, { lowerIsBetter = false } = {}) {
  if (!previous) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  const rose = pct >= 0
  return {
    text: `${rose ? '+' : ''}${pct}%`,
    direction: rose ? 'up' : 'down',
    tone: (lowerIsBetter ? !rose : rose) ? 'positive' : 'negative',
  }
}

/**
 * EVERY Overview figure, from one array of report records.
 *
 * Returns the windowed array alongside the counts deliberately: the widgets
 * that draw a distribution (the volume chart) get the SAME array the totals
 * were counted from, rather than a second query shaped to look like it.
 *
 * `records` is expected to be the whole unfiltered history — incidents and SOS
 * alerts, soft-deleted rows already removed by `useIncidentFeed`. Archived rows
 * are deliberately still in it: archiving is a review state and explicitly not
 * a deletion (see `archiveIncidents`), so an archived incident still happened
 * and still counts. That is true of every number on the page, which is the only
 * thing that matters — an archived report is counted in the total, in the
 * breakdown and in the resolution rate, or in none of them.
 */
export function computeOverviewMetrics(records, rangeDays, now = Date.now()) {
  const inRange = selectInRange(records, rangeDays, 0, now)
  const previous = selectInRange(records, rangeDays, rangeDays, now)

  const total = inRange.length
  const previousTotal = previous.length
  const resolved = inRange.filter((record) => record.resolved).length
  const previousResolved = previous.filter((record) => record.resolved).length

  const rate = percentage(resolved, total)
  const previousRate = percentage(previousResolved, previousTotal)

  return {
    // The windowed population itself. Every count below is a filter over this
    // and nothing else.
    inRange,
    // The incident documents inside that same window, for the two surfaces
    // that need documents rather than counts. A projection, not a re-query.
    incidentsInRange: selectIncidentDocs(inRange),
    dailyCounts: computeDailyCounts(inRange, rangeDays, now),
    categoryBreakdown: computeBreakdown(inRange),

    totalReports: total,
    totalDelta: formatDelta(total, previousTotal),

    resolvedReports: resolved,
    resolvedDelta: formatDelta(resolved, previousResolved),

    // `rate` is null only when `total` is 0, in which case the two counts above
    // are 0 as well — so the card showing "No data yet" is never beside a card
    // showing a count.
    resolutionRate: rate == null ? 'No data yet' : `${rate}%`,
    resolutionDelta: rate == null || previousRate == null ? null : formatDelta(rate, previousRate),
  }
}
