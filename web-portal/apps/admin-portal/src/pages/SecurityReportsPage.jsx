import { useMemo, useState } from 'react'
import { collection, query } from 'firebase/firestore'
import {
  Archive, ArchiveRestore, ClipboardList, Eye, Search,
  ShieldAlert, Trash2, X,
} from 'lucide-react'
import AppShell from '@/layouts/AppShell'
import { useWaitWhile } from '@/lib/waitState'
import Card from '@shared/components/Card'
import SectionHeading from '@shared/components/SectionHeading'
import SegmentedControl from '@shared/components/SegmentedControl'
import Select from '@shared/components/Select'
import StatusBadge from '@shared/components/StatusBadge'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import SecurityReportDetailModal from '@/components/SecurityReportDetailModal'
import { categoryTone } from '@shared/theme/badgeStyles'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useEvidencePrefetch } from '@shared/hooks/useEvidencePrefetch'
import { db } from '@shared/lib/firebase'
import {
  mapIncidentDoc, isDeleted, isArchived, reviewState, REVIEW_TONES,
  archiveIncidents, unarchiveIncidents, softDeleteIncidents,
} from '@shared/lib/incidents'
import { describeFirestoreError } from '@shared/lib/audit'
import { CATEGORY_WEIGHTS, formatCategory } from '@shared/lib/wpda'
import { Skeleton } from '@shared/components/Skeleton'

const CATEGORY_FILTERS = ['All categories', ...Object.keys(CATEGORY_WEIGHTS)]

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

const STAMP = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
const stamp = (v) => (v ? new Date(v).toLocaleString('en-GB', STAMP).replace(',', '') : '—')

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
function ReportCard({ report, officer, checked, onToggle, onOpen }) {
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
            <StatusBadge tone={categoryTone(report.category)}>
              {formatCategory(report.category)}
            </StatusBadge>
            <StatusBadge tone={REVIEW_TONES[review] ?? 'neutral'}>
              {review}
            </StatusBadge>
          </div>
        </button>
      </div>

      {/* An explicit control, not just a tappable card: touch has no hover, so
          without one there is nothing on screen saying the row opens. */}
      <div className="flex justify-end border-t border-divider px-4 py-2">
        <button type="button" onClick={onOpen} className="btn btn-sm btn-outline min-h-11 px-4">
          <Eye className="h-4 w-4" />
          View report
        </button>
      </div>
    </li>
  )
}

export default function SecurityReportsPage() {
  const [view, setView] = useState('active')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All categories')
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
      .filter((report) => category === 'All categories' || report.category === category)
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
  }, [officerReports, view, category, range, customFrom, customTo, search])

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

  async function run(action, ids) {
    setBusy(true)
    setError('')
    try {
      await action(ids)
      setSelectedIds(new Set())
      setConfirming(null)
    } catch (err) {
      console.error('Reports action failed', err)
      setConfirming(null)
      setError(describeFirestoreError(err, 'update those reports'))
    } finally {
      setBusy(false)
    }
  }

  const emptyMessage =
    counts[view] === 0
      ? view === 'archived'
        ? 'Nothing archived.'
        : 'No officer reports filed yet.'
      : 'No reports match these filters.'

  return (
    <AppShell
      title="Reports"
      subtitle="Incident logs filed by security officers on duty."
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
              options={VIEWS.map((v) => ({ value: v.key, label: v.label, count: counts[v.key] }))}
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
            <div className="flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 sm:h-9 sm:min-w-[18rem] sm:flex-1">
              <Search className="h-4 w-4 shrink-0 text-text-secondary" />
              {/* text-base below `sm:` — iOS zooms the viewport on focus for
                  any field under 16px, and the page never zooms back out. */}
              <input
                type="text"
                inputMode="search"
                autoComplete="off"
                className="h-full w-full bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted sm:text-sm"
                placeholder="Search officer, report ID, or location"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select
              ariaLabel="Filter by category"
              size="touch"
              value={category}
              onChange={setCategory}
              options={CATEGORY_FILTERS.map((key) => ({
                value: key,
                label: key === 'All categories' ? key : formatCategory(key),
              }))}
              className="w-full sm:w-auto sm:min-w-[11rem]"
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
          </div>

          {error ? (
            <p className="flex items-start gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2.5 text-xs text-danger">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-danger/15">
                <X className="h-3.5 w-3.5" />
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
                <X className="h-4 w-4" />
              </button>
              <div className="flex w-full items-center gap-2 sm:order-1 sm:ml-auto sm:w-auto">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(view === 'archived' ? unarchiveIncidents : archiveIncidents, selected.map((r) => r.id))
                  }
                  className="btn btn-sm btn-outline min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                >
                  {view === 'archived' ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  {view === 'archived' ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(selected)}
                  className="btn btn-sm btn-danger min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
                <ClipboardList className="mx-auto mb-2 h-6 w-6 text-text-muted" />
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
                  />
                ))}
              </ul>
            )}
          </div>

          {/* ══ TABLE — md and up, on a horizontal rail ══ */}
          <div className="custom-scrollbar hidden min-h-0 overflow-x-auto overscroll-x-contain md:block lg:flex-1 lg:overflow-y-auto">
            <table className="w-full min-w-[54rem] border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-20 bg-slate-50">
                <tr className="table-head">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all reports"
                      checked={allSelected}
                      onChange={() => setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                      className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                    />
                  </th>
                  <th className="w-[8rem] px-4 py-3">Report ID</th>
                  <th className="px-4 py-3">Reporting officer</th>
                  <th className="w-[9.5rem] px-4 py-3">Filed</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="w-[9.5rem] px-4 py-3">Status</th>
                  {/* Pinned, so the row's only action survives the rail being
                      scrolled to its far left. A solid fill is required —
                      base-900 and the panel's own surface resolve to the same
                      colour in both themes, so it reads as one surface. */}
                  <th className="sticky right-0 z-10 w-[6rem] border-l border-hairline bg-base-900 px-4 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
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
                    <td colSpan={7} className="px-4 py-16 text-center">
                      <ClipboardList className="mx-auto mb-2 h-6 w-6 text-text-muted" />
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
                        className={`cursor-pointer transition [&>td]:border-t [&>td]:border-divider ${
                          checked ? 'bg-brand-50' : 'hover:bg-tint/[0.03]'
                        }`}
                      >
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
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
                          <StatusBadge tone={REVIEW_TONES[review] ?? 'neutral'}>
                            {review}
                          </StatusBadge>
                        </td>
                        <td
                          className="sticky right-0 z-10 border-l border-hairline bg-base-900 px-4 py-3.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setOpenId(report.id)}
                            className="btn btn-sm btn-outline"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
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
        onConfirm={() => run(softDeleteIncidents, confirming.map((r) => r.id))}
        onCancel={() => setConfirming(null)}
      />
    </AppShell>
  )
}
