import { useMemo, useState } from 'react'
import { collection, query } from 'firebase/firestore'
import {
  Archive,
  ArchiveRestore,
  ClipboardCheck,
  ClipboardList,
  Eye,
  FileDown,
  ShieldAlert,
  Trash2,
  X,
} from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import { useWaitWhile } from '@/lib/waitState'
import Card from '@shared/components/Card'
import SectionHeading from '@shared/components/SectionHeading'
import SegmentedControl from '@shared/components/SegmentedControl'
import Select from '@shared/components/Select'
import StatusBadge from '@shared/components/StatusBadge'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import SecurityReportDetailModal from '@/components/SecurityReportDetailModal'
import OverflowMenu from '@shared/components/OverflowMenu'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useEvidencePrefetch } from '@shared/hooks/useEvidencePrefetch'
import { db } from '@shared/lib/firebase'
import {
  mapIncidentDoc, isDeleted, isArchived, reviewState, REVIEW_TONES, REVIEW_PENDING, REVIEW_DONE,
  archiveIncidents, unarchiveIncidents, softDeleteIncidents, markReportsReviewed,
} from '@shared/lib/incidents'
import { exportReportPdf } from '@shared/lib/reportPdf'
import { toast } from '@shared/lib/toast'
import { Skeleton } from '@shared/components/Skeleton'
import SearchField from '@shared/components/SearchField'
import { formatDateTime } from '@shared/lib/dates'
import DataTable from '@shared/components/DataTable'

/*
 * ── WHY THERE IS NO CATEGORY FILTER ──────────────────────────────────────────
 * There was one, offering every incident category (fire, medical, security,
 * hazard, maintenance, noise). But every officer-filed report is saved as
 * `security` — the Guardhouse form hard-codes it (FileReportModal's
 * FILED_CATEGORY) — so the filter returned the whole list for "Security" and
 * nothing for the other five: one output whatever was picked. The filters
 * below are on facts that actually vary between officer reports.
 */
const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: REVIEW_PENDING, label: 'Pending review' },
  { value: REVIEW_DONE, label: 'Reviewed' },
]

const PRIORITY_FILTERS = [
  { value: 'all', label: 'All priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const PRIORITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const severityOf = (report) => String(report.severity ?? 'medium').toLowerCase()

const DATE_RANGES = [
  { value: 'today', label: 'Today', days: 1 },
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: 'all', label: 'All time', days: null },
  { value: 'custom', label: 'Custom range…', days: null },
]

const VIEWS = [
  { key: 'active', label: 'Inbox' },
  { key: 'archived', label: 'Archived' },
]

const stamp = (v) => formatDateTime(v)

/** Human-quotable code, derived from the document id — see IncidentsTable. */
const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '—')

/**
 * Reports — the admin's inbox for officer-filed incident logs.
 *
 * WHAT MAKES A REPORT "OFFICER-FILED". The `incidents` collection holds both
 * resident submissions from the mobile app and guard submissions from the
 * Security portal; nothing on the document distinguishes them. So this page
 * joins against the live staff directory and keeps only reports whose
 * `reporterUid` belongs to a staff account. That is derived from the same
 * source firestore.rules gates on, so it cannot drift from who is actually
 * staff — a guard added or removed today is reflected immediately, and no
 * "isOfficerReport" flag has to be written and kept honest at submit time.
 *
 * TWO PRESENTATIONS OF ONE LIST
 * -----------------------------
 * Eight columns do not survive a 375px viewport by any amount of squeezing:
 * dropping columns loses information, and letting the table set its own width
 * pushes the whole page sideways. So below `md` the same rows render as cards —
 * every field still present, stacked in reading order — and from `md` up the
 * table returns inside an `overflow-x-auto` rail with the Actions column pinned
 * `sticky right-0`, so "View" stays reachable however far the rest has scrolled.
 *
 * The two are one `rows` array rendered twice, not two data paths: filters,
 * selection and bulk actions operate on the same state either way, so a
 * selection made on a phone is the same selection the desktop bulk bar sees.
 *
 * The table is `border-separate` with row hairlines moved onto the cells. In
 * `border-collapse: collapse` — Tailwind Preflight's default — Chrome silently
 * refuses to honour `position: sticky` on a `<td>`, which is exactly the cell
 * the horizontal rail depends on.
 */

/** One report as a stacked card. Below `md` only. */
function ReportCard({ report, officer, checked, onToggle, onOpen, actions }) {
  const review = reviewState(report)

  return (
    <li className={`border-t border-divider transition ${checked ? 'bg-brand-50' : ''}`}>
      <div className="flex items-start gap-2 p-4">
        {/* The input itself stays 20px; the label around it is the 44px
            target, so the tap area is honest without a giant checkbox. */}
        <label className="-m-1.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center p-1.5">
          <input
            type="checkbox"
            aria-label={`Select report ${ticketCode(report.id)}`}
            checked={checked}
            onChange={onToggle}
            className="h-5 w-5 rounded border-tint/20 bg-tint/5 accent-brand-500"
          />
        </label>

        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-xs font-medium text-text-secondary">
              {ticketCode(report.id)}
            </span>
            <span className="shrink-0 font-mono text-2xs text-text-muted">
              {stamp(report.reportedAt)}
            </span>
          </div>

          <p className="mt-1 truncate font-medium text-text-primary">
            {report.reportedByName || 'Unknown'}
          </p>
          <p className="mt-0.5 text-2xs text-text-muted">
            {officer?.role ? officer.role.replace(/_/g, ' ') : 'Officer'}
          </p>

          <p className="mt-2 break-words text-xs leading-snug text-text-secondary">
            {report.location || 'Location not provided'}
          </p>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <StatusBadge severity={severityOf(report)}>
              {PRIORITY_LABELS[severityOf(report)] ?? 'Medium'} priority
            </StatusBadge>
            <StatusBadge tone={REVIEW_TONES[review] ?? 'neutral'}>
              {review}
            </StatusBadge>
          </div>
        </button>
      </div>

      {/* An explicit control, not just a tappable card: touch has no hover, so
          without one there is nothing on screen saying the row opens. */}
      <div className="flex items-center justify-end border-t border-divider px-4 py-2">
        <OverflowMenu ariaLabel={`Actions for ${ticketCode(report.id)}`} items={actions} />
      </div>
    </li>
  )
}

export default function SecurityReportsPage() {
  const [view, setView] = useState('active')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [officerFilter, setOfficerFilter] = useState('all')
  const [range, setRange] = useState('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [openId, setOpenId] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const incidentsQuery = useMemo(() => query(collection(db, 'incidents')), [])
  const { data: rawIncidents, loading } = useLiveCollection(incidentsQuery)
  useWaitWhile(loading, 'Syncing officer reports')

  const staffQuery = useMemo(() => query(collection(db, 'staff_accounts')), [])
  const { data: staff } = useLiveCollection(staffQuery)
  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff])

  const officerReports = useMemo(
    () =>
      rawIncidents
        .map(mapIncidentDoc)
        .filter((report) => !isDeleted(report) && staffById.has(report.reporterUid)),
    [rawIncidents, staffById],
  )

  useEvidencePrefetch(officerReports)

  // Officers who have filed at least one report, from the live list — so the
  // filter never offers a name with nothing behind it.
  const officerOptions = useMemo(() => {
    const names = new Map()
    officerReports.forEach((r) => {
      if (!names.has(r.reporterUid)) names.set(r.reporterUid, r.reportedByName || staffById.get(r.reporterUid)?.name || 'Officer')
    })
    return [
      { value: 'all', label: 'All officers' },
      ...[...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [officerReports, staffById])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()

    let from = null
    let to = null
    if (range === 'custom') {
      from = customFrom ? new Date(`${customFrom}T00:00:00`) : null
      to = customTo ? new Date(`${customTo}T23:59:59`) : null
    } else {
      const preset = DATE_RANGES.find((r) => r.value === range)
      if (preset?.days) from = new Date(Date.now() - preset.days * 86400000)
    }

    return officerReports
      .filter((report) => (view === 'archived' ? isArchived(report) : !isArchived(report)))
      .filter((report) => status === 'all' || reviewState(report) === status)
      .filter((report) => priority === 'all' || severityOf(report) === priority)
      .filter((report) => officerFilter === 'all' || report.reporterUid === officerFilter)
      .filter((report) => {
        if (!report.reportedAt) return !from && !to
        const at = new Date(report.reportedAt).getTime()
        if (from && at < from.getTime()) return false
        if (to && at > to.getTime()) return false
        return true
      })
      .filter((report) => {
        if (!term) return true
        return [
          ticketCode(report.id),
          report.reportedByName,
          report.location,
          report.phase && `phase ${report.phase}`,
          report.block && `block ${report.block}`,
          report.lot && `lot ${report.lot}`,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term)
      })
      .sort((a, b) => (b.reportedAt?.getTime?.() ?? 0) - (a.reportedAt?.getTime?.() ?? 0))
  }, [officerReports, view, status, priority, officerFilter, range, customFrom, customTo, search])

  const counts = useMemo(
    () => ({
      active: officerReports.filter((r) => !isArchived(r)).length,
      archived: officerReports.filter(isArchived).length,
    }),
    [officerReports],
  )

  const selected = rows.filter((row) => selectedIds.has(row.id))
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id))
  const open = officerReports.find((report) => report.id === openId) ?? null

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** One write over `ids`, reported as a toast. Clears the selection on success. */
  async function run(action, ids, { success, error: failure }) {
    setBusy(true)
    setError('')
    const ok = await toast.run(() => action(ids), { success, error: failure })
    setBusy(false)
    setConfirming(null)
    if (ok) setSelectedIds(new Set())
    else setError(`${failure}. Check the connection and try again.`)
  }

  const noun = (n) => (n === 1 ? 'report' : `${n} reports`)

  /** The per-row action menu — every item acts on THAT row's report. */
  function rowActions(report) {
    const archived = isArchived(report)
    return [
      { label: 'View details', icon: Eye, onSelect: () => setOpenId(report.id) },
      {
        label: 'Export PDF',
        icon: FileDown,
        onSelect: () => {
          try {
            exportReportPdf(report, { attachmentCount: (report.photoUrls?.length ?? 0) + (report.attachmentUrls?.length ?? 0) })
            toast.success('Report exported', { description: `${ticketCode(report.id)}.pdf` })
          } catch (err) {
            console.error('Export failed', err)
            toast.error('Could not export the report')
          }
        },
      },
      report.reviewedAt
        ? null
        : {
            label: 'Mark as reviewed',
            icon: ClipboardCheck,
            onSelect: () =>
              run(markReportsReviewed, [report.id], {
                success: `${ticketCode(report.id)} marked as reviewed`,
                error: 'Could not mark the report as reviewed',
              }),
          },
      {
        label: archived ? 'Unarchive' : 'Archive',
        icon: archived ? ArchiveRestore : Archive,
        onSelect: () =>
          run(archived ? unarchiveIncidents : archiveIncidents, [report.id], {
            success: archived ? `${ticketCode(report.id)} returned to the inbox` : `${ticketCode(report.id)} archived`,
            error: archived ? 'Could not unarchive the report' : 'Could not archive the report',
          }),
      },
      { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setConfirming([report]) },
    ].filter(Boolean)
  }

  const filtersActive =
    Boolean(search.trim()) || status !== 'all' || priority !== 'all' || officerFilter !== 'all'

  const emptyMessage =
    counts[view] === 0
      ? view === 'archived'
        ? 'Nothing archived.'
        : 'No officer reports filed yet.'
      : 'No reports match these filters.'

  return (
    <AppShell
      title="Reports"
      scroll={false}
    >
      {/* `lg:h-full` rather than `h-full`: below lg the shell scrolls and this
          column is allowed to be as tall as its content. Pinning it to the
          viewport there is what previously left the table clipped and the page
          unscrollable. See the note in DashboardLayout. */}
      <div className="flex min-h-0 flex-col gap-4 lg:h-full">
        {/* No summary strip. Four tiles — Filed, Awaiting review, Reviewed,
            Archived — sat here above the table. They filtered nothing, and
            every figure is already on screen where it is used: the review
            state is a pill on each row, and the Inbox / Archived switch below
            carries both counts. The table now starts at the top. */}

        <SectionHeading
          title={view === 'archived' ? 'Archived reports' : 'Officer report inbox'}
          description={`${rows.length} of ${counts[view]} shown`}
          actionClassName="w-full sm:w-auto"
          action={
            // Full width with 44px targets on a phone, content-width on a
            // desktop toolbar.
            <SegmentedControl
              ariaLabel="Report views"
              className="w-full sm:w-auto"
              segmentClassName="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              options={VIEWS.map((v) => ({ value: v.key, label: v.label }))}
              value={view}
              onChange={(next) => {
                setView(next)
                setSelectedIds(new Set())
              }}
            />
          }
        />

        <Card className="flex min-h-0 flex-col overflow-hidden p-0 lg:flex-1">
          {/* ── Filters. One stacked column on a phone, one h-9 baseline row
                from `sm:` up. Every control is 44px tall below `sm:`. ── */}
          <div className="grid grid-cols-1 gap-2.5 border-b border-hairline p-4 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <SearchField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search officer, report ID, or location"
              className="sm:flex-1"
            />
            <Select
              ariaLabel="Filter by review status"
              size="touch"
              value={status}
              onChange={setStatus}
              options={STATUS_FILTERS}
              className="w-full sm:w-auto sm:min-w-[10rem]"
            />
            <Select
              ariaLabel="Filter by priority"
              size="touch"
              value={priority}
              onChange={setPriority}
              options={PRIORITY_FILTERS}
              className="w-full sm:w-auto sm:min-w-[9.5rem]"
            />
            <Select
              ariaLabel="Filter by officer"
              size="touch"
              value={officerFilter}
              onChange={setOfficerFilter}
              options={officerOptions}
              className="w-full sm:w-auto sm:min-w-[10rem]"
            />
            <Select
              ariaLabel="Date range"
              size="touch"
              value={range}
              onChange={setRange}
              options={DATE_RANGES}
              className="w-full sm:w-auto sm:min-w-[10rem]"
            />
            {range === 'custom' ? (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
                <input
                  type="date"
                  aria-label="From date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="field h-11 py-0 text-base sm:h-9 sm:w-[9.5rem] sm:text-sm"
                />
                <span className="text-xs text-text-muted">to</span>
                <input
                  type="date"
                  aria-label="To date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="field h-11 py-0 text-base sm:h-9 sm:w-[9.5rem] sm:text-sm"
                />
              </div>
            ) : null}
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setStatus('all')
                  setPriority('all')
                  setOfficerFilter('all')
                }}
                className="chip chip-idle h-9 sm:ml-auto"
              >
                <X size="sm" />
                Clear filters
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="flex items-start gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2.5 text-xs text-danger">
              <ShieldAlert size="sm" className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-danger/15">
                <X size="sm" />
              </button>
            </p>
          ) : null}

          {selected.length > 0 ? (
            /* Wraps to two rows on a phone — count and dismiss, then the two
               commands side by side at full width. `sm:order-*` puts them back
               on one row in the desktop reading order. */
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-brand-50 px-4 py-2.5 sm:gap-3">
              <span className="text-xs font-medium text-text-primary">
                <span className="font-mono">{selected.length}</span> selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                aria-label="Clear selection"
                className="icon-btn ml-auto h-11 w-11 shrink-0 sm:order-2 sm:ml-0 sm:h-9 sm:w-9"
              >
                <X size="sm" />
              </button>
              <div className="flex w-full items-center gap-2 sm:order-1 sm:ml-auto sm:w-auto">
                {selected.some((r) => !r.reviewedAt) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const ids = selected.filter((r) => !r.reviewedAt).map((r) => r.id)
                      run(markReportsReviewed, ids, {
                        success: `Marked ${noun(ids.length)} as reviewed`,
                        error: 'Could not mark those reports as reviewed',
                      })
                    }}
                    className="btn btn-sm btn-outline min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                  >
                    <ClipboardCheck size="sm" />
                    Mark reviewed
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(view === 'archived' ? unarchiveIncidents : archiveIncidents, selected.map((r) => r.id), {
                      success:
                        view === 'archived'
                          ? `Returned ${noun(selected.length)} to the inbox`
                          : `Archived ${noun(selected.length)}`,
                      error: view === 'archived' ? 'Could not unarchive those reports' : 'Could not archive those reports',
                    })
                  }
                  className="btn btn-sm btn-outline min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                >
                  {view === 'archived' ? <ArchiveRestore size="sm" /> : <Archive size="sm" />}
                  {view === 'archived' ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(selected)}
                  className="btn btn-sm btn-danger min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                >
                  <Trash2 size="sm" />
                  {`Delete ${selected.length}`}
                </button>
              </div>
            </div>
          ) : null}

          {/* ══ CARDS — below md ══ */}
          <div className="md:hidden">
            {rows.length > 0 ? (
              <label className="flex min-h-11 items-center gap-2.5 border-b border-hairline px-4 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all reports"
                  checked={allSelected}
                  onChange={() => setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="h-5 w-5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                />
                <span className="text-xs font-medium text-text-secondary">
                  Select all {rows.length}
                </span>
              </label>
            ) : null}

            {loading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={`sk-card-${i}`} className="space-y-2 rounded-xl border border-hairline p-4">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-16 text-center">
                <ClipboardList size="lg" className="mx-auto mb-2 text-text-muted" />
                <p className="text-sm text-text-secondary">{emptyMessage}</p>
              </div>
            ) : (
              <ul>
                {rows.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    officer={staffById.get(report.reporterUid)}
                    checked={selectedIds.has(report.id)}
                    onToggle={() => toggleRow(report.id)}
                    onOpen={() => setOpenId(report.id)}
                    actions={rowActions(report)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* ══ TABLE — md and up, on a horizontal rail ══ */}
          <DataTable
            scroll="x"
            sticky={false}
            minWidth="56rem"
            scrollClassName="hidden overscroll-x-contain md:block lg:flex-1 lg:overflow-y-auto"
            tableClassName="border-separate border-spacing-0"
            columns={[
              { header: <><input
                      type="checkbox"
                      aria-label="Select all reports"
                      checked={allSelected}
                      onChange={() => setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                      className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                    /></>, className: 'w-10' },
              { header: <>Report ID</>, className: 'w-[8rem]' },
              { header: <>Reporting officer</> },
              { header: <>Filed</>, className: 'w-[9.5rem]' },
              { header: <>Location</> },
              { header: <>Priority</>, className: 'w-[8rem]' },
              { header: <>Status</>, className: 'w-[9.5rem]' },
              { header: <>Actions</>, className: 'sticky right-0 z-10 w-[5rem] border-l border-hairline bg-base-900', align: 'right' },
            ]}
          >
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="[&>td]:border-t [&>td]:border-divider">
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j} className="px-4 py-3.5">
                          <Skeleton className="h-3 w-20" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center">
                      <ClipboardList size="lg" className="mx-auto mb-2 text-text-muted" />
                      <p className="text-sm text-text-secondary">{emptyMessage}</p>
                    </td>
                  </tr>
                ) : (
                  rows.map((report) => {
                    const checked = selectedIds.has(report.id)
                    const officer = staffById.get(report.reporterUid)
                    const review = reviewState(report)
                    return (
                      <tr
                        key={report.id}
                        onClick={() => setOpenId(report.id)}
                        tabIndex={0}
                        aria-label={`Open report ${ticketCode(report.id)}`}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setOpenId(report.id)
                          }
                        }}
                        className={`cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 [&>td]:border-t [&>td]:border-divider ${
                          checked ? 'bg-brand-50' : 'hover:bg-tint/[0.03]'
                        }`}
                      >
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select report ${ticketCode(report.id)}`}
                            checked={checked}
                            onChange={() => toggleRow(report.id)}
                            className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                          />
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs font-medium text-text-secondary">
                          {ticketCode(report.id)}
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="font-medium text-text-primary">{report.reportedByName || 'Unknown'}</p>
                          {/* Role, not a badge number — staff_accounts has no
                              badgeId field. See the note in the summary. */}
                          <p className="mt-0.5 text-2xs text-text-muted">
                            {officer?.role ? officer.role.replace(/_/g, ' ') : 'Officer'}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">
                          {stamp(report.reportedAt)}
                        </td>
                        <td className="px-4 py-3.5 text-text-secondary">
                          {report.location || 'Not provided'}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge severity={severityOf(report)}>
                            {PRIORITY_LABELS[severityOf(report)] ?? 'Medium'}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge tone={REVIEW_TONES[review] ?? 'neutral'}>
                            {review}
                          </StatusBadge>
                        </td>
                        <td
                          className="sticky right-0 z-10 border-l border-hairline bg-base-900 px-4 py-3.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {/* No View button: the row itself opens the report
                              (user's call, 2026-10-18). The menu keeps
                              "View details" for keyboard users. */}
                          <div className="flex items-center justify-end">
                            <OverflowMenu
                              ariaLabel={`Actions for ${ticketCode(report.id)}`}
                              items={rowActions(report)}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
          </DataTable>
        </Card>
      </div>

      <SecurityReportDetailModal
        reportId={openId}
        report={open}
        onClose={() => setOpenId(null)}
        onDeleted={(id) => setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })}
      />

      <ConfirmDialog
        open={Boolean(confirming)}
        busy={busy}
        tone="danger"
        title={confirming?.length === 1 ? 'Delete this report?' : `Delete ${confirming?.length ?? 0} reports?`}
        message="They move to Audit History → Deleted Reports, where they can be restored. Archive instead if you only want them off the inbox."
        confirmLabel="Delete"
        onConfirm={() =>
          run(softDeleteIncidents, confirming.map((r) => r.id), {
            success: `Moved ${noun(confirming.length)} to Deleted reports`,
            error: 'Could not delete the report',
          })
        }
        onCancel={() => setConfirming(null)}
      />
    </AppShell>
  )
}
