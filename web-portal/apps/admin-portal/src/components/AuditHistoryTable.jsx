import { useEffect, useMemo, useState } from 'react'
import { History, Search, ShieldAlert, Trash2, X } from 'lucide-react'
import Card from '@shared/components/Card'
import TablePagination from '@shared/components/TablePagination'
import StatusBadge from '@shared/components/StatusBadge'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import OverflowMenu from '@shared/components/OverflowMenu'
import { dismissAuditEvents, describeFirestoreError } from '@shared/lib/audit'
import { Skeleton } from '@shared/components/Skeleton'
import { auditEventIcon } from '@shared/theme/categoryIcons'

// Audit action -> badge tone. Deliberately the same tone vocabulary the
// incident status badges use, so "Resolved" is the same green here as on a
// ticket; the pill itself is drawn by the one shared StatusBadge.
const CATEGORY_TONE = {
  Deleted: 'danger',
  Resolved: 'success',
  Dispatched: 'info',
  Published: 'brand',
}

/**
 * The system-events table.
 *
 * WHAT WAS BROKEN
 * ---------------
 * The delete handler wrote the dismissal and then only cleared the dialog
 * INSIDE the try block, so any failure — overwhelmingly a `permission-denied`
 * from undeployed rules — was caught, logged to a console nobody has open, and
 * left the modal sitting there with the row still present. From the operator's
 * side that is indistinguishable from a dead button.
 *
 * Three changes make the outcome always visible:
 *
 *  1. Failures surface IN THE UI, naming the likely remedy, and the dialog
 *     closes either way so the table is never held hostage by a modal.
 *  2. The dismissal is applied OPTIMISTICALLY to local state, so the row goes
 *     the instant the write resolves rather than waiting for the round-trip
 *     back through onSnapshot — and is rolled back if the write throws.
 *  3. `readError` is surfaced too. A denied READ of `audit_dismissals` is the
 *     nastier half of the same bug: the write can succeed while the collection
 *     reads back empty, so the row silently reappears and the delete looks
 *     like it "didn't save". Previously that error was discarded entirely.
 *
 * Batch delete was also simply missing — there was no way to select rows at
 * all. Selection is keyed by event id, not row index, so a live onSnapshot
 * reordering the table cannot retarget a checked selection at a different row.
 */
export default function AuditHistoryTable({
  events = [],
  loading = false,
  readError = null,
  resolveRole = () => '—',
  search,
  onSearchChange,
  /**
   * How many events exist before this view's search narrows them. Only used
   * for the "3 of 18" reading in the toolbar; when it is absent the count
   * falls back to reporting just what is on screen.
   */
  totalCount = null,
  /** Opens the full report behind an incident-derived row. */
  onOpenReport = null,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  // Ids removed in this session. Merged over the server list so the table
  // updates on commit instead of on the snapshot that follows it.
  const [optimistic, setOptimistic] = useState(() => new Set())
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const rows = useMemo(
    () => events.filter((event) => !optimistic.has(event.id)),
    [events, optimistic],
  )

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  useEffect(() => {
    setPage(1)
  }, [rowsPerPage])

  const pageRows = useMemo(() => {
    const start = (Math.min(page, totalPages) - 1) * rowsPerPage
    return rows.slice(start, start + rowsPerPage)
  }, [rows, page, totalPages, rowsPerPage])

  // SELECT-ALL MEANS THIS PAGE, not the whole filtered set. The action behind
  // this checkbox is a bulk DELETE, and a checkbox sitting above ten visible
  // rows that silently arms four hundred invisible ones is the kind of control
  // that is only safe until the first time someone is in a hurry.
  const allSelected = pageRows.length > 0 && pageRows.every((row) => selectedIds.has(row.id))

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(pageRows.map((row) => row.id)))
  }

  async function runDelete() {
    if (!confirming) return
    const targets = confirming.events
    const ids = targets.map((event) => event.id)

    setBusy(true)
    setError('')
    // Optimistic: hide immediately, restore if the commit rejects.
    setOptimistic((prev) => new Set([...prev, ...ids]))
    setConfirming(null)

    try {
      await dismissAuditEvents(targets)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
    } catch (err) {
      console.error('Could not remove audit entries', err)
      setOptimistic((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      setError(describeFirestoreError(err, 'delete those entries'))
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = selectedIds.size

  // The word after the figures agrees with whichever figure it follows.
  const filtering = Boolean(search && search.trim())
  const countedForPlural = filtering && totalCount != null ? totalCount : rows.length

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      {/* Toolbar — every control on one h-9 baseline. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline p-4">
        <div className="flex h-9 min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4">
          <Search className="h-4 w-4 shrink-0 text-text-secondary" />
          <input
            type="text"
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            placeholder="Search by actor, action type, or description"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        {/*
          "3 of 18 events" while searching, "18 events" otherwise.

          The `of` half is gated on the SEARCH being active, not on the two
          numbers differing. Those are not the same test: deleting a row
          shortens `rows` a beat before the snapshot shortens `totalCount`, so
          a difference-based test would flash "17 of 18" at someone who is not
          filtering anything and imply a filter they never set.

          `tabular-nums`, not `font-mono`, which is what this was. A monospace
          face to line up two figures is the exact thing the stylesheet's own
          rule refuses; Inter's tabular figures are already fixed-width.
        */}
        <span className="flex h-9 shrink-0 items-center gap-1 text-xs text-text-secondary">
          <span className="font-medium tabular-nums text-text-primary">{rows.length}</span>
          {filtering && totalCount != null ? (
            <span className="tabular-nums">of {totalCount}</span>
          ) : null}
          <span>event{countedForPlural === 1 ? '' : 's'}</span>
        </span>
      </div>

      {/* A denied read is silent by nature — the collection just comes back
          empty — so it has to be stated, or a dismissal that DID save looks
          like it was ignored. */}
      {readError ? (
        <p className="flex items-start gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2.5 text-xs text-danger">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Deleted entries can’t be loaded, so removed rows may reappear.{' '}
          {describeFirestoreError(readError, 'load dismissals')}
        </p>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2.5 text-xs text-danger">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-0.5 hover:bg-danger/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      ) : null}

      {selectedCount > 0 ? (
        <div className="flex items-center gap-3 border-b border-hairline bg-brand-50 px-4 py-2.5">
          <span className="text-xs font-medium text-text-primary">
            <span className="font-mono">{selectedCount}</span> selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setConfirming({ events: rows.filter((row) => selectedIds.has(row.id)) })
              }
              className="btn btn-sm btn-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {`Delete ${selectedCount} ${selectedCount === 1 ? 'entry' : 'entries'}`}
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
            <tr className="table-head">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all events"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                />
              </th>
              <th className="w-[13rem] px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="w-[9rem] px-4 py-3">Category</th>
              <th className="px-4 py-3">Event description</th>
              <th className="w-14 px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-divider">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <Skeleton className="h-3 w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <History className="mx-auto mb-2 h-6 w-6 text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    {search ? 'No events match that search.' : 'No events recorded yet.'}
                  </p>
                </td>
              </tr>
            ) : (
              pageRows.map((event) => {
                const Icon = event.icon
                const checked = selectedIds.has(event.id)
                return (
                  // ── THE ROW OPENS THE REPORT; THE CHECKBOX SELECTS IT ──
                  //
                  // Clicking anywhere on a row used to toggle its checkbox,
                  // which made the whole table a selection surface and left an
                  // admin reading "Security report at Phase 2 was resolved"
                  // with no way to see what was in it — they left for Security
                  // Reports and found it again by hand.
                  //
                  // Selection has not moved: the checkbox cell already stops
                  // propagation and is still the control for bulk delete. Rows
                  // with nothing behind them — a published announcement — keep
                  // the old toggle, because there is no report to open.
                  <tr
                    key={event.id}
                    onClick={() =>
                      event.reportId && onOpenReport
                        ? onOpenReport(event.reportId)
                        : toggleRow(event.id)
                    }
                    role={event.reportId && onOpenReport ? 'button' : undefined}
                    tabIndex={event.reportId && onOpenReport ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!event.reportId || !onOpenReport) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenReport(event.reportId)
                      }
                    }}
                    className={`cursor-pointer border-t border-divider transition ${
                      checked ? 'bg-brand-50' : 'hover:bg-tint/[0.03]'
                    }`}
                  >
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${event.category} event`}
                        checked={checked}
                        onChange={() => toggleRow(event.id)}
                        className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">
                      {event.at ? formatLogTime(event.at) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span className="flex items-center gap-2 font-medium text-text-primary">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        {event.actor}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-text-secondary">
                      {resolveRole(event.actor)}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge
                        tone={CATEGORY_TONE[event.category] ?? 'neutral'}
                        icon={auditEventIcon(event.category)}
                      >
                        {event.category}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3.5 text-text-secondary">{event.description}</td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <OverflowMenu
                          ariaLabel={`Actions for ${event.category} event`}
                          items={[
                            {
                              label: 'Delete entry',
                              icon: Trash2,
                              tone: 'danger',
                              onSelect: () => setConfirming({ events: [event] }),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <TablePagination
        page={page}
        rowsPerPage={rowsPerPage}
        totalItems={rows.length}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        itemLabel="event"
      />

      <ConfirmDialog
        open={Boolean(confirming)}
        busy={busy}
        tone="danger"
        title={
          confirming?.events.length === 1
            ? 'Delete audit log entry?'
            : `Delete ${confirming?.events.length ?? 0} audit log entries?`
        }
        message="The incident or announcement each entry refers to is not affected — only its row in this log is removed."
        confirmLabel="Delete"
        onConfirm={runDelete}
        onCancel={() => setConfirming(null)}
      />
    </Card>
  )
}

// Same fixed-width form the incident queue uses, so the two logs scan alike.
const LOG_TIME = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }

function formatLogTime(value) {
  return new Date(value).toLocaleString('en-GB', LOG_TIME).replace(',', '')
}
