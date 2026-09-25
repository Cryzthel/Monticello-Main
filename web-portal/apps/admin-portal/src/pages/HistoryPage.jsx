import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, query, orderBy, limit } from 'firebase/firestore'
import { Trash2, Megaphone, ShieldCheck, Activity } from 'lucide-react'
import AppShell from '@/layouts/AppShell'
import { useWaitWhile } from '@/lib/waitState'
import SectionHeading from '@shared/components/SectionHeading'
import SegmentedControl from '@shared/components/SegmentedControl'
import AuditHistoryTable from '@/components/AuditHistoryTable'
import DeletedReportsTable from '@/components/DeletedReportsTable'
import ArchivedReportsTable from '@/components/ArchivedReportsTable'
import ArchivedActivityTable from '@/components/ArchivedActivityTable'
import SecurityReportDetailModal from '@/components/SecurityReportDetailModal'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { mapIncidentDoc, isDeleted, isArchived } from '@shared/lib/incidents'
import { formatCategory } from '@shared/lib/wpda'
import { ROLE_LABELS } from '@shared/auth/roles'

const VIEWS = [
  { key: 'events', label: 'System events' },
  { key: 'archive', label: 'Archive' },
  { key: 'trash', label: 'Deleted reports' },
]

// Keyed off the view rather than a chain of ternaries. Two views was the limit
// of what `view === 'trash' ? … : …` could express; the third would have made
// every heading a nested conditional.
const ARCHIVE_TABS = [
  { key: 'reports', label: 'Archived reports' },
  { key: 'activity', label: 'Archived activity' },
]

/** How long a feed entry stays live before it belongs to the archive. */
const ACTIVITY_WINDOW_HOURS = 24

const VIEW_TITLES = {
  events: 'System events',
  archive: 'Archive',
  trash: 'Deleted reports',
}

const COUNTS = {
  events: ({ events }) => events.length,
  archive: ({ archivedIncidents, expiredEvents }) =>
    archivedIncidents.length + expiredEvents.length,
  trash: ({ deletedIncidents }) => deletedIncidents.length,
}

const VIEW_DESCRIPTIONS = {
  events: ({ events }) => `${events.length} event${events.length === 1 ? '' : 's'} recorded`,
  archive: ({ archivedIncidents, expiredEvents }) =>
    `${archivedIncidents.length} archived report${archivedIncidents.length === 1 ? '' : 's'} · ${expiredEvents.length} expired activity entr${expiredEvents.length === 1 ? 'y' : 'ies'}`,
  trash: ({ deletedIncidents }) =>
    `${deletedIncidents.length} report${deletedIncidents.length === 1 ? '' : 's'} · select rows to restore or permanently delete`,
}

/**
 * System-wide audit trail, as a data table.
 *
 * Derived from the documents themselves rather than a separate `audit_log`
 * collection: every row is already recorded as a timestamped field on an
 * incident or announcement (`deletedAt`, `resolvedAt`, `dispatchedAt`,
 * `publishedAt`). Reading those is authoritative by construction — a parallel
 * log could silently disagree with the records it claims to describe.
 *
 * The trade-off is that only events the schema already stamps can appear here,
 * and ACTOR is only as good as the name each write recorded. Rows whose source
 * write predates actor stamping show "System" rather than inventing a name.
 * A fuller trail (edits, logins, permission changes) needs a real append-only
 * log written by a Cloud Function, which this table could then merge in.
 */
export default function HistoryPage() {
  const [searchParams] = useSearchParams()

  // ── ?view= OPENS A TAB DIRECTLY ─────────────────────────────────────────
  //
  // The Activity Feed's Archive button links here. Landing on System Events
  // meant a control labelled Archive delivered the audit log and left the
  // admin to find the tab. Initial value only — see the same note on the
  // guardhouse's history page for why this is not synced back to the URL.
  const [view, setView] = useState(() => {
    const requested = searchParams.get('view')
    return VIEWS.some((v) => v.key === requested) ? requested : 'events'
  })

  // Which half of the Archive the admin is looking at. Reports are the records
  // themselves; Activity is the feed entries that aged out of the live panel.
  const [archiveTab, setArchiveTab] = useState(
    () => (searchParams.get('archive') === 'activity' ? 'activity' : 'reports'),
  )
  const [search, setSearch] = useState('')

  /*
   * The report an audit row points at, if any.
   *
   * Every incident-derived row here — dispatched, resolved, deleted — is a
   * sentence ABOUT a report, and until now the sentence was all an admin got:
   * reading "Security report at Phase 2 was resolved" and wanting to know what
   * was in it meant leaving for Security Reports and finding it again by hand.
   *
   * The id is held rather than the object, and the object is resolved from the
   * live snapshot below, so a report that changes while the sheet is open
   * updates in place. That is the same contract
   * [SecurityReportDetailModal] documents for `reportId` vs `report`.
   */
  const [openReportId, setOpenReportId] = useState(null)

  const incidentsQuery = useMemo(() => query(collection(db, 'incidents')), [])
  const { data: rawIncidents, loading } = useLiveCollection(incidentsQuery)
  useWaitWhile(loading, 'Loading the audit archive')

  // Entries an admin has removed from the log. See firestore.rules: the audit
  // trail is derived from document timestamps, so a dismissal is recorded here
  // rather than deleting the incident it was derived from.
  const dismissalsQuery = useMemo(() => query(collection(db, 'audit_dismissals')), [])
  // `error` was previously discarded. A denied read here returns an empty
  // collection rather than throwing, so a dismissal that saved correctly would
  // still let its row reappear — with nothing anywhere to say why.
  const { data: dismissals, error: dismissalsError } = useLiveCollection(dismissalsQuery)
  const dismissedIds = useMemo(() => new Set(dismissals.map((d) => d.id)), [dismissals])

  const announcementsQuery = useMemo(
    () => query(collection(db, 'announcements'), orderBy('publishedAt', 'desc'), limit(50)),
    [],
  )
  const { data: rawAnnouncements } = useLiveCollection(announcementsQuery)

  // Resolves an actor's ROLE. The events carry a display name only, so the role
  // column joins against the staff directory by name/email rather than storing
  // a duplicate role on every incident.
  const staffQuery = useMemo(() => query(collection(db, 'staff_accounts')), [])
  const { data: staff } = useLiveCollection(staffQuery)
  const roleByActor = useMemo(() => {
    const map = new Map()
    staff.forEach((member) => {
      const role = ROLE_LABELS[member.role] ?? member.role ?? ''
      if (member.name) map.set(member.name.toLowerCase(), role)
      if (member.email) map.set(member.email.toLowerCase(), role)
    })
    return map
  }, [staff])

  const resolveRole = (actor) => roleByActor.get((actor ?? '').toLowerCase()) ?? '—'

  const deletedIncidents = useMemo(
    () => rawIncidents.map(mapIncidentDoc).filter(isDeleted),
    [rawIncidents],
  )

  const archivedIncidents = useMemo(
    () =>
      rawIncidents
        .map(mapIncidentDoc)
        .filter((incident) => isArchived(incident) && !isDeleted(incident)),
    [rawIncidents],
  )

  // Resolved from the live snapshot, so an open sheet follows the report. Null
  // while the snapshot has not caught up is a real state, and the sheet draws
  // a skeleton for it rather than an empty box — see the modal's own note.
  const openReport = useMemo(
    () =>
      openReportId
        ? rawIncidents.map(mapIncidentDoc).find((i) => i.id === openReportId) ?? null
        : null,
    [rawIncidents, openReportId],
  )

  const events = useMemo(() => {
    const incidents = rawIncidents.map(mapIncidentDoc)
    const out = []

    incidents.forEach((incident) => {
      const label = formatCategory(incident.category)
      const where = incident.location ?? 'Location not provided'

      if (isDeleted(incident)) {
        out.push({
          id: `del-${incident.id}`,
          reportId: incident.id,
          category: 'Deleted',
          icon: Trash2,
          at: incident.deletedAt,
          actor: incident.deletedByName || 'System',
          description: `${label} report at ${where} was moved to the recycle bin.`,
        })
      }
      if (incident.resolvedAt) {
        out.push({
          id: `res-${incident.id}`,
          reportId: incident.id,
          category: 'Resolved',
          icon: ShieldCheck,
          at: incident.resolvedAt,
          actor: incident.assignedGuardName || 'System',
          description: `${label} report at ${where} was resolved and closed out.`,
        })
      }
      if (incident.dispatchedAt) {
        out.push({
          id: `dis-${incident.id}`,
          reportId: incident.id,
          category: 'Dispatched',
          icon: Activity,
          at: incident.dispatchedAt,
          actor: incident.assignedGuardName || 'System',
          description: `${label} report at ${where} was dispatched.`,
        })
      }
    })

    rawAnnouncements.forEach((a) => {
      const at = a.publishedAt?.toDate ? a.publishedAt.toDate() : a.publishedAt
      out.push({
        id: `ann-${a.id}`,
        category: 'Published',
        icon: Megaphone,
        at: at ? new Date(at) : null,
        actor: a.authorName || 'System',
        description: `“${a.title || 'Announcement'}” was published to the subdivision bulletin.`,
      })
    })

    return out
      .filter((event) => !dismissedIds.has(event.id))
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
  }, [rawIncidents, rawAnnouncements, dismissedIds])

  /**
   * The System-events view, narrowed by ITS OWN search box.
   *
   * ── WHY THIS IS A SECOND LIST ───────────────────────────────────────────
   * The search term used to be applied inside `events` itself, which made one
   * view's search box a filter on the whole page. Two things fell out of that,
   * both wrong:
   *
   *   - The TAB BADGES moved as you typed. A badge answers "how many rows are
   *     in that view", and it was answering "how many rows in that view match
   *     what you are currently typing in a different view".
   *   - The Archive badge became a number that meant nothing at all. It is
   *     `archivedIncidents.length + expiredEvents.length`, and only the second
   *     half was filtered — so it was the sum of an unfiltered count and a
   *     filtered one, which is not a count of anything.
   *
   * ArchivedActivityTable owns its own search box, so it must be handed the
   * whole list and do its own narrowing. Counts now come from `events`, and
   * only the table the search belongs to reads `visibleEvents`.
   */
  const visibleEvents = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return events
    return events.filter((event) =>
      `${event.actor} ${event.category} ${event.description}`.toLowerCase().includes(term),
    )
  }, [events, search])

  // Archived and deleted are different states: archived is a completed record
  // moved out of the working set, deleted is the recycle bin. A report that is
  // both belongs in the bin — that is the more destructive state and the one
  // whose controls an operator needs.
  /**
   * Feed entries that have aged out of the live Activity Feed.
   *
   * ── THE FEED AND THE AUDIT LOG ARE THE SAME EVENTS ─────────────────────
   * Both are derived from the incident documents' own timestamps — there is no
   * `activity_log` collection, and this page already builds exactly the
   * dispatched / resolved / deleted / published entries the feed shows. So
   * "archived activity" is not a separate store to write to; it is the same
   * list past the cutoff the feed stops at.
   *
   * That is what makes the transition automatic. Nothing has to move an entry
   * anywhere at 24 hours: the feed shows one side of the line and this shows
   * the other, from one source, so the two can never disagree about what
   * happened.
   */
  const expiredEvents = useMemo(() => {
    const cutoff = Date.now() - ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000
    return events.filter((event) => {
      const at = event.at ? new Date(event.at).getTime() : NaN
      // An entry with no usable timestamp is kept here rather than in the live
      // feed: the archive is the surface that can afford to hold it.
      return Number.isNaN(at) || at < cutoff
    })
  }, [events])

  return (
    <AppShell
      title="Audit history"
      subtitle="System-wide event archive, including deleted reports."
      scroll={false}
    >
      <div className="flex min-h-0 flex-col gap-4 lg:h-full">
        <SectionHeading
          title={VIEW_TITLES[view] ?? 'System events'}
          description={VIEW_DESCRIPTIONS[view]?.({
            events,
            deletedIncidents,
            archivedIncidents,
            expiredEvents,
          })}
          action={
            <SegmentedControl
              kind="tabs"
              ariaLabel="Audit history views"
              options={VIEWS.map((v) => ({
                value: v.key,
                label: v.label,
                count: COUNTS[v.key]({ events, deletedIncidents, archivedIncidents, expiredEvents }),
              }))}
              value={view}
              onChange={setView}
            />
          }
        />

        {view === 'trash' ? (
          <DeletedReportsTable incidents={deletedIncidents} loading={loading} />
        ) : view === 'archive' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* ── TWO ARCHIVES UNDER ONE TAB ──────────────────────────────
                A report and an event about a report are different records and
                answer different questions — "what was filed" versus "what
                happened, and when". They are siblings here rather than two
                top-level tabs because both are the same act of looking
                something up after it has left the live views. */}
            <SegmentedControl
              ariaLabel="Archive contents"
              className="self-start"
              options={ARCHIVE_TABS.map((t) => ({ value: t.key, label: t.label }))}
              value={archiveTab}
              onChange={setArchiveTab}
            />

            {archiveTab === 'activity' ? (
              <ArchivedActivityTable events={expiredEvents} loading={loading} />
            ) : (
              <ArchivedReportsTable
                incidents={archivedIncidents}
                loading={loading}
                onOpenReport={setOpenReportId}
              />
            )}
          </div>
        ) : (
          <AuditHistoryTable
            events={visibleEvents}
            totalCount={events.length}
            loading={loading}
            readError={dismissalsError}
            resolveRole={resolveRole}
            search={search}
            onSearchChange={setSearch}
            onOpenReport={setOpenReportId}
          />
        )}
      </div>

      {/* The SAME sheet the Security Reports page opens — header badges,
          classification, the response timeline and the responder notes card.
          Reused rather than rebuilt: a second detail view is a second set of
          fields to keep in step, and the two would answer the same question
          differently within a release. */}
      <SecurityReportDetailModal
        reportId={openReportId}
        report={openReport}
        onClose={() => setOpenReportId(null)}
      />
    </AppShell>
  )
}
