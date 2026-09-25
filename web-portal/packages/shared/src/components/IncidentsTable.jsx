import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownWideNarrow, Search, Trash2, X } from 'lucide-react'
import Card from '@shared/components/Card'
import PriorityBadge from '@shared/components/PriorityBadge'
import RowActionMenu from './RowActionMenu'
import StatusBadge from '@shared/components/StatusBadge'
import StatusSelect from './StatusControl'
import Select from '@shared/components/Select'
import ConfirmDialog from './ConfirmDialog'
import TablePagination from '@shared/components/TablePagination'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import { INCIDENT_STATUSES } from '@shared/theme/statusStyles'
import { categoryIcon } from '@shared/theme/categoryIcons'
import { formatCategory } from '@shared/lib/wpda'
import { softDeleteIncidents } from '@shared/lib/incidents'
import { displayPersonName } from '@shared/lib/identity'
import { applyIncidentSort, DEFAULT_SORT, SORT_OPTIONS } from '@shared/lib/incidentSort'

const STATUS_FILTERS = ['All', ...INCIDENT_STATUSES]

/**
 * Human-quotable ticket id, derived from the Firestore document id.
 *
 * Not stored — deriving it means there is no second identifier that can drift
 * from the document it names, and no migration for the existing backlog. Eight
 * characters of a 20-character Firestore auto-id is ~41 bits, which is far
 * more than enough to stay unique within one subdivision's incident volume
 * while still being readable down a phone line.
 *
 * Upper-cased because the id is machine data, and set in JetBrains Mono at the
 * call site so it can be compared character-by-character against a list.
 */
function ticketId(id) {
  return id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '—'
}

/**
 * Fixed-width log timestamp: `12 Jul 14:07:32`.
 *
 * `toLocaleString()` produced "7/12/2025, 2:07:32 PM" — variable width, so the
 * column jagged on every row, and ambiguous month/day ordering for a reader
 * outside the locale that wrote it. This form is the same character count for
 * every date in a year, which is what makes the mono column actually align.
 */
const LOG_TIME = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }

function formatLogTime(value) {
  return new Date(value).toLocaleString('en-GB', LOG_TIME).replace(',', '')
}

/**
 * The live incident queue.
 *
 * ── READ-ONLY WITH RESPECT TO STATUS, IN BOTH PORTALS ─────────────────────
 * This table used to take a `canMutateStatus` flag: the Guardhouse passed it
 * and got a dropdown in every Status cell plus Mark Dispatched / Mark Resolved
 * in the row menu, while the Admin queue rendered a badge. That flag is gone,
 * and with it every write path this table had over a report's lifecycle.
 *
 * The reason is not permissions — the Guardhouse still owns status — it is
 * WHERE the decision is made. Advancing a call is a judgement about a place: a
 * unit is on the way there, a unit is standing in the street, the thing is
 * over. The Live Dispatch map is the only surface that shows the place, and
 * every transition it drives also pushes the reporting resident's phone. A
 * dropdown on a table row could send that message with a mis-click, from a
 * screen that shows a lot number and nothing else.
 *
 * So the Status column is now a static `StatusBadge` on every console — an
 * oblong `rounded-full` capsule with no hover state and no chevron, which is
 * this design system's rule for a STATE as opposed to a control. Status
 * mutation lives in DispatchDetailDrawer, reached by clicking a pin.
 *
 * Deletion here is SOFT only — it stamps `deletedAt` and the report moves to
 * Audit History -> Deleted Reports, which is the sole surface that can restore
 * it or destroy it. This table has no restore or hard-delete path at all, so
 * the destructive tier cannot be reached from the day-to-day working queue.
 */
export default function IncidentsTable({
  incidents = [],
  onSelect,
  compact = false,
  limit,
  /** Skips the panel chrome when the caller already provides a card. */
  bare = false,
  /**
   * Whether the incident subscription is still opening.
   *
   * Without it this table renders "No incidents match." during the initial
   * snapshot — a sentence that is not merely uninformative but false, and one
   * an operator can act on: it reads as "the queue is clear", which on a
   * security console is the single worst thing a loading state can claim. The
   * empty row stays correct once the feed has actually delivered an empty
   * array; it just must not be reachable before then.
   */
  loading = false,
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  // `null` when closed; otherwise { ids: string[] } for a pending soft delete.
  const [confirming, setConfirming] = useState(null)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // ── REAL-TIME ARRIVALS ───────────────────────────────────────────────────
  //
  // Ids seen on a previous render. Anything not in here is new since the last
  // snapshot and gets the one-shot flash.
  //
  // Seeded on FIRST render rather than starting empty, which is the whole
  // subtlety: an empty seed makes every row on initial load "new", so the table
  // would flash top to bottom the moment it mounts — turning a signal that
  // means "look here" into wallpaper.
  const seenIds = useRef(null)
  const [freshIds, setFreshIds] = useState(() => new Set())

  useEffect(() => {
    const currentIds = new Set(incidents.map((incident) => incident.id))

    if (seenIds.current === null) {
      seenIds.current = currentIds
      return undefined
    }

    const arrivals = [...currentIds].filter((id) => !seenIds.current.has(id))
    seenIds.current = currentIds
    if (arrivals.length === 0) return undefined

    setFreshIds((prev) => new Set([...prev, ...arrivals]))
    // Cleared after the animation so a row that stays on screen for an hour is
    // not permanently marked "new" — and so re-sorting does not re-trigger it.
    const timer = setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev)
        arrivals.forEach((id) => next.delete(id))
        return next
      })
    }, 2200)
    return () => clearTimeout(timer)
  }, [incidents])

  // Filter → sort → page, as three memos rather than one. Only the last of them
  // re-runs when the operator turns a page, so paging a few hundred rows does
  // not re-filter and re-sort the whole set on every click.
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return incidents.filter((incident) => {
      if (statusFilter !== 'All' && incident.status !== statusFilter) return false
      if (!term) return true
      const haystack = [
        ticketId(incident.id),
        incident.reportedByName,
        formatCategory(incident.category),
        incident.location,
        incident.title,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [incidents, statusFilter, query])

  const sorted = useMemo(() => applyIncidentSort(filtered, sort), [filtered, sort])

  // Compact embeds (the dashboard's "Recent incidents" card) take a flat slice
  // and never paginate — a card that grew page controls would be a second,
  // competing queue on the overview.
  const paginated = compact
  const totalItems = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage))

  // Clamped rather than reset. If a bulk delete shortens the list while the
  // operator is on page 5 of 5, resetting to page 1 loses their place; clamping
  // lands them on the new last page, which is where the rows they were looking
  // at now live.
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  // Filtering or re-sorting DOES return to page 1 — the result set is now a
  // different thing, so "page 4 of the old query" is not a position worth
  // preserving.
  useEffect(() => {
    setPage(1)
  }, [query, statusFilter, sort, rowsPerPage])

  const rows = useMemo(() => {
    if (paginated) return limit ? sorted.slice(0, limit) : sorted
    const start = (Math.min(page, totalPages) - 1) * rowsPerPage
    return sorted.slice(start, start + rowsPerPage)
  }, [sorted, paginated, limit, page, totalPages, rowsPerPage])


  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id))

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((row) => row.id)))
  }

  async function runConfirmed() {
    if (!confirming) return
    setBulkUpdating(true)
    try {
      // Soft delete — the documents survive in Audit History -> Deleted Reports.
      await softDeleteIncidents(confirming.ids)
      setSelectedIds(new Set())
      setConfirming(null)
    } catch (err) {
      console.error('Bulk delete failed', err)
    } finally {
      setBulkUpdating(false)
    }
  }

  // Avoids a panel-inside-a-panel double border when a caller supplies its own
  // card (e.g. the Overview's "Recent incidents" container).
  const Shell = bare ? 'div' : Card
  const shellClass = bare
    ? 'flex h-full min-h-0 flex-col overflow-hidden'
    : 'flex h-full min-h-0 flex-col overflow-hidden p-0'

  return (
    <Shell className={shellClass}>
      {/* Toolbar baseline: every control is h-9. The search field used to be
          py-2 (≈38px) next to a 32px filter pill and a free-floating count, so
          nothing in the row shared an edge. One height token plus
          `items-center` and the three align top and bottom. */}
      {!compact ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline p-4">
          <div className="flex h-9 min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 transition-[border-color,box-shadow] duration-150 hover:border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
            <Search className="h-4 w-4 shrink-0 text-text-secondary" />
            <input
              type="text"
              className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
              placeholder="Search by ID, resident, category, or location"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {/* No width override: the control's own min-w is already sized to
              its longest option, and the old `min-w-[9rem]` on a two-character
              "All" was the dead space. */}
          {/* The rose "SOS Reports" button that sat here is gone. Panic
              alerts are a destination, not a tool for working this table, and
              a permanently-red control in a toolbar of neutral ones spent its
              urgency on a page where nothing was urgent. It is a sidebar entry
              now, beside the other destinations. */}
          <StatusSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTERS} />
          {/* The ONE sort control: newest or oldest, nothing else.
              Clickable column headers used to drive four more fields from a
              second piece of state. Both are gone — a queue watched all shift
              is easier to trust when its order cannot silently be something
              other than "what arrived when", and one control has one obvious
              current value where a header chevron four columns over does not.
              The row count that sat here is gone too: the pagination footer
              states it more precisely, and two counts in one panel invite the
              reader to work out why they differ. */}
          <Select
            ariaLabel="Sort tickets by date reported"
            prefix={<ArrowDownWideNarrow className="h-3.5 w-3.5" />}
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS}
            className="min-w-[11rem]"
          />
        </div>
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="flex items-center gap-3 border-b border-hairline bg-brand-50 px-4 py-2.5">
          <span className="text-xs font-medium text-text-primary">{selectedIds.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={bulkUpdating}
              onClick={() => setConfirming({ ids: [...selectedIds] })}
              className="btn btn-sm btn-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {`Delete ${selectedIds.size} report${selectedIds.size === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              aria-label="Clear selection"
              className="icon-btn icon-btn-sm"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-auto pb-6">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            {/* Column heads use the shared .table-head scale: small grey
                sentence-case labels on the pale band, as in every table. */}
            <tr className="table-head">
              {!compact ? (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded-lg border-slate-200 bg-base-800 accent-brand-500"
                  />
                </th>
              ) : null}
              {!compact ? <th className="w-[7.5rem] px-4 py-3 text-left">Ticket</th> : null}
              <th className="px-4 py-3 text-left">Category</th>
              <th className="px-4 py-3 text-left">Location</th>
              <th className="px-4 py-3 text-left">Resident</th>
              <th className="w-[10rem] px-4 py-3 text-left">Status</th>
              {/* `aria-sort` on the one column the table IS ordered by. Plain
                  headers everywhere else, so a screen reader is not told four
                  columns are sortable when none of them are clickable. */}
              <th
                scope="col"
                aria-sort={sort === 'oldest' ? 'ascending' : 'descending'}
                className="w-[11rem] px-4 py-3 text-left"
              >
                Reported
              </th>
              {!compact ? <th className="w-14 px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              /* Column descriptors, not a row count — the placeholder cells
                 have to land in the same `<td>`s the real ones will, or the
                 grid shifts sideways on swap. The widths mirror each column's
                 real content: a short ticket code, a category, a long address,
                 a resident name, a status pill, a timestamp. */
              <SkeletonTableRows
                rows={compact ? Math.min(limit ?? 6, 6) : 8}
                cellClassName="px-4 py-3"
                columns={
                  compact
                    ? [
                        { width: 'w-24' },
                        { width: 'w-36' },
                        { width: 'w-28' },
                        { variant: 'pill', width: 'w-20' },
                        { width: 'w-24', variant: 'muted' },
                      ]
                    : [
                        { width: 'w-4', className: 'w-10' },
                        { width: 'w-20' },
                        { width: 'w-24' },
                        { width: 'w-40' },
                        { width: 'w-28' },
                        { variant: 'pill', width: 'w-24' },
                        { width: 'w-24', variant: 'muted' },
                        { width: 'w-4', className: 'w-14' },
                      ]
                }
              />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={compact ? 5 : 8} className="px-4 py-10 text-center text-text-secondary">
                  No incidents match.
                </td>
              </tr>
            ) : (
              rows.map((incident) => (
                <tr
                  key={incident.id}
                  onClick={() => onSelect?.(incident)}
                  // The flash decays over 2s and then the class is dropped, so
                  // a row is never permanently marked new. `forwards` is
                  // deliberately absent — the end state is transparent, which
                  // is also the resting state, so there is nothing to hold.
                  className={`data-row cursor-pointer border-t border-divider ${
                    freshIds.has(incident.id) ? 'animate-[rowFlash_2s_ease-out]' : ''
                  }`}
                >
                  {!compact ? (
                    <td className="px-4 py-3.5" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(incident.id)}
                        onChange={() => toggleRow(incident.id)}
                        className="h-3.5 w-3.5 rounded-lg border-slate-200 bg-base-800 accent-brand-500"
                      />
                    </td>
                  ) : null}
                  {/* Machine data — mono, so an operator reading an id off a
                      radio can compare it glyph-by-glyph against the column. */}
                  {!compact ? (
                    <td className="px-4 py-3.5 font-mono text-xs font-medium text-text-secondary">
                      {ticketId(incident.id)}
                    </td>
                  ) : null}
                  <td className="px-4 py-3.5">
                    <PriorityBadge severity={incident.severity} icon={categoryIcon(incident.category)}>
                      {formatCategory(incident.category)}
                    </PriorityBadge>
                  </td>
                  {/* Type hierarchy across the row: Location is the primary
                      identifier (medium, full white), Reporter is supporting
                      detail (regular, secondary), Reported is metadata
                      (secondary + tabular figures so the column scans as a
                      single aligned block). */}
                  <td className="whitespace-nowrap px-4 py-3.5 font-medium text-text-primary">{incident.location ?? 'Unknown'}</td>
                  {/* `displayPersonName`, not the raw field: documents seeded
                      by the test script store `resident.0` here, and a triage
                      queue naming a resident by a seed handle is worse than
                      naming them by role. See shared/lib/identity.js. */}
                  <td className="px-4 py-3.5 text-text-secondary">
                    {displayPersonName(incident.reportedByName, 'Resident')}
                  </td>
                  {/* ── A PILL, NEVER A CONTROL ─────────────────────────
                      Every row on every console, with no branch left to take.
                      The `canMutateStatus` dropdown that used to render here
                      for the Guardhouse is gone — see this component's header
                      note for why the decision moved to the dispatch map
                      rather than merely being restricted.

                      `StatusBadge` is the oblong `rounded-full` capsule the
                      design system reserves for a STATE: no hover, no chevron,
                      nothing that invites a press. A greyed-out dropdown would
                      still say "you may set this, just not now", which is the
                      wrong statement — there is no "not now" here, the
                      authority simply lives on another screen.

                      The cell keeps its `stopPropagation` so a click anywhere
                      in the Status column is inert rather than opening the
                      detail modal by accident — a guard reaching for a control
                      that used to be here should get nothing, not a dialog. */}
                  <td className="px-4 py-3.5" onClick={(event) => event.stopPropagation()}>
                    <StatusBadge status={incident.status ?? 'Pending'} />
                  </td>
                  {/* Log timestamp — mono + tnum, so the column aligns on the
                      separators without a fixed-width hack. */}
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">
                    {incident.reportedAt ? formatLogTime(incident.reportedAt) : '—'}
                  </td>
                  {!compact ? (
                    <td className="px-4 py-3.5 text-right" onClick={(event) => event.stopPropagation()}>
                      {/* ONE honest entry. `onDispatch`/`onResolve` are not
                          passed by anybody any more, and RowActionMenu renders
                          a mutating row only when its handler exists — so the
                          menu is exactly "View details" on both consoles.

                          The props still exist on RowActionMenu because the
                          Residents table uses the same menu for Approve /
                          Reject, which is a different decision on a different
                          record. */}
                      <RowActionMenu onView={() => onSelect?.(incident)} />
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Sibling of the scroll region, not inside it — see TablePagination for
          why that is what keeps it pinned at every resolution. Hidden on the
          compact embed, which shows a fixed slice and has no pages. */}
      {!compact ? (
        <TablePagination
          page={page}
          rowsPerPage={rowsPerPage}
          totalItems={totalItems}
          onPageChange={setPage}
          onRowsPerPageChange={setRowsPerPage}
          itemLabel="incident ticket"
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirming)}
        busy={bulkUpdating}
        tone="danger"
        title={`Delete ${confirming?.ids.length ?? 0} report${confirming?.ids.length === 1 ? '' : 's'}?`}
        message="Are you sure you want to delete the selected report(s)? They will be moved to Deleted Reports."
        confirmLabel="Delete"
        onConfirm={runConfirmed}
        onCancel={() => setConfirming(null)}
      />
    </Shell>
  )
}
