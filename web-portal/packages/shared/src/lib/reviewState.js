/**
 * The admin review axis: has an administrator looked at this report yet?
 *
 * Pure and dependency-free, so it can be exercised without initialising
 * Firebase — `incidents.js` re-exports it for existing callers.
 *
 * ── TWO STATES, AND ONLY ONE THING DECIDES THEM ───────────────────────────
 * Review is one timestamp, not an enum. "Reviewed" is simply "reviewedAt is
 * set", so there is no state machine to fall out of step with itself.
 *
 * This used to return three labels, and the first branch was the bug:
 *
 *     if (incident?.status === 'Resolved') return 'Resolved'
 *
 * That let the DISPATCH axis overwrite the REVIEW axis. A report a guard closed
 * on the ground reported itself as reviewed when no administrator had opened
 * it — so the backlog count shrank on its own, and the one number an admin uses
 * to know what is still owed their attention quietly understated it.
 *
 * A report is Pending until an administrator presses Review. Nothing a guard
 * does on the ground moves it, because reviewing is not something a guard can
 * do.
 */
export const REVIEW_PENDING = 'Pending'
export const REVIEW_DONE = 'Reviewed'

export function reviewState(incident) {
  return incident?.reviewedAt ? REVIEW_DONE : REVIEW_PENDING
}

export const REVIEW_TONES = {
  [REVIEW_PENDING]: 'warning',
  [REVIEW_DONE]: 'success',
}
