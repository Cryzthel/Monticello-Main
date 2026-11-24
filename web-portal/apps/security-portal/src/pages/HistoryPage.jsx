import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppShell from '@/layouts/AppShell'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import SegmentedControl from '@shared/components/SegmentedControl'
import IncidentHistoryTable from '@/components/IncidentHistoryTable'
import IncidentReviewModal from '@/components/IncidentReviewModal'
import { useIncidentStreams } from '@shared/hooks/useIncidentStreams'
import { useEvidencePrefetch } from '@shared/hooks/useEvidencePrefetch'
import { isArchived, isResolvedExpired } from '@shared/lib/incidents'

const SCOPES = [
  { value: 'resident', label: 'Resident reports', empty: 'No resident reports on file.' },
  { value: 'archived', label: 'Archived', empty: 'Nothing has been archived yet.' },
]

/**
 * Incident History — the guardhouse's record of resident reports.
 *
 * ── ONE LIST, THEN A POP-UP ───────────────────────────────────────────────
 * This page used to be a permanent two-column split: a 22rem rail of report
 * cards on the left, a detail card mounted on the right whether or not
 * anything was selected. On arrival — which is most of the time anyone looks
 * at this page — two thirds of the screen read "Select a report to review its
 * evidence and full response record."
 *
 * Now the list IS the page, full width, and reviewing is a deliberate act that
 * opens a modal over it (IncidentReviewModal). The list gets the room to be a
 * real directory with aligned columns; the review gets the room to show a
 * photo and a four-across metadata grid at once. Neither was true before.
 */
export default function HistoryPage() {
  const [selectedId, setSelectedId] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // ── ?scope= OPENS A TAB DIRECTLY ────────────────────────────────────────
  //
  // The Activity Feed's Archive button links here, and "here" is a two-scope
  // page: landing on the default scope meant the control said Archive and
  // delivered the resident queue, leaving the guard to find the tab itself.
  //
  // Read as the INITIAL value rather than synced to the URL. Once the page is
  // open the tabs are the control, and writing every switch back to the
  // address bar would put a history entry behind each one — three taps to
  // leave a page the guard visited once.
  const [scope, setScope] = useState(() => {
    const requested = searchParams.get('scope')
    return SCOPES.some((s) => s.value === requested) ? requested : 'resident'
  })

  // Deep link target for a real-time toast's "Inspect report" action
  // (see useIncidentAlerts). The param is consumed immediately so a later
  // manual close can't be undone by the URL re-selecting the same report.
  const deepLinkId = searchParams.get('incident')
  useEffect(() => {
    if (!deepLinkId) return
    setSelectedId(deepLinkId)
    setSearchParams({}, { replace: true })
  }, [deepLinkId, setSearchParams])

  // ── TWO ARCHIVES, ONE SCREEN ──────────────────────────────────────────────
  //
  // This page used to read `incidents` whole and call itself "every report".
  // That blended a resident's call with an officer's own log entry in one list,
  // and the review beside it renders a panel of the RESIDENT's data — so an
  // officer-filed report was presented with the officer standing in as the
  // resident who reported it.
  //
  // A tab rather than a second page: both are archives, read in the same
  // posture, and a guard checking "did anyone log this" wants to look in one
  // place and switch. Isolated rather than filtered, though — the two never
  // appear in the same list, which is the point.
  const { resident, incidents, loading } = useIncidentStreams()

  const reports = useMemo(() => {
    // ── ARCHIVED REPLACES THE SECURITY-REPORTS TAB ──────────────────────
    //
    // Officer-filed reports have not lost a home: File a Report is where an
    // officer's own log lives, and it is the surface they are filed from. What
    // this page had no view of at all was the other end of the lifecycle —
    // reports that have aged out of the live queues, which is exactly what a
    // guard checking "what happened last week" is looking for.
    //
    // Both halves of "gone from the live views" belong here: explicitly
    // archived reports, and resolved ones past their 24-hour window. Splitting
    // them would make a guard learn which of two mechanisms removed a report
    // before they could find it.
    const rows =
      scope === 'archived'
        ? incidents.filter(
            (incident) => isArchived(incident) || isResolvedExpired(incident),
          )
        : resident.filter(
            (incident) => !isArchived(incident) && !isResolvedExpired(incident),
          )
    // Sorted here rather than in the query the streams hook runs: it serves
    // several surfaces and each wants its own order. The table states this
    // order in its Reported column head rather than offering its own sort,
    // so there is one answer to "what order is this in".
    return [...rows].sort(
      (a, b) => (b.reportedAt?.getTime?.() ?? 0) - (a.reportedAt?.getTime?.() ?? 0),
    )
  }, [scope, resident, incidents])

  // Warm the first evidence photo of each listed report during idle time, so
  // opening one shows a decoded image instead of starting the fetch on click.
  useEvidencePrefetch(reports)

  // Resolved against BOTH streams. A deep link from a toast carries an id and
  // cannot know which scope it belongs to, so scoping this to the visible list
  // would make some notifications open nothing at all.
  //
  // Held by id, not as a captured object, so the open review re-renders from
  // the live snapshot — a note saved from the modal, or a status change made
  // on the dispatch map, shows up here without reselecting the report.
  const selectedReport = incidents.find((report) => report.id === selectedId) ?? null

  const activeScope = SCOPES.find((option) => option.value === scope) ?? SCOPES[0]

  // The scope tabs live in the table's own toolbar rather than above it. They
  // are a filter on the list, the search box beside them is a filter on the
  // list, and putting one inside the panel and the other above it is how a
  // page ends up with two toolbars that mean the same thing.
  const scopeTabs = (
    <SegmentedControl
      kind="tabs"
      ariaLabel="Report source"
      className="shrink-0"
      options={SCOPES}
      value={scope}
      onChange={setScope}
    />
  )

  return (
    <AppShell
      dutyLock={false}
      title="Incident history"
      subtitle="Every resident report on file. Open one to review its evidence and response record."
      topBarSlot={<GuardHeaderActions />}
      scroll={false}
    >
      {/* `h-full` inside the shell's non-scrolling main, rather than the old
          `h-[calc(100vh-8rem)]`: that 8rem was a guess at the header height and
          drifted the moment the header gained a second line of subtitle text,
          pushing the panel past the viewport bottom.

          One child, full width. The `lg:grid-cols-[22rem_1fr]` split that used
          to be here is gone with the detail rail it was holding — the review
          is a modal now, so there is nothing to reserve a column for. */}
      <div className="min-h-0 lg:h-full">
        <IncidentHistoryTable
          reports={reports}
          filterSlot={scopeTabs}
          emptyLabel={activeScope.empty}
          loading={loading}
          onSelect={(report) => setSelectedId(report.id)}
        />
      </div>

      <IncidentReviewModal report={selectedReport} onClose={() => setSelectedId(null)} />
    </AppShell>
  )
}
