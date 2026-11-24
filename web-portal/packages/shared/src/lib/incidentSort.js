import { computePriorityScore } from '@shared/lib/wpda'

/**
 * How the incident queue is ordered.
 *
 * Two axes, four orderings: when a report arrived, and how dangerous the WPDA
 * model thinks it is.
 *
 * ── ORDERING BY A SCORE THE TABLE NO LONGER PRINTS ────────────────────────
 * The WPDA column is gone from the incident table — the algorithm runs
 * server-side and the numeric readout was clutter. These two orderings stay,
 * which is a deliberate split rather than an oversight, and it is worth being
 * precise about why it is safe here when it would not be for a sort over,
 * say, an unprinted timestamp.
 *
 * The queue is not silent about danger just because the number is hidden. Every
 * row still carries a priority badge, and WPDA is category weight × urgency +
 * minutes waiting — so "Highest WPDA" surfaces critical and long-waiting rows
 * to the top, and the badges visibly bunch there. An operator can see the sort
 * worked; what they no longer see is the arithmetic behind it, which is the
 * part that was never actionable.
 *
 * ── WHAT THE SCORE IS ─────────────────────────────────────────────────────
 * It rises as a report ages. That is a feature for a queue (an ignored critical
 * climbs) and a caveat for a sort: the order is only stable for as long as the
 * snapshot is. Two reports a minute apart can swap places on the next tick.
 * Chronological remains the default for that reason.
 *
 * The client score is an ESTIMATE. The authoritative one is `wpdaScore`, which
 * the `onIncidentWrite` Cloud Function stamps server-side; where a document has
 * it, that value wins — see `scoreOf`.
 */

function timeOf(incident) {
  const value = incident?.reportedAt
  if (!value) return 0
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * The score to sort and badge by.
 *
 * Prefers the server's `wpdaScore` so the dashboard ranks on the same number
 * the backend does. Falls back to the client computation for documents written
 * before that function existed, or in the instant between a create and the
 * trigger firing — without the fallback those rows would sort as 0 and pile up
 * at the bottom of a "highest first" list, which is the opposite of correct for
 * a brand-new report.
 */
export function scoreOf(incident) {
  const stored = incident?.wpdaScore
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored
  return computePriorityScore(incident)
}

/**
 * The orderings, named by what they MEAN rather than by direction — "Newest
 * first" is what an operator is choosing; "desc" is an implementation detail
 * they should never have to translate.
 */
export const SORT_OPTIONS = [
  // "Newest" / "Oldest", not "Newest first" — the control is already prefixed
  // with a sort glyph and sits in a row of filters, so "first" was a word doing
  // no work. The WPDA pair keeps its qualifier because "Highest" alone would
  // not say highest WHAT — and with the column gone, the label is now the only
  // place the word appears in the table at all.
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'wpda-high', label: 'Highest WPDA' },
  { value: 'wpda-low', label: 'Lowest WPDA' },
]

export const DEFAULT_SORT = 'newest'

const COMPARATORS = {
  newest: (a, b) => timeOf(b) - timeOf(a),
  oldest: (a, b) => timeOf(a) - timeOf(b),
  // Tie-broken by recency so equal scores do not shuffle between snapshots.
  // `Array.prototype.sort` is stable within one call but the input arrives in a
  // different order each time Firestore pushes, so without this a queue would
  // visibly reorder under the operator on every tick.
  'wpda-high': (a, b) => scoreOf(b) - scoreOf(a) || timeOf(b) - timeOf(a),
  'wpda-low': (a, b) => scoreOf(a) - scoreOf(b) || timeOf(b) - timeOf(a),
}

/**
 * Sorted copy of [incidents]. Never mutates its input — callers pass memoised
 * arrays derived from a live Firestore snapshot, and sorting one in place would
 * reorder the source behind every other consumer of it.
 */
export function applyIncidentSort(incidents, order = DEFAULT_SORT) {
  const compare = COMPARATORS[order] ?? COMPARATORS[DEFAULT_SORT]
  return [...incidents].sort(compare)
}
