import { useEffect, useMemo, useState } from 'react'
import { Activity } from '@shared/icons'
import Card from '@shared/components/Card'
import StatusBadge from '@shared/components/StatusBadge'
import TimeframeFilter from '@/components/TimeframeFilter'
import { resolveTimeframe, withinTimeframe } from '@shared/lib/timeframe'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import { auditEventIcon } from '@shared/theme/categoryIcons'
import TablePagination from '@shared/components/TablePagination'
import SearchField from '@shared/components/SearchField'
import { formatDateTime } from '@shared/lib/dates'
import DataTable from '@shared/components/DataTable'

const stamp = (value) => formatDateTime(value)

const CATEGORY_TONE = {
  Dispatched: 'info',
  Resolved: 'success',
  Deleted: 'danger',
  Published: 'neutral',
}

/**
 * Activity feed entries that have aged past the live window.
 *
 * ── NOT A SEPARATE STORE ───────────────────────────────────────────────────
 * These are the same derived events the feed shows, past the same cutoff it
 * stops at — see the `expiredEvents` note on AdminHistoryPage. Nothing writes
 * an entry here at 24 hours; the feed renders one side of the line and this
 * renders the other, from one source. That is what makes the transition
 * automatic rather than a job that can fail to run.
 *
 * The timeframe filter defaults to 30 days because this list only grows: the
 * useful default is a recent slice, not everything the estate has ever done.
 */
export default function ArchivedActivityTable({ events = [], loading = false }) {
  const [search, setSearch] = useState('')
  const [timeframe, setTimeframe] = useState({ preset: '30d', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const rows = useMemo(() => {
    const range = resolveTimeframe(timeframe)
    const q = search.trim().toLowerCase()
    return events
      .filter((event) => withinTimeframe(event.at, range))
      .filter((event) =>
        q
          ? [event.actor, event.category, event.description]
              .filter(Boolean)
              .some((field) => String(field).toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [events, search, timeframe])


  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

  // Clamped, not reset: a list that shortens under the reader should land them
  // on the new last page rather than throwing them back to the top.
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  // A new query IS a new list, so it starts at page 1.
  useEffect(() => {
    setPage(1)
  }, [search, timeframe, rowsPerPage])

  const pageRows = useMemo(() => {
    const start = (Math.min(page, totalPages) - 1) * rowsPerPage
    return rows.slice(start, start + rowsPerPage)
  }, [rows, page, totalPages, rowsPerPage])

  return (
    <Card className="flex min-h-0 flex-col p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline p-4">
        <div className="flex items-center gap-2">
          <Activity size="sm" className="text-brand-400" />
          <p className="text-sm font-semibold text-text-primary">
            Archived activity
            <span className="ml-2 text-xs font-normal text-text-muted">{rows.length} in range</span>
          </p>
        </div>
        <TimeframeFilter value={timeframe} onChange={setTimeframe} />
      </div>

      <div className="border-b border-hairline p-3">
        <SearchField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search archived activity"
        />
      </div>

      <DataTable
        minWidth="40rem"
        scrollClassName="pb-6"
        columns={[
          { header: <>When</> },
          { header: <>Actor</> },
          { header: <>Event</> },
          { header: <>Detail</> },
        ]}
      >
            {loading ? (
              /* Was a centred "Loading activity…" in a single merged cell. That
                 collapses the table to one row, so the column widths are
                 computed from the word "Loading" and then recomputed from the
                 real data — the whole grid jumps sideways on arrival. Skeleton
                 rows keep the four columns populated throughout. */
              <SkeletonTableRows
                rows={6}
                columns={[
                  { width: 'w-28', variant: 'muted' },
                  { width: 'w-24' },
                  { width: 'w-32' },
                  { width: 'w-48', variant: 'muted' },
                ]}
              />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-text-secondary">
                  {/* Names the filter, not just the emptiness — this list holds
                      months of records and an unqualified "nothing here" reads
                      as a broken panel. */}
                  No archived activity in this range. Widen the timeframe to see older entries.
                </td>
              </tr>
            ) : (
              pageRows.map((event) => {
                const Icon = event.icon
                return (
                  <tr key={event.id} className="border-t border-divider">
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">
                      {stamp(event.at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span className="flex items-center gap-2 font-medium text-text-primary">
                        {Icon ? <Icon size="sm" className="shrink-0 text-text-muted" /> : null}
                        {event.actor}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge tone={CATEGORY_TONE[event.category] ?? 'neutral'} icon={auditEventIcon(event.category)}>
                        {event.category}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3.5 text-text-secondary">{event.description}</td>
                  </tr>
                )
              })
            )}
      </DataTable>

      {/* Sibling of the scroll region, so it stays pinned while the rows move. */}
      <TablePagination
        page={page}
        rowsPerPage={rowsPerPage}
        totalItems={rows.length}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        itemLabel="archived event"
      />
    </Card>
  )
}
