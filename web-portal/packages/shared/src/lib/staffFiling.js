/**
 * Was this report filed by an officer, or by a resident?
 *
 * Pure, and deliberately in its own module rather than beside the hook that
 * supplies the id set: the answer is needed by a presentational component
 * (ActionFeed), and importing it from `useStaffAccounts` would drag the
 * Firebase SDK into that component's import graph to evaluate one comparison.
 *
 * Authorship is a JOIN, not a field. The mobile app and the guard's report
 * composer write the same `incidents` shape — same collection, same schema —
 * and differ only in whose uid lands in `reporterUid`. Adding a marker field
 * would flag reports written after the change and leave the whole existing
 * backlog looking resident-filed, so the join is the only answer that is
 * correct for data already in the database.
 */
export function isOfficerFiled(incident, staffIds) {
  return Boolean(incident?.reporterUid) && Boolean(staffIds?.has(incident.reporterUid))
}
