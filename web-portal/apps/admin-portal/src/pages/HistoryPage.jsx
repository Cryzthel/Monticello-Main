import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, query, orderBy, limit } from 'firebase/firestore'
import { Trash2, Megaphone, ShieldCheck, Activity, SlidersHorizontal } from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import { useWaitWhile } from '@/lib/waitState'
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
import { SETTINGS_CHANGES } from '@/lib/settingsChanges'

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

const COUNTS = {
  events: ({ events }) => events.length,
  archive: ({ archivedIncidents, expiredEvents }) =>
    archivedIncidents.length + expiredEvents.length,
  trash: ({ deletedIncidents }) => deletedIncidents.length,
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

  // Confirmed saves on Admin › Settings — a real append-only log, unlike the
  // rows above, because a settings document keeps no history of its own.
  const settingsChangesQuery = useMemo(
    () => query(collection(db, SETTINGS_CHANGES), orderBy('at', 'desc'), limit(50)),
    [],
  )
  const { data: rawSettingsChanges } = useLiveCollection(settingsChangesQuery)

  /**
   * Resolves an event's actor to a ROLE, by UID first.
   *
   * ── WHY THE COLUMN WAS BLANK ───────────────────────────────────────────
   * The join was by DISPLAY NAME against staff_accounts name/email. Incidents
   * store whatever name the workflow had to hand ("Officer Reyes", an email,
   * a Google display name), staff records often have no `name` at all, and
   * any mismatch rendered "—". Most rows were dashes.
   *
   * Every event now carries the actor's UID where the document records one
   * (deletedBy, resolvedBy, dispatchedByUid, assignedGuardUid, authorUid),
   * and staff_accounts is keyed BY uid, so the lookup cannot miss on spelling.
   * Name/email stays as the fallback for records written before UIDs were
   * stamped. "System" is a real answer for automated events, not a blank.
   */
  const staffQuery = useMemo(() => query(collection(db, 'staff_accounts')), [])
  const { data: staff } = useLiveCollection(staffQuery)
  const staffIndex = useMemo(() => {
    const byUid = new Map()
    const byName = new Map()
    staff.forEach((member) => {
      if (!member.role) return
      byUid.set(member.id, member.role)
      if (member.name) byName.set(member.name.trim().toLowerCase(), member.role)
      if (member.email) byName.set(member.email.trim().toLowerCase(), member.role)
    })
    return { byUid, byName }
  }, [staff])

  /** `{ key, label }` — key drives the badge tone. */
  const resolveRole = (event) => {
    const key =
      (event.actorUid && staffIndex.byUid.get(event.actorUid)) ||
      staffIndex.byName.get((event.actor ?? '').trim().toLowerCase())
    if (key) return { key, label: ROLE_LABELS[key] ?? key }
    if (!event.actor || event.actor === 'System') return { key: 'system', label: 'System' }
    // A named actor with no staff record: a resident, or an account since
    // removed. Said, rather than left blank.
    return { key: 'unknown', label: 'Not staff' }
  }

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
          actorUid: incident.deletedBy || null,
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
          actorUid: incident.resolvedBy || incident.assignedGuardUid || null,
          actor: incident.resolvedByName || incident.assignedGuardName || 'System',
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
          actorUid: incident.dispatchedByUid || incident.assignedGuardUid || null,
          actor: incident.dispatchedByName || incident.assignedGuardName || 'System',
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
        actorUid: a.authorUid || null,
        actor: a.authorName || 'System',
        description: `“${a.title || 'Announcement'}” was published to the subdivision bulletin.`,
      })
    })

    rawSettingsChanges.forEach((entry) => {
      const at = entry.at?.toDate ? entry.at.toDate() : entry.at
      const changes = Array.isArray(entry.changes) ? entry.changes : []
      out.push({
        id: `set-${entry.id}`,
        category: 'Settings',
        icon: SlidersHorizontal,
        at: at ? new Date(at) : null,
        actorUid: entry.actorUid || null,
        actor: entry.actorName || 'System',
        description: `Settings changed: ${changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join('; ') || 'no field recorded'}.`,
      })
    })

    return out
      .filter((event) => !dismissedIds.has(event.id))
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
  }, [rawIncidents, rawAnnouncements, rawSettingsChanges, dismissedIds])

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
        {/* No heading above the tabs (2026-10-19, by request): "System
            events · 12 events recorded" only repeated the selected tab's own
            label and count. The tabs are the view switcher and the summary. */}
        <SegmentedControl
          kind="tabs"
          ariaLabel="Audit history views"
          className="shrink-0 self-start"
          options={VIEWS.map((v) => ({
            value: v.key,
            label: v.label,
            count: COUNTS[v.key]({ events, deletedIncidents, archivedIncidents, expiredEvents }),
          }))}
          value={view}
          onChange={setView}
        />

        {view === 'trash' ? (
          <DeletedReportsTable incidents={deletedIncidents} loading={loading} onOpenReport={setOpenReportId} />
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
