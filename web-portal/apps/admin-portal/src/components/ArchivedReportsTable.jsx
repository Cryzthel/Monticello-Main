import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Search } from '@shared/icons'
import Card from '@shared/components/Card'
import StatusBadge from '@shared/components/StatusBadge'
import TimeframeFilter from '@/components/TimeframeFilter'
import { resolveTimeframe, withinTimeframe } from '@shared/lib/timeframe'
import { unarchiveIncidents } from '@shared/lib/incidents'
import { formatCategory } from '@shared/lib/wpda'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import SearchField from '@shared/components/SearchField'

const STAMP = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
const stamp = (value) => (value ? new Date(value).toLocaleString('en-GB', STAMP).replace(',', '') : '—')

/**
 * Archived reports, with a retention filter over them.
 *
 * ── WHY THIS IS NOT THE DELETED TABLE ──────────────────────────────────────
 * Archived and deleted are different states with different meanings and
 * different exits. A deleted report is in the recycle bin and can be restored
 * or purged; an archived one is a completed record that has been moved out of
 * the working set and can only come back. Folding them into one table would
 * have put a Purge control beside records nobody asked to destroy.
 *
 * The timeframe filter is the reason this page is usable at all: an archive
 * grows without limit, so its default view has to be a recent slice rather
 * than everything ever filed.
 */
export default function ArchivedReportsTable({ incidents = [], loading = false, onOpenReport = null }) {
  const [search, setSearch] = useState('')
  const [timeframe, setTimeframe] = useState({ preset: '30d', from: '', to: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const rows = useMemo(() => {
    const range = resolveTimeframe(timeframe)
    const q = search.trim().toLowerCase()
    return incidents
      .filter((incident) => withinTimeframe(incident.archivedAt, range))
      .filter((incident) =>
        q
          ? [incident.category, incident.location, incident.reportedByName, incident.status]
              .filter(Boolean)
              .some((field) => String(field).toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime())
  }, [incidents, search, timeframe])

  async function restore(id) {
    setBusy(true)
    setError('')
    try {
      await unarchiveIncidents([id])
    } catch (err) {
      setError(err.message ?? 'Could not return this report to the active list.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex min-h-0 flex-col p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline p-4">
        <div className="flex items-center gap-2">
          <Archive size="sm" className="text-brand-400" />
          <p className="text-sm font-semibold text-text-primary">
            Archived reports
            <span className="ml-2 text-xs font-normal text-text-muted">
              {rows.length} in range
            </span>
          </p>
        </div>
        <TimeframeFilter value={timeframe} onChange={setTimeframe} />
      </div>

      <div className="border-b border-hairline p-3">
        <SearchField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search archived reports"
        />
      </div>

      {error ? <p className="px-4 pt-3 text-xs text-danger">{error}</p> : null}

      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto pb-6">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="table-head">
              <th className="px-4 py-3 font-medium">Archived</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Resident</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonTableRows
                rows={6}
                columns={[
                  { width: 'w-24', variant: 'muted' },
                  { width: 'w-24' },
                  { width: 'w-40' },
                  { width: 'w-28' },
                  { variant: 'pill', width: 'w-20' },
                  { empty: true },
                ]}
              />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-text-secondary">
                  {/* Names the FILTER, not just the emptiness — an archive that
                      says "nothing here" while holding a year of records reads
                      as broken. */}
                  No archived reports in this range. Widen the timeframe to see older records.
                </td>
              </tr>
            ) : (
              rows.map((incident) => (
                <tr
                  key={incident.id}
                  onClick={() => onOpenReport?.(incident.id)}
                  className="data-row cursor-pointer border-t border-divider"
                >
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">
                    {stamp(incident.archivedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-text-primary">
                    {formatCategory(incident.category)}
                  </td>
                  <td className="px-4 py-3.5 text-text-secondary">{incident.location ?? '—'}</td>
                  <td className="px-4 py-3.5 text-text-secondary">{incident.reportedByName ?? '—'}</td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={incident.status ?? 'Pending'} />
                  </td>
                  <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => restore(incident.id)}
                        className="btn btn-sm btn-outline"
                      >
                        <ArchiveRestore size="sm" />
                        Unarchive
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
