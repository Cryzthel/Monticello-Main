import { useMemo, useState } from 'react'
import { collection, query, doc, deleteDoc } from 'firebase/firestore'
import { ClipboardList, Search, ShieldOff, UserX } from '@shared/icons'
import Card from '@shared/components/Card'
import SectionHeading from '@shared/components/SectionHeading'
import Select from '@shared/components/Select'
import ResidentAvatar from '@/components/ResidentAvatar'
import ShiftRecordDrawer from './ShiftRecordDrawer'
import OverflowMenu from '@shared/components/OverflowMenu'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { isTestIdentity } from '@shared/lib/identity'
import { db } from '@shared/lib/firebase'
import { mapShiftDoc } from '@shared/lib/shifts'
import { mapIncidentDoc, formatMinutes } from '@shared/lib/incidents'
import { Skeleton } from '@shared/components/Skeleton'
import SearchField from '@shared/components/SearchField'

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
      {value.toLocaleDateString()}{' '}
      <span className="font-mono text-xs text-text-muted">{value.toLocaleTimeString()}</span>
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
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

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

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const cutoff = range === 'all' ? null : Date.now() - Number(range) * 86400000

    return shifts
      .filter((s) => (state === 'open' ? s.open : state === 'closed' ? !s.open : true))
      .filter((s) => (cutoff ? (s.timeIn?.getTime() ?? 0) >= cutoff : true))
      .filter((s) => (term ? `${s.name} ${s.email}`.toLowerCase().includes(term) : true))
      // Most recent shift first — that's the one an admin is usually checking.
      .sort((a, b) => (b.timeIn?.getTime() ?? 0) - (a.timeIn?.getTime() ?? 0))
  }, [shifts, search, range, state])

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

  /**
   * Revokes the guard's dashboard access.
   *
   * Deletes `staff_accounts/{uid}` — the single source of truth every
   * firestore.rules role check reads — so access is cut immediately and for
   * every collection at once. The SHIFT records are deliberately left intact:
   * they are the timesheet an incident response was judged against, and
   * removing them would erase history to tidy up a directory.
   */
  async function deleteAccountConfirmed() {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteDoc(doc(db, 'staff_accounts', deleting.guardUid))
      setDeleting(null)
    } catch (err) {
      console.error('Could not delete staff account', err)
    } finally {
      setBusy(false)
    }
  }
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
        <div className="custom-scrollbar max-h-[28rem] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="table-head">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Time in</th>
                <th className="px-4 py-3 font-medium">Time out</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
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
                      {search || state !== 'all' || range !== 'all'
                        ? 'No shifts match these filters.'
                        : 'No shifts recorded yet. Guards clock in from the Guardhouse portal.'}
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((shift) => (
                  <tr
                    key={shift.id}
                    onClick={() => setSelectedId(shift.id)}
                    className="data-row cursor-pointer border-t border-divider"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <ResidentAvatar name={shift.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text-primary">{shift.name}</p>
                          {shift.open ? (
                            <p className="flex items-center gap-1.5 text-caption font-semibold text-success">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                              On duty ·{' '}
                              {shift.durationMinutes != null
                                ? formatMinutes(shift.durationMinutes)
                                : '—'}
                            </p>
                          ) : (
                            <p className="text-caption text-text-muted">
                              {shift.durationMinutes != null
                                ? formatMinutes(shift.durationMinutes)
                                : '—'}{' '}
                              on duty
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-text-secondary">{shift.email || '—'}</td>
                    <td className="px-4 py-3.5 text-text-secondary">{timeCell(shift.timeIn)}</td>
                    <td className="px-4 py-3.5 text-text-secondary">
                      {shift.open ? (
                        <span className="text-success">Still on duty</span>
                      ) : (
                        timeCell(shift.timeOut)
                      )}
                    </td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedId(shift.id)}
                          className="btn btn-sm btn-outline"
                        >
                          <ClipboardList size="sm" />
                          View shift record
                        </button>
                        <OverflowMenu
                          ariaLabel={`Actions for ${shift.name}`}
                          items={[
                            {
                              label: 'Delete account',
                              icon: UserX,
                              tone: 'danger',
                              onSelect: () => setDeleting(shift),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ShiftRecordDrawer
        shift={selected}
        nextShiftStart={nextShiftStart}
        incidents={incidents}
        onClose={() => setSelectedId(null)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        busy={busy}
        tone="danger"
        title="Delete this staff account?"
        message={`${deleting?.name ?? 'This guard'} will immediately lose access to the Guardhouse and Admin portals. Their shift history is kept for the audit record.`}
        confirmLabel="Delete account"
        onConfirm={deleteAccountConfirmed}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
