import { useEffect, useMemo, useState } from 'react'
import { collection, query } from 'firebase/firestore'
import { ClipboardList, ShieldOff } from '@shared/icons'
import Card from '@shared/components/Card'
import SectionHeading from '@shared/components/SectionHeading'
import Select from '@shared/components/Select'
import ResidentAvatar from '@/components/ResidentAvatar'
import ShiftRecordDrawer from './ShiftRecordDrawer'
import GuardShiftRecordModal from './GuardShiftRecordModal'
import Pill from '@shared/components/Pill'
import TablePagination from '@shared/components/TablePagination'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { isTestIdentity } from '@shared/lib/identity'
import { db } from '@shared/lib/firebase'
import { mapShiftDoc } from '@shared/lib/shifts'
import { mapIncidentDoc, formatMinutes } from '@shared/lib/incidents'
import { Skeleton } from '@shared/components/Skeleton'
import SearchField from '@shared/components/SearchField'
import { formatDate, formatTime } from '@shared/lib/dates'
import DataTable from '@shared/components/DataTable'

const RANGES = [
  { value: 'all', label: 'All time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
]

const STATES = [
  { value: 'all', label: 'All shifts' },
  { value: 'open', label: 'Currently on duty' },
  { value: 'closed', label: 'Completed shifts' },
]

function timeCell(value) {
  if (!value) return '—'
  return (
    <span className="whitespace-nowrap">
      {formatDate(value)}{' '}
      <span className="font-mono text-xs text-text-muted">{formatTime(value)}</span>
    </span>
  )
}

/**
 * Security On-Duty History — the guard shift log.
 *
 * Reads `guard_shifts` live. Rows are the timesheet; the drawer derives what the
 * guard actually DID from the incident records stamped inside the shift window
 * (see shiftActivity), so the two can never disagree.
 */
export default function OnDutyHistoryTable() {
  const [search, setSearch] = useState('')
  const [range, setRange] = useState('7')
  const [state, setState] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [openGuard, setOpenGuard] = useState(null)
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const shiftsQuery = useMemo(() => query(collection(db, 'guard_shifts')), [])
  const { data: rawShifts, loading, error } = useLiveCollection(shiftsQuery)

  // The drawer needs incidents to derive activity. Loaded here once rather than
  // per-open so switching between guards is instant.
  const incidentsQuery = useMemo(() => query(collection(db, 'incidents')), [])
  const { data: rawIncidents } = useLiveCollection(incidentsQuery)
  const incidents = useMemo(() => rawIncidents.map(mapIncidentDoc), [rawIncidents])

  // Seeded test accounts are dropped here, at the top of the pipeline, so they
  // are absent from the table, the search, the drawer AND the "on duty now"
  // count below — all of which read `shifts`. Filtering further down would have
  // left a fake guard inflating the count.
  //
  // The records are not deleted; see shared/lib/identity.js for why, and for
  // how narrow the match is.
  const shifts = useMemo(
    () =>
      rawShifts
        .map(mapShiftDoc)
        .filter((s) => !isTestIdentity({ name: s.name, email: s.email })),
    [rawShifts],
  )

  /**
   * ONE ROW PER OFFICER, not one per shift.
   *
   * This table used to be a raw timesheet: every clock-in in the system, most
   * recent first. With five guards and a month of history that is 150 rows of
   * the same five names, and the question an admin actually arrives with —
   * "how much has this officer worked, and are they on now?" — could only be
   * answered by reading the whole log and adding it up.
   *
   * The log is not gone, it moved behind the row. `GuardShiftRecordModal` lists that
   * officer's shifts; clicking one still opens `ShiftRecordDrawer` for what
   * they dispatched during it. Nothing was removed, it was nested.
   *
   * THE DATE RANGE FILTERS THE SHIFTS, NOT THE GUARDS, and that is deliberate:
   * narrowing to 7 days should change every officer's totals, not hide the
   * officers who did not work this week. An officer with no shifts in range
   * still appears, with zeroes — which is itself the answer to "who has not
   * been on?".
   */
  const guards = useMemo(() => {
    const cutoff = range === 'all' ? null : Date.now() - Number(range) * 86400000
    const inRange = cutoff
      ? shifts.filter((s) => (s.timeIn?.getTime() ?? 0) >= cutoff)
      : shifts

    const by = new Map()
    for (const s of inRange) {
      // `guardUid` first: two officers can share a display name, and an email
      // can be reassigned. The uid is the account.
      const key = s.guardUid || s.email || s.name
      let g = by.get(key)
      if (!g) {
        g = { key, guardUid: s.guardUid, name: s.name, email: s.email, shifts: [], onDuty: false, lastIn: 0, totalMinutes: 0 }
        by.set(key, g)
      }
      g.shifts.push(s)
      if (s.open) g.onDuty = true
      g.lastIn = Math.max(g.lastIn, s.timeIn?.getTime() ?? 0)
      // Open shifts carry no final duration; counting the running value would
      // make the total climb while an admin reads it.
      if (!s.open) g.totalMinutes += s.durationMinutes ?? 0
    }

    for (const g of by.values()) {
      g.shifts.sort((a, b) => (b.timeIn?.getTime() ?? 0) - (a.timeIn?.getTime() ?? 0))
    }
    return [...by.values()]
  }, [shifts, range])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return guards
      .filter((g) => (state === 'open' ? g.onDuty : state === 'closed' ? !g.onDuty : true))
      .filter((g) => (term ? `${g.name} ${g.email}`.toLowerCase().includes(term) : true))
      // On duty first, then most recently seen: the people working now are the
      // ones an admin is usually looking for.
      .sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || b.lastIn - a.lastIn)
  }, [guards, search, state])

  // Page back to 1 whenever the filters change the result set. Without this a
  // search that narrows 48 rows to 3 leaves you on page 4, looking at an empty
  // table and no obvious reason why.
  const total = rows.length
  useEffect(() => {
    setPage(1)
  }, [total, rowsPerPage])

  const pageRows = useMemo(
    () => rows.slice((page - 1) * rowsPerPage, page * rowsPerPage),
    [rows, page, rowsPerPage],
  )

  const selected = shifts.find((s) => s.id === selectedId) ?? null

  // When this guard next clocked in, if they did. It closes the "work done
  // while clocked out" window the drawer reports — without it, a gap runs to
  // now and would sweep up activity from every later shift as well.
  //
  // Read from the same live `shifts` array the table renders, so a guard
  // clocking back in while an admin has the record open shortens the gap
  // rather than leaving it stale.
  const nextShiftStart = useMemo(() => {
    if (!selected?.timeOut) return null
    const after = selected.timeOut.getTime()
    return shifts
      .filter((s) => s.guardUid === selected.guardUid && s.timeIn && s.timeIn.getTime() > after)
      .reduce((earliest, s) => (!earliest || s.timeIn < earliest ? s.timeIn : earliest), null)
  }, [shifts, selected])

  const onDutyNow = shifts.filter((s) => s.open).length

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading
        title="Security on-duty history"
        description={
          onDutyNow > 0
            ? `${onDutyNow} guard${onDutyNow === 1 ? '' : 's'} currently on duty`
            : 'Shift log with per-shift activity records'
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by guard name or email"
          className="min-w-[14rem] flex-1"
        />
        <Select ariaLabel="Shift state" value={state} onChange={setState} options={STATES} className="min-w-[11rem]" />
        <Select ariaLabel="Date range" value={range} onChange={setRange} options={RANGES} className="min-w-[10rem]" />
      </div>

      <Card className="overflow-hidden p-0">
        {/* `overflow-x-auto` ONLY. This was `max-h-[28rem] overflow-y-auto`,
            which gave the card its own vertical scrollbar inside the page's —
            two bars down the right-hand side, and a wheel that scrolled
            whichever one the pointer happened to be over. Worse, the sticky
            header stuck to the CARD rather than to the viewport, so scrolling
            the page carried the column titles out of sight while the rows they
            label stayed.

            Pagination below is what makes removing the cap safe: the table is
            bounded by rows-per-page now, not by a pixel height. The horizontal
            scroll stays, because six columns genuinely do not fit a narrow
            window and the alternative is a squeezed Email column. */}
        <DataTable
          scroll="x"
          sticky={false}
          minWidth="48rem"
          columns={[
            { header: <>Guard officer</> },
            { header: <>Status</> },
            { header: <>Shifts</> },
            { header: <>Total hours</> },
            { header: <>Last shift</> },
            {},
          ]}
        >
              {error ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-danger">Could not load shift history.</p>
                    {/* Surfacing the code matters: a permission-denied points at
                        firestore.rules (guard_shifts), not at the query. */}
                    <p className="mt-1 text-xs text-text-secondary">
                      {error.code ? `Firestore error: ${error.code}` : error.message}
                    </p>
                  </td>
                </tr>
              ) : loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-t border-divider">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <Skeleton className="h-3 w-24" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center">
                    <ShieldOff size="lg" className="mx-auto mb-2 text-text-muted" />
                    <p className="text-sm text-text-secondary">
                      {search || state !== 'all' || range !== 'all'
                        ? 'No shifts match these filters.'
                        : 'No shifts recorded yet. Guards clock in from the Guardhouse portal.'}
                    </p>
                  </td>
                </tr>
              ) : (
                pageRows.map((guard) => (
                  <tr
                    key={guard.key}
                    onClick={() => setOpenGuard(guard.key)}
                    className="data-row cursor-pointer border-t border-divider"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <ResidentAvatar name={guard.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text-primary">{guard.name}</p>
                          <p className="truncate text-caption text-text-muted">{guard.email || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {guard.onDuty ? (
                        <Pill tone="success" pulse>
                          On duty
                        </Pill>
                      ) : (
                        <Pill>Off duty</Pill>
                      )}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-text-secondary">{guard.shifts.length}</td>
                    <td className="px-4 py-3.5 tabular-nums text-text-secondary">
                      {guard.totalMinutes ? formatMinutes(guard.totalMinutes) : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-text-secondary">
                      {guard.lastIn ? timeCell(new Date(guard.lastIn)) : '—'}
                    </td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenGuard(guard.key)}
                          className="btn btn-sm btn-outline"
                        >
                          <ClipboardList size="sm" />
                          View shift record
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
        </DataTable>
      </Card>

      <TablePagination
        page={page}
        rowsPerPage={rowsPerPage}
        totalItems={total}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        itemLabel="officer"
      />

      {/* Guard first, then one of their shifts. Both can be open: closing the
          shift record returns to the officer's log rather than to the table,
          which is the order an admin reads them in. */}
      {/* Looked up in `guards`, NOT the filtered `rows`: with "Currently on
          duty" selected, a guard clocking out used to drop out of `rows` and
          take the open record with them. */}
      <GuardShiftRecordModal
        guard={guards.find((g) => g.key === openGuard) ?? null}
        onClose={() => setOpenGuard(null)}
        onOpenShift={setSelectedId}
        suspended={Boolean(selectedId)}
      />

      <ShiftRecordDrawer
        shift={selected}
        nextShiftStart={nextShiftStart}
        incidents={incidents}
        onClose={() => setSelectedId(null)}
      />

    </div>
  )
}
