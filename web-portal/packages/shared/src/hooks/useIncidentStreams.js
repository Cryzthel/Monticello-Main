import { useMemo } from 'react'
import { useIncidentFeed } from '@shared/hooks/useIncidentFeed'
import { useStaffAccounts } from '@shared/hooks/useStaffAccounts'
import { isOfficerFiled } from '@shared/lib/staffFiling'
import { isResolvedExpired } from '@shared/lib/incidents'

/**
 * The incident collection split into its two populations, live.
 *
 * ── WHY THESE ARE TWO STREAMS AND NOT ONE LIST WITH A FLAG ────────────────
 * A report a resident files and a report an officer files are the same
 * Firestore shape and, until now, the same queue. They are not the same thing.
 * One is a request FROM the community that the guardhouse owes a response to;
 * the other is the guardhouse's own record of something it did or saw. Blending
 * them means a resident's open call and an officer's log entry compete for the
 * same operator attention, and every count of "incidents" silently double-books
 * the team's own paperwork as community demand.
 *
 * Authorship is a JOIN, not a field — `reporterUid` against `staff_accounts`
 * (see staffFiling.js). There is no marker on the document, and adding one
 * would only classify reports written after the change.
 *
 * ── THE PARTITION MUST NOT BE GUESSED AT ──────────────────────────────────
 * This is the part worth being careful about. `staff_accounts` is its own
 * subscription and resolves on its own schedule, so for the first frames after
 * mount the id set is EMPTY — and against an empty set `isOfficerFiled` answers
 * false for everybody. A naive split would therefore open with every security
 * report sitting in the resident queue, which is precisely the blending this
 * exists to prevent, and it would look correct because the rows are real.
 *
 * So the split is withheld until the set has actually loaded: both streams are
 * empty while `staffLoading`, and the tables render their own empty state for
 * that moment. A blank list for a beat is recoverable; an operator who saw a
 * security log entry in the resident queue and acted on it is not.
 */
export function useIncidentStreams() {
  const { incidents, active, all, loading: incidentsLoading, error } = useIncidentFeed()
  const { staffIds, loading: staffLoading } = useStaffAccounts()

  const [resident, security] = useMemo(() => {
    if (staffLoading) return [[], []]
    const residentRows = []
    const securityRows = []
    incidents.forEach((incident) => {
      if (isOfficerFiled(incident, staffIds)) securityRows.push(incident)
      else residentRows.push(incident)
    })
    return [residentRows, securityRows]
  }, [incidents, staffIds, staffLoading])

  // The same split over the WORKING set — resolved reports older than a day
  // dropped. Derived from `resident` rather than re-partitioning, so the two
  // lists cannot disagree about which population a report belongs to.
  const residentActive = useMemo(
    () => resident.filter((incident) => !isResolvedExpired(incident)),
    [resident],
  )

  return {
    /** Resident-filed, soft-deleted excluded. Includes long-closed reports. */
    resident,
    /**
     * Resident-filed, minus reports resolved more than a day ago.
     *
     * What a LIVE surface wants — the ticket queues and the dispatch map. A
     * report closed last week is a record, and records are in Incident History
     * and the admin archive. See isResolvedExpired.
     */
    residentActive,
    /** Every population, working set only. For maps that plot both. */
    active,
    /** Officer-filed, soft-deleted excluded. The segregated view. */
    security,
    /**
     * Both populations together, soft-deleted excluded.
     *
     * For resolving a deep link, NOT for rendering a queue. A toast's "View
     * incident" carries an id and cannot know which stream it lands in, so the
     * detail modal resolves against this — otherwise following a notification
     * about an officer-filed report would open nothing at all, silently.
     */
    incidents,
    /** Including soft-deleted. Audit surfaces only. */
    all,
    staffIds,
    loading: incidentsLoading || staffLoading,
    error,
  }
}
