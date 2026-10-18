import { useEffect, useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { Download, ShieldOff } from '@shared/icons'
import Card from '@shared/components/Card'
import Select from '@shared/components/Select'
import SearchField from '@shared/components/SearchField'
import StatusBadge from '@shared/components/StatusBadge'
import TablePagination from '@shared/components/TablePagination'
import { Skeleton } from '@shared/components/Skeleton'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useAuth } from '@shared/auth/AuthContext'
import { db } from '@shared/lib/firebase'
import { mapShiftDoc } from '@shared/lib/shifts'
import { useGuardProfile } from '@/hooks/useGuardProfile'
import { exportDutyLogPdf } from '@/lib/dutyLogPdf'
import { formatDate } from '@shared/lib/dates'
import DataTable from '@shared/components/DataTable'

/**
 * The officer's own duty history, with a PDF export.
 *
 * ── IT MIRRORS THE ADMIN SHIFT RECORD, AND DOES NOT SHARE ITS CODE ──────────
 * The brief asks for the filter and table layout of Admin › Security Accounts ›
 * Shift history, and that is what this is: the same `SearchField` + two
 * `Select`s toolbar, the same `Card` + `overflow-x-auto` + `table-head` shell,
 * the same `TablePagination` beneath. An officer who has seen an administrator
 * looking at their record sees the same thing here.
 *
 * What it is NOT is a reuse of `OnDutyHistoryTable`, and the difference is in
 * the rows rather than the chrome. That table groups shifts BY GUARD — one row
 * per officer, with shift counts and total hours, opening a drawer to see one
 * person's shifts. This is already one person, so grouping by guard would make
 * a one-row table. Here a row IS a shift, which is the view that component
 * reaches its drawer to show. Parameterising it to collapse its own grouping
 * would leave a component whose primary axis is a prop — more tangled than two
 * tables that happen to share a toolbar.
 *
 * ── SCOPED BY QUERY, NOT BY FILTER ──────────────────────────────────────────
 * `where('guardUid', '==', uid)` is on the Firestore query. The rules let any
 * staff account read `guard_shifts` — the admin console needs that — so
 * fetching everything and filtering client-side would work, and would also
 * pull every officer's movements into this tab to throw most of them away.
 * Scoping the query means the data never arrives.
 */

const RANGES = [
  { value: 'all', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

const STATES = [
  { value: 'all', label: 'All shifts' },
  { value: 'open', label: 'Currently on duty' },
  { value: 'closed', label: 'Completed shifts' },
]

function duration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

function timeCell(value) {
  if (!value) return '—'
  return (
    <span className="whitespace-nowrap">
      {formatDate(value)}{' '}
      <span className="font-mono text-xs text-text-muted">
        {value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </span>
  )
}

export default function DutyLogTable() {
  const { user } = useAuth()
  const { officer } = useGuardProfile()
  const uid = user?.uid

  const shiftsQuery = useMemo(
    () => (uid ? query(collection(db, 'guard_shifts'), where('guardUid', '==', uid)) : null),
    [uid],
  )
  const { data, loading, error } = useLiveCollection(shiftsQuery)

  /**
   * Calls booked to this officer — for the one figure on the export that the
   * shift rows cannot prove.
   *
   * ── WHY A SECOND QUERY AND NOT A FIELD ON THE SHIFT ────────────────
   * A shift document records when an officer clocked in and out; nothing
   * increments a counter on it when a call is dispatched to them, and adding
   * one would mean a write to the shift on every dispatch — a second place for
   * the same fact to be wrong, on the hot path of an emergency.
   *
   * Counting the incidents instead means the number is always the incidents
   * collection's own answer. It is scoped by `assignedGuardUid`, which the
   * rules already let staff read.
   */
  const incidentsQuery = useMemo(
    () => (uid ? query(collection(db, 'incidents'), where('assignedGuardUid', '==', uid)) : null),
    [uid],
  )
  const { data: incidentData } = useLiveCollection(incidentsQuery)

  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [range, setRange] = useState('30')
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const shifts = useMemo(
    () =>
      (data ?? [])
        .map(mapShiftDoc)
        // Newest first: the shift someone is looking for is almost always the
        // one they just finished.
        .sort((a, b) => (b.timeIn?.getTime() ?? 0) - (a.timeIn?.getTime() ?? 0)),
    [data],
  )

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 86400000
    return shifts
      .filter((s) => (s.timeIn?.getTime() ?? 0) >= cutoff)
      .filter((s) => (state === 'open' ? s.open : state === 'closed' ? !s.open : true))
      .filter((s) =>
        term
          ? `${s.shift} ${s.handover?.summary ?? ''} ${s.handover?.outstanding ?? ''}`
              .toLowerCase()
              .includes(term)
          : true,
      )
  }, [shifts, search, state, range])

  // Page back to 1 whenever the filters change the result set, or a filter that
  // shortens the list leaves the reader on a page that no longer exists.
  useEffect(() => {
    setPage(1)
  }, [search, state, range])

  /**
   * Incidents inside the SAME window the rows are filtered to, so the figure
   * and the table describe one period. `reportedAt` is the clock the window is
   * measured on — the same field the range filter uses for a shift's `timeIn`
   * — rather than `resolvedAt`, which would drop a call still open at the end
   * of the range and make a busy week look quiet.
   */
  const incidentsHandled = useMemo(() => {
    if (!incidentData) return null
    const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 86400000
    return incidentData.filter((d) => {
      const at = d.reportedAt?.toDate ? d.reportedAt.toDate() : d.reportedAt
      return at ? new Date(at).getTime() >= cutoff : false
    }).length
  }, [incidentData, range])

  const pageRows = rows.slice((page - 1) * rowsPerPage, page * rowsPerPage)
  const filtersActive = Boolean(search) || state !== 'all' || range !== 'all'
  const totalMinutes = rows.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)

  function exportPdf() {
    exportDutyLogPdf({
      officer,
      // EXPORTS WHAT IS ON SCREEN, filters and all — `rows`, not `shifts`. An
      // export that quietly ignored the filters would hand someone a 90-day
      // document when the screen in front of them showed seven days.
      shifts: rows,
      filterLabel: RANGES.find((r) => r.value === range)?.label ?? 'All time',
      incidentsHandled,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search handover notes"
          className="min-w-[14rem] flex-1"
        />
        <Select ariaLabel="Shift state" value={state} onChange={setState} options={STATES} className="min-w-[11rem]" />
        <Select ariaLabel="Date range" value={range} onChange={setRange} options={RANGES} className="min-w-[10rem]" />
        <button
          type="button"
          onClick={exportPdf}
          disabled={loading || rows.length === 0}
          className="btn btn-sm btn-brand"
          title={rows.length === 0 ? 'Nothing to export in this range' : undefined}
        >
          <Download size="sm" aria-hidden="true" />
          Export PDF
        </button>
      </div>

      {/* The totals strip. Derived from `rows`, so it always describes the
          table beneath it rather than the unfiltered history. */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="neutral" size="sm">
          {rows.length} shift{rows.length === 1 ? '' : 's'}
        </StatusBadge>
        <StatusBadge tone="neutral" size="sm">
          {duration(totalMinutes)} on duty
        </StatusBadge>
      </div>

      <Card className="overflow-hidden p-0">
        <DataTable
          scroll="x"
          sticky={false}
          minWidth="40rem"
          columns={[
            { header: <>Shift</> },
            { header: <>Time in</> },
            { header: <>Time out</> },
            { header: <>Duration</> },
            { header: <>Handover</> },
          ]}
        >
              {error ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-danger">Could not load your duty history.</p>
                    {/* The code matters: a permission-denied points at
                        firestore.rules (guard_shifts), not at the query. */}
                    <p className="mt-1 text-xs text-text-secondary">
                      {error.code ? `Firestore error: ${error.code}` : error.message}
                    </p>
                  </td>
                </tr>
              ) : loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-t border-divider">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <Skeleton className="h-3 w-24" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center">
                    <ShieldOff size="lg" className="mx-auto mb-2 text-text-muted" />
                    <p className="text-sm text-text-secondary">
                      {filtersActive
                        ? 'No shifts match these filters.'
                        : 'No shifts recorded yet. Clock in from the dashboard to start one.'}
                    </p>
                  </td>
                </tr>
              ) : (
                pageRows.map((shift) => (
                  <tr key={shift.id} className="border-t border-divider">
                    <td className="px-4 py-3.5">
                      <span className="font-medium text-text-primary">
                        {shift.shift ? shift.shift.charAt(0).toUpperCase() + shift.shift.slice(1) : 'Shift'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-text-secondary">{timeCell(shift.timeIn)}</td>
                    <td className="px-4 py-3.5 text-text-secondary">
                      {shift.open ? (
                        <StatusBadge tone="success" size="sm">
                          On duty
                        </StatusBadge>
                      ) : (
                        timeCell(shift.timeOut)
                      )}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-text-secondary">
                      {duration(shift.durationMinutes)}
                    </td>
                    <td className="max-w-xs px-4 py-3.5 text-text-secondary">
                      {shift.handover?.summary ? (
                        <span className="line-clamp-2 text-xs leading-relaxed">
                          {shift.handover.summary}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted">{shift.open ? '—' : 'None filed'}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
        </DataTable>
      </Card>

      <TablePagination
        page={page}
        rowsPerPage={rowsPerPage}
        totalItems={rows.length}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        itemLabel="shift"
      />
    </div>
  )
}
