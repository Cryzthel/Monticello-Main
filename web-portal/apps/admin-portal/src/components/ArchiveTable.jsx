import { toast } from '@shared/lib/toast'
import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, FileText } from '@shared/icons'
import Card from '@shared/components/Card'
import StatusBadge from '@shared/components/StatusBadge'
import TimeframeFilter from '@/components/TimeframeFilter'
import { resolveTimeframe, withinTimeframe } from '@shared/lib/timeframe'
import { unarchiveIncidents } from '@shared/lib/incidents'
import { formatCategory } from '@shared/lib/wpda'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import { auditEventIcon } from '@shared/theme/categoryIcons'
import TablePagination from '@shared/components/TablePagination'
import SearchField from '@shared/components/SearchField'
import { formatDateTime } from '@shared/lib/dates'
import DataTable from '@shared/components/DataTable'

const stamp = (value) => formatDateTime(value)

const EVENT_TONE = {
  Dispatched: 'info',
  Resolved: 'success',
  Deleted: 'danger',
  Published: 'neutral',
}

/** One row shape for both sources, so the table sorts, searches and pages them as one list. */
function reportRow(incident) {
  return {
    id: `report-${incident.id}`,
    kind: 'report',
    at: incident.archivedAt,
    reportId: incident.id,
    label: 'Archived report',
    actor: incident.archivedByName || incident.reportedByName || '—',
    detail: `${formatCategory(incident.category)} report at ${incident.location ?? 'location not provided'}`,
    status: incident.status ?? 'Pending',
    search: [incident.category, incident.location, incident.reportedByName, incident.archivedByName, incident.status],
  }
}

function eventRow(event) {
  return {
    id: `event-${event.id}`,
    kind: 'event',
    at: event.at,
    reportId: event.reportId ?? null,
    label: event.category,
    actor: event.actor,
    detail: event.description,
    search: [event.actor, event.category, event.description],
  }
}

/**
 * The Archive — archived reports and aged-out activity, in ONE table.
 *
 * ── WHY ONE TABLE (2026-10-29, by request) ─────────────────────────────────
 * The Archive tab used to open on a second switcher, "Archived reports" /
 * "Archived activity", over two tables with their own search boxes, their own
 * timeframes and their own idea of a page. Both answer the same act — looking
 * something up after it has left the live views — so they are one list now,
 * newest first, with a Type column saying which kind of record each row is.
 * One search and one timeframe cover both.
 *
 * Nothing about the two sources changed: reports are the documents carrying
 * `archivedAt`, activity is the derived audit events past the live feed's
 * 24-hour window (see `expiredEvents` on HistoryPage). Only report rows can be
 * unarchived; an event is a fact about the past and has nowhere to return to.
 *
 * The timeframe defaults to 30 days because this list only grows.
 */
export default function ArchiveTable({ incidents = [], events = [], loading = false, onOpenReport = null }) {
  const [search, setSearch] = useState('')
  const [timeframe, setTimeframe] = useState({ preset: '30d', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [busyId, setBusyId] = useState(null)

  const rows = useMemo(() => {
    const range = resolveTimeframe(timeframe)
    const q = search.trim().toLowerCase()
    return [...incidents.map(reportRow), ...events.map(eventRow)]
      .filter((row) => withinTimeframe(row.at, range))
      .filter((row) =>
        q ? row.search.filter(Boolean).some((field) => String(field).toLowerCase().includes(q)) : true,
      )
      .sort((a, b) => (new Date(b.at).getTime() || 0) - (new Date(a.at).getTime() || 0))
  }, [incidents, events, search, timeframe])

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

  // Clamped, not reset: a list that shortens under the reader — an unarchive,
  // a delete in another tab — lands them on the new last page.
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

  async function restore(reportId) {
    setBusyId(reportId)
    try {
      await toast.run(() => unarchiveIncidents([reportId]), {
        success: 'Report restored to the active list',
        error: 'Could not restore the report',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="flex min-h-0 flex-col p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline p-4">
        <div className="flex items-center gap-2">
          <Archive size="sm" className="text-brand-400" />
          <p className="text-sm font-semibold text-text-primary">
            Archive
            <span className="ml-2 text-xs font-normal text-text-muted">{rows.length} in range</span>
          </p>
        </div>
        <TimeframeFilter value={timeframe} onChange={setTimeframe} />
      </div>

      <div className="border-b border-hairline p-3">
        <SearchField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search archived reports and activity"
        />
      </div>

      <DataTable
        minWidth="52rem"
        scrollClassName="pb-6"
        columns={[
          { header: <>When</> },
          { header: <>Type</> },
          { header: <>By</> },
          { header: <>Detail</> },
          {},
        ]}
      >
        {loading ? (
          <SkeletonTableRows
            rows={6}
            columns={[
              { width: 'w-28', variant: 'muted' },
              { variant: 'pill', width: 'w-24' },
              { width: 'w-24' },
              { width: 'w-48', variant: 'muted' },
              { empty: true },
            ]}
          />
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-4 py-10 text-center text-sm text-text-secondary">
              {/* Names the filter, not just the emptiness — an archive that
                  says "nothing here" while holding a year of records reads as
                  broken. */}
              Nothing archived in this range. Widen the timeframe to see older records.
            </td>
          </tr>
        ) : (
          pageRows.map((row) => {
            const opens = Boolean(row.reportId && onOpenReport)
            return (
              <tr
                key={row.id}
                onClick={opens ? () => onOpenReport(row.reportId) : undefined}
                className={`border-t border-divider ${opens ? 'data-row cursor-pointer' : ''}`}
              >
                <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">
                  {stamp(row.at)}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5">
                  {row.kind === 'report' ? (
                    <StatusBadge tone="neutral" icon={FileText}>
                      Report
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone={EVENT_TONE[row.label] ?? 'neutral'} icon={auditEventIcon(row.label)}>
                      {row.label}
                    </StatusBadge>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 font-medium text-text-primary">{row.actor}</td>
                <td className="px-4 py-3.5 text-text-secondary">
                  <span className="flex flex-wrap items-center gap-2">
                    {row.detail}
                    {row.kind === 'report' ? <StatusBadge status={row.status} size="sm" /> : null}
                  </span>
                </td>
                <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                  {row.kind === 'report' ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={busyId === row.reportId}
                        onClick={() => restore(row.reportId)}
                        className="btn btn-sm btn-outline"
                      >
                        <ArchiveRestore size="sm" />
                        Unarchive
                      </button>
                    </div>
                  ) : null}
                </td>
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
        itemLabel="archived record"
      />
    </Card>
  )
}
