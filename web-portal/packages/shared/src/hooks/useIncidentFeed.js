import { useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { mapIncidentDoc, isDeleted, isResolvedExpired } from '@shared/lib/incidents'

/**
 * The incident collection, live, mapped, and with deleted reports removed.
 *
 * ── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 * Deletion in this portal is a SOFT delete: `softDeleteIncidents` stamps
 * `deletedAt` and leaves the document in place, so a deleted report keeps
 * arriving through `onSnapshot` like any other. Every surface therefore has to
 * opt OUT of it, and only three did — Tickets, History and Security Reports.
 *
 * The Overview did not. Deleting a report removed it from the tickets table and
 * left it counted in Total Incidents, in Resolution Rate, in Active Incidents
 * and in the category donut, on a page whose entire job is to state how many
 * incidents there are. The numbers were live and wrong, which is worse than
 * stale and wrong: they updated confidently on every other edit, so there was
 * nothing to suggest the delete had not landed.
 *
 * Making exclusion the DEFAULT — rather than one more filter each page
 * remembers — is the fix. A caller that genuinely wants deleted reports (the
 * History page's restore table) takes `all` and says so.
 *
 * Archived reports are NOT excluded. Archiving is a review-workflow state for
 * guard-filed reports and explicitly does not mean deletion (see `archiveIncidents`);
 * an archived incident still happened and still counts.
 */
export function useIncidentFeed() {
  const incidentsQuery = useMemo(() => query(collection(db, 'incidents')), [])
  const { data, loading, error } = useLiveCollection(incidentsQuery)

  const all = useMemo(() => data.map(mapIncidentDoc), [data])
  const incidents = useMemo(() => all.filter((incident) => !isDeleted(incident)), [all])

  /**
   * The WORKING set: everything `incidents` holds, minus reports resolved more
   * than a day ago.
   *
   * ── WHY THIS IS A THIRD LIST AND NOT THE NEW DEFAULT ───────────────────
   * Deleted reports are excluded by default because no surface wants them
   * without asking. Expired ones are different: Incident History and the
   * metrics pages are BUILT on resolved reports, and folding the cutoff into
   * `incidents` would have emptied a month of analytics and made the history
   * page show only yesterday. The rule belongs to live queues and maps, so it
   * is those that opt in.
   */
  const active = useMemo(
    () => incidents.filter((incident) => !isResolvedExpired(incident)),
    [incidents],
  )

  return { incidents, active, all, loading, error }
}
