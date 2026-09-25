import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import Card from '@shared/components/Card'
import PriorityBadge from '@shared/components/PriorityBadge'
import StatusBadge from '@shared/components/StatusBadge'
import TablePagination from '@shared/components/TablePagination'
import { formatCategory } from '@shared/lib/wpda'
import { displayPersonName } from '@shared/lib/identity'
import { incidentReference } from '@/lib/dispatch'
import { SkeletonTableRows } from '@shared/components/Skeleton'

/**
 * The Incident History directory.
 *
 * ── A LIST, AND ONLY A LIST ───────────────────────────────────────────────
 * Replaces `ForensicArchiveList`, which was a 22rem rail of stacked cards
 * beside a permanently-mounted detail panel. Two things were wrong with that
 * shape, and neither was decoration:
 *
 *   the rail   Each row was a card — a category pill and a status word on one
 *              line, then a location line, then a resident-and-timestamp line
 *              — so five fields sat on three rows at three different left
 *              edges, and nothing lined up between one row and the next. A
 *              directory is read by scanning ONE field down a column ("which
 *              of these is Block 7"), and a stack of cards is the one layout
 *              that makes that impossible.
 *
 *   the panel  Two thirds of the screen was spent on a detail card that, on
 *              arrival, said "Select a report to review its evidence" — the
 *              page's default state was mostly an instruction to use the page.
 *
 * So: one full-width table on the SAME column grid `IncidentsTable` uses, and
 * the details move into a modal that opens on click (see IncidentReviewModal).
 * A guard scanning last week's calls reads a list; a guard reviewing one gets
 * the whole width for it.
 *
 * ── ALIGNED TO THE SYSTEM GRID, DELIBERATELY THE SAME AS THE QUEUE ────────
 * Identical column widths, identical `px-4 py-3` cells, identical `.eyebrow`
 * heads, identical `TablePagination` footer. Incident Tickets and Incident
 * History are the same records at two points in their life, and a guard moving
 * between them should not have to re-learn where the status column is.
 */

/**
 * Fixed-width log timestamp: `12 Jul 14:07:32`. Same format and the same
 * reasoning as IncidentsTable — a variable-width locale string jags the column
 * on every row, and a mono column that does not align is just noise.
 */
const LOG_TIME = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }

function formatLogTime(value) {
  return new Date(value).toLocaleString('en-GB', LOG_TIME).replace(',', '')
}

export default function IncidentHistoryTable({
  reports = [],
  onSelect,
  /** The scope tabs, rendered inside this panel's toolbar. */
  filterSlot,
  /** Shown when the unfiltered set is empty — the two scopes read differently. */
  emptyLabel = 'No reports in this archive.',
  /**
   * Whether the history query is still opening. Without it `emptyLabel` —
   * "No reports in this archive." — is what a guard sees for the whole of the
   * initial load, which on an ARCHIVE is the most alarming possible false
   * statement: it reads as the record having been lost.
   */
  loading = false,
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return reports
    return reports.filter((report) => {
      const haystack = [
        incidentReference(report.id),
        report.reportedByName,
        formatCategory(report.category),
        report.location,
        report.title,
        report.block && `block ${report.block}`,
        report.lot && `lot ${report.lot}`,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [reports, query])

  const totalItems = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage))

  // Clamped rather than reset, for the reason IncidentsTable gives: landing on
  // the new last page keeps the reader near the rows they were looking at.
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  // A new search, or a switch of scope, is a different result set — so "page 4
  // of the old one" is not a position worth preserving.
  useEffect(() => {
    setPage(1)
  }, [query, rowsPerPage, reports])

  const rows = useMemo(() => {
    const start = (Math.min(page, totalPages) - 1) * rowsPerPage
    return filtered.slice(start, start + rowsPerPage)
  }, [filtered, page, totalPages, rowsPerPage])

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden p-0">
      {/* Toolbar baseline: every control is h-9, `items-center`, one `p-4`
          gutter — the same band Incident Tickets carries, so the two pages
          have the same first 57px. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline p-4">
        <div className="flex h-9 min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 transition-[border-color,box-shadow] duration-150 hover:border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
          <Search className="h-4 w-4 shrink-0 text-text-secondary" />
          <input
            type="text"
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            placeholder="Search by reference, resident, category, block or lot"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {filterSlot}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-auto pb-6">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            {/* The shared `.table-head` scale, same as the ticket queue. */}
            <tr className="table-head">
              <th className="w-[8.5rem] px-4 py-3 text-left">Reference</th>
              <th className="px-4 py-3 text-left">Category</th>
              <th className="px-4 py-3 text-left">Location</th>
              <th className="px-4 py-3 text-left">Resident</th>
              <th className="w-[10rem] px-4 py-3 text-left">Status</th>
              {/* The list is always newest-first — the page sorts it, because
                  the page owns the scope — so this column states the order
                  rather than offering a control that would be a second
                  opinion about it. */}
              <th scope="col" aria-sort="descending" className="w-[11rem] px-4 py-3 text-left">
                Reported
              </th>
              <th className="w-14 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonTableRows
                rows={8}
                columns={[
                  { width: 'w-24' },
                  { width: 'w-24' },
                  { width: 'w-40' },
                  { width: 'w-28' },
                  { variant: 'pill', width: 'w-20' },
                  { width: 'w-24', variant: 'muted' },
                  { empty: true, className: 'w-14' },
                ]}
              />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-secondary">
                  {reports.length === 0 ? emptyLabel : 'No reports match your search.'}
                </td>
              </tr>
            ) : (
              rows.map((report) => (
                <tr
                  key={report.id}
                  onClick={() => onSelect?.(report)}
                  className="data-row group cursor-pointer border-t border-divider"
                >
                  {/* Machine data — mono, so a reference read off a radio can
                      be compared glyph-by-glyph down the column. The SAME
                      `incidentReference` the dispatch drawer prints, so the
                      code a guard wrote down while working a call is the code
                      they can find it by afterwards. */}
                  <td className="px-4 py-3.5 font-mono text-xs font-medium text-text-secondary">
                    {incidentReference(report.id)}
                  </td>
                  <td className="px-4 py-3.5">
                    <PriorityBadge severity={report.severity}>{formatCategory(report.category)}</PriorityBadge>
                  </td>
                  {/* Type hierarchy across the row, matching the queue exactly:
                      Location is the primary identifier (medium, full white),
                      Resident is supporting detail, Reported is metadata. */}
                  <td className="whitespace-nowrap px-4 py-3.5 font-medium text-text-primary">{report.location ?? 'Unknown'}</td>
                  {/* `displayPersonName`, not the raw field — seeded documents
                      store `resident.0` here, and an archive naming a resident
                      by a seed handle is worse than naming them by role. */}
                  <td className="px-4 py-3.5 text-text-secondary">
                    {displayPersonName(report.reportedByName, 'Resident')}
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={report.status ?? 'Pending'} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">
                    {report.reportedAt ? formatLogTime(report.reportedAt) : '—'}
                  </td>
                  {/* The affordance for the modal. A whole row is clickable and
                      nothing about a table row says so on its own, so the
                      chevron is what tells a reader there is somewhere to go.
                      `aria-hidden` because the row IS the control — announcing
                      a second one would double every entry. */}
                  <td className="px-4 py-3.5 text-right">
                    <ChevronRight
                      className="ml-auto h-4 w-4 text-text-muted transition-[transform,color] duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary"
                      aria-hidden="true"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Sibling of the scroll region, not inside it — see TablePagination for
          why that is what keeps it pinned at every resolution. */}
      <TablePagination
        page={page}
        rowsPerPage={rowsPerPage}
        totalItems={totalItems}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        itemLabel="report"
      />
    </Card>
  )
}
