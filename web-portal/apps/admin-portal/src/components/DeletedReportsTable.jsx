import { toast } from '@shared/lib/toast'
import { useMemo, useState } from 'react'
import { RotateCcw, Trash2, X, Trash } from '@shared/icons'
import PriorityBadge from '@shared/components/PriorityBadge'
import StatusBadge from '@shared/components/StatusBadge'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { restoreIncidents, purgeIncidents } from '@shared/lib/incidents'
import { formatCategory } from '@shared/lib/wpda'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import SearchField from '@shared/components/SearchField'
import { formatDateTime } from '@shared/lib/dates'
import DataTable from '@shared/components/DataTable'

/**
 * The recycle bin — the only place Restore and Permanent Delete live.
 *
 * Two-tier pipeline: the ticket queue soft-deletes (stamping `deletedAt`), and
 * this table is where those records are either put back or destroyed. Keeping
 * the destructive tier off the day-to-day queue means routine "delete" can
 * never reach a hard delete by accident.
 *
 * Selection is by document id in a Set rather than an index, so a live
 * onSnapshot update reordering the rows can't silently retarget a checked
 * selection at a different report.
 */
export default function DeletedReportsTable({ incidents = [], loading = false, onOpenReport = null }) {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return incidents
      .filter((incident) => {
        if (!term) return true
        return [incident.reportedByName, formatCategory(incident.category), incident.location]
          .join(' ')
          .toLowerCase()
          .includes(term)
      })
      // Most recently binned first — that's what an admin is usually undoing.
      .sort((a, b) => (b.deletedAt?.getTime?.() ?? 0) - (a.deletedAt?.getTime?.() ?? 0))
  }, [incidents, search])

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id))
  const someSelected = selectedIds.size > 0 && !allSelected

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
    setBusy(true)
    const { kind, ids } = confirming
    const noun = ids.length === 1 ? 'report' : `${ids.length} reports`
    const ok = await toast.run(() => (kind === 'purge' ? purgeIncidents(ids) : restoreIncidents(ids)), {
      success: kind === 'purge' ? `Permanently deleted ${noun}` : `Restored ${noun}`,
      error: kind === 'purge' ? `Could not delete ${noun}` : `Could not restore ${noun}`,
    })
    setBusy(false)
    // A failure keeps the dialog and the selection, so a retry is one click.
    if (!ok) return
    setSelectedIds(new Set())
    setConfirming(null)
  }

  const count = selectedIds.size

  return (
    <div className="data-panel flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline p-4">
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search deleted reports"
          className="min-w-[16rem] flex-1"
        />
        <span className="text-xs text-text-secondary">
          {rows.length} report{rows.length === 1 ? '' : 's'} in trash
        </span>
      </div>

      {/* Batch controls appear only once something is checked. */}
      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline bg-brand-50 px-4 py-2.5">
          <span className="text-xs font-medium text-text-primary">{count} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming({ kind: 'restore', ids: [...selectedIds] })}
              className="btn btn-sm btn-success"
            >
              <RotateCcw size="sm" />
              Restore selected
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming({ kind: 'purge', ids: [...selectedIds] })}
              className="btn btn-sm btn-danger"
            >
              <Trash2 size="sm" />
              Permanently delete selected
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="btn btn-icon-sm text-text-secondary hover:text-text-primary"
            >
              <X size="sm" />
            </button>
          </div>
        </div>
      ) : null}

      <DataTable
        minWidth="56rem"
        scrollClassName="pb-6"
        columns={[
          { header: <><input
                  type="checkbox"
                  aria-label="Select all deleted reports"
                  checked={allSelected}
                  // Indeterminate is a DOM property, not an attribute — it can
                  // only be set through a ref callback like this.
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                /></>, className: 'w-10' },
          { header: <>Category</> },
          { header: <>Location</> },
          { header: <>Resident</> },
          { header: <>Status</> },
          { header: <>Deleted</> },
          { header: <>Deleted by</> },
        ]}
      >
            {loading ? (
              <SkeletonTableRows
                rows={6}
                columns={[
                  // The select-all checkbox gutter. Left blank rather than
                  // given a bar: a placeholder there would read as a checkbox
                  // that is still arriving, and the control is already drawn in
                  // the header above.
                  { empty: true, className: 'w-10' },
                  { width: 'w-24' },
                  { width: 'w-40' },
                  { width: 'w-28' },
                  { variant: 'pill', width: 'w-20' },
                  { width: 'w-24', variant: 'muted' },
                  { width: 'w-24', variant: 'muted' },
                ]}
              />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <Trash size="lg" className="mx-auto mb-2 text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    {search ? 'No deleted reports match that search.' : 'The recycle bin is empty.'}
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((incident) => (
                // Same rule as the Audit History table: the row opens the
                // report, only the checkbox selects. A row click used to toggle
                // selection here, staging a report for permanent purge.
                <tr
                  key={incident.id}
                  onClick={() => onOpenReport?.(incident.id)}
                  role={onOpenReport ? 'button' : undefined}
                  tabIndex={onOpenReport ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || !onOpenReport) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpenReport(incident.id)
                    }
                  }}
                  className={`border-t border-divider transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 ${
                    onOpenReport ? 'cursor-pointer' : ''
                  } ${selectedIds.has(incident.id) ? 'bg-brand-50' : 'hover:bg-tint/[0.03]'}`}
                >
                  <td
                    className="p-0"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <label className="flex h-full cursor-pointer items-center px-4 py-3.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${formatCategory(incident.category)} report`}
                        checked={selectedIds.has(incident.id)}
                        onChange={() => toggleRow(incident.id)}
                        className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                      />
                    </label>
                  </td>
                  <td className="px-4 py-3.5">
                    <PriorityBadge severity={incident.severity}>
                      {formatCategory(incident.category)}
                    </PriorityBadge>
                  </td>
                  <td className="px-4 py-3.5 text-text-primary">{incident.location ?? 'Unknown'}</td>
                  <td className="px-4 py-3.5 text-text-secondary">
                    {incident.reportedByName ?? 'Unknown'}
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={incident.status ?? 'Pending'} />
                  </td>
                  <td className="px-4 py-3.5 text-text-secondary">
                    {formatDateTime(incident.deletedAt)}
                  </td>
                  <td className="px-4 py-3.5 text-text-secondary">
                    {incident.deletedByName || '—'}
                  </td>
                </tr>
              ))
            )}
      </DataTable>

      <ConfirmDialog
        open={Boolean(confirming)}
        busy={busy}
        tone={confirming?.kind === 'purge' ? 'danger' : 'success'}
        title={
          confirming?.kind === 'purge'
            ? `Permanently delete ${confirming.ids.length} report${confirming.ids.length === 1 ? '' : 's'}?`
            : `Restore ${confirming?.ids.length ?? 0} report${confirming?.ids.length === 1 ? '' : 's'}?`
        }
        message={
          confirming?.kind === 'purge'
            ? 'This erases the selected report(s) from the database for good, including their evidence and response history. This cannot be undone.'
            : 'The selected report(s) will be returned to the active records queue.'
        }
        confirmLabel={confirming?.kind === 'purge' ? 'Permanently delete' : 'Restore'}
        onConfirm={runConfirmed}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
