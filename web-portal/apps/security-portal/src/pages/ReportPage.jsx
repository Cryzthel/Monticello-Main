import { toast } from '@shared/lib/toast'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, query } from 'firebase/firestore'
import { Plus } from '@shared/icons'
import SectionHeading from '@shared/components/SectionHeading'
import IncidentTicketDetailsModal from '@/components/IncidentTicketDetailsModal'
import ErrorBoundary from '@shared/components/ErrorBoundary'
import PageErrorFallback from '@/components/PageErrorFallback'
import AppShell from '@/layouts/AppShell'
import GuardHeaderActions from '@/components/GuardHeaderActions'
import FiledReportsTable from '@/components/FiledReportsTable'
import FileReportModal from '@/components/FileReportModal'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useEvidencePrefetch } from '@shared/hooks/useEvidencePrefetch'
import { useAuth } from '@shared/auth/AuthContext'
import { db } from '@shared/lib/firebase'
import { isDeleted, mapIncidentDoc } from '@shared/lib/incidents'

/**
 * File a Report — the officer's own record, feed first.
 *
 *   Filed reports  ·  N active · N archived      [ + File Incident Report ]
 *   ┌─ tabs · search · category chips ─────────────────────────────────────┐
 *   ├─ submitted by · date · location · category · status · view ─────────┤
 *   └──────────────────────────────────────────────────────────────────────┘
 *                    ↓ File Incident Report        FileReportModal (dialog)
 *
 * ── WHY THE FORM IS NOT THE PAGE ANY MORE ─────────────────────────────────
 * This opened on an empty form in a 27rem rail, with what had already been
 * filed squeezed into the column beside it. That put the page's rarest action
 * in its most prominent position: a guard files a report at the end of a call,
 * maybe twice a shift, and spends the rest of the shift checking whether the
 * ones they filed were picked up. Opening on a blank form answers the second
 * question with a third of the screen.
 *
 * It is a directory now, full width, with one primary action above it. The
 * table gets the room its six columns need — Location and Status were the two
 * that truncated at 27rem-less-than-half — and the form gets a dialog with the
 * whole viewport at the moment it is actually being filled in.
 *
 * Same shape as the Admin announcements page, deliberately: feed, one primary
 * action, composer in a dialog. A supervisor who works both consoles meets one
 * workflow rather than two.
 *
 * The `lg:h-full` that used to be commented at length here is now a plain
 * `lg:h-full` on a single column, and the reason it is qualified by `lg:` has
 * not changed: `scroll={false}` on the shell is a desktop-only contract (see
 * DashboardLayout), so a page that pins itself to the viewport at EVERY width
 * pins itself to a viewport that cannot scroll — which is how this page came to
 * render as a blank panel on a phone.
 */
export default function ReportPage() {
  const { user } = useAuth()
  const [composerOpen, setComposerOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const reportsQuery = useMemo(() => query(collection(db, 'incidents')), [])
  // `feedError` was previously destructured away. A snapshot listener that is
  // denied (rules change, session expiring mid-shift) resolves to an empty
  // array with `loading: false` — indistinguishable from "you have filed
  // nothing", which is the worst possible reading for a guard checking whether
  // their report went through. Surfaced in the table instead.
  const { data: raw, loading, error: feedError } = useLiveCollection(reportsQuery)

  /**
   * This officer's own log, not the incident queue.
   *
   * Filtered on `reporterUid` rather than on a "is this person staff" lookup:
   * the uid is stamped at write time by the composer, so it is the only field
   * that positively identifies an officer-filed entry. Resident tickets carry
   * the resident's uid and drop out for free — there is no separate exclusion
   * rule to keep in step.
   *
   * Filed BEFORE reporterUid existed? Those have no uid and are excluded. That
   * is the right failure direction for a personal log: showing someone else's
   * report here would be worse than omitting an old one, which is still on the
   * Incident Tickets page.
   */
  const reports = useMemo(() => {
    const uid = user?.uid
    if (!uid) return []
    return raw.map(mapIncidentDoc).filter((report) => report.reporterUid === uid)
  }, [raw, user?.uid])

  // Rows open the full detail drawer, so warm their evidence while idle.
  useEvidencePrefetch(reports)

  // Re-derived every render so the open drawer reflects a soft delete or a
  // status change the instant onSnapshot pushes it back.
  const selected = reports.find((report) => report.id === selectedId) ?? null

  // The same two buckets the table's own tabs split on, counted here so the
  // heading states the log's size before you read a row of it. Suppressed
  // while the first snapshot is in flight rather than shown as "0 active" —
  // an empty count during load is a claim, and the wrong one.
  const summary = useMemo(() => {
    if (loading || feedError) return undefined
    const archived = reports.filter(isDeleted).length
    return `${reports.length - archived} active · ${archived} archived`
  }, [reports, loading, feedError])

  function openComposer() {
    setComposerOpen(true)
  }

  // The top bar's "File incident report" lands here as `?file=1` from any
  // page. Consumed once, so a reload does not reopen the form.
  const [searchParams, setSearchParams] = useSearchParams()
  const fileRequested = searchParams.get('file') === '1'
  useEffect(() => {
    if (!fileRequested) return
    setComposerOpen(true)
    setSearchParams({}, { replace: true })
  }, [fileRequested, setSearchParams])

  return (
    <AppShell
      title="File a report"
      subtitle="Your own filed reports. Resident-filed calls are under Incident tickets."
      topBarSlot={<GuardHeaderActions />}
      scroll={false}
    >
      {/* Scoped to the page content, so a crash here leaves the sidebar and top
          bar mounted. On a phone the drawer is the only navigation available —
          a full-screen error state would strand the guard mid-shift with
          nothing but the browser's back button. */}
      <ErrorBoundary
        fallback={({ error: crash, reset }) => (
          <PageErrorFallback error={crash} reset={reset} title="The report page failed to load." />
        )}
      >
        {/* ══ ONE COLUMN, THE DIRECTORY ══
            `gap-4` throughout, so heading, confirmation banner and the table's
            own top border sit on one vertical rhythm — the table then carries
            that same 4-unit padding inside its toolbar and rows, which is what
            makes the search field, the status chips and the first column of the
            grid line up down the page rather than merely near each other. */}
        <div className="flex min-h-0 flex-col gap-4 lg:h-full">
          <SectionHeading
            title="Filed reports"
            description={summary}
            // Full width below `sm:`. The heading wraps on a phone and the
            // action lands on its own line either way — at natural width it
            // reads as a stray button under the subtitle rather than as the
            // page's primary control. This is the case `actionClassName`
            // exists for; see its note on SectionHeading.
            actionClassName="w-full sm:w-auto"
            action={
              <button
                type="button"
                onClick={openComposer}
                className="btn btn-sm btn-brand w-full sm:w-auto"
              >
                <Plus size="sm" />
                File incident report
              </button>
            }
          />

          <FiledReportsTable
            incidents={reports}
            loading={loading}
            loadError={feedError}
            onView={(report) => setSelectedId(report.id)}
          />
        </div>

        <FileReportModal
          open={composerOpen}
          onClose={() => setComposerOpen(false)}
          onFiled={() => {
            // The dialog closes on success, so the confirmation is a toast;
            // the new first row of the table is the lasting proof.
            setComposerOpen(false)
            toast.success('Report filed', { description: 'It is in the dispatch queue now.' })
          }}
        />

        <IncidentTicketDetailsModal report={selected} onClose={() => setSelectedId(null)} />
      </ErrorBoundary>
    </AppShell>
  )
}
