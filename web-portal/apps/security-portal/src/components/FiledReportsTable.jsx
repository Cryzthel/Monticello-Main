import { useEffect, useMemo, useState } from 'react'
import {
  Eye, FileText, Loader2, MapPin, RotateCcw, Search, ShieldAlert, Trash2, X,
} from 'lucide-react'
import Card from '@shared/components/Card'
import TablePagination from '@shared/components/TablePagination'
import StatusBadge from '@shared/components/StatusBadge'
import SegmentedControl from '@shared/components/SegmentedControl'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { categoryTone } from '@shared/theme/badgeStyles'
import { softDeleteIncidents, restoreIncidents, isDeleted } from '@shared/lib/incidents'
import { describeFirestoreError } from '@shared/lib/audit'
import { formatCategory } from '@shared/lib/wpda'
import { Skeleton } from '@shared/components/Skeleton'

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
]

// Fixed-width form so the column aligns on its separators without a hack —
// same treatment the incident queue's Reported column uses.
const LOG_TIME = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
const formatFiledAt = (value) =>
  value ? new Date(value).toLocaleString('en-GB', LOG_TIME).replace(',', '') : '—'

/**
 * Officer identifier.
 *
 * `staff_accounts` carries no badge number — the admin Reports table makes the
 * same point and falls back to the role. The uid IS the officer's identifier of
 * record in this system: it is what `reporterUid` is matched on and what
 * firestore.rules gates against. A short form of it is therefore the honest
 * thing to label "Officer ID", rather than minting a badge scheme no other
 * surface (or the Flutter app) would recognise.
 */
const officerId = (uid) => (uid ? String(uid).slice(0, 8).toUpperCase() : '—')

/**
 * The report directory — every report this officer has filed, with the same
 * lifecycle the Admin portal has.
 *
 * This is the File a Report page now, not a column beside a form. The composer
 * moved into a dialog behind one action button (see FileReportModal), which
 * hands this table the full container width: Location and Status, the two
 * columns that truncated in the old 27rem-less-than-half rail, finally render
 * whole. Nothing about its behaviour changed with the move — the same rows,
 * the same selection model, the same soft-delete.
 *
 * DELETE IS SOFT, ALWAYS. `softDeleteIncidents` stamps `deletedAt`; nothing
 * here calls `purgeIncidents`. That is not only a product choice — firestore
 * .rules permits `update` for any staff member but restricts `delete` to
 * `isAdminStaff()`, so a guard could not destroy a record even if this table
 * offered it. An incident report is the primary evidence that something
 * happened on the property; the guard who filed it can retract it, and only an
 * admin can erase it.
 *
 * Restore is the same write in reverse, which is why guards get it here —
 * a mis-tapped delete on a live call has to be recoverable by the person who
 * made it, not by raising a ticket with an admin.
 *
 * TWO PRESENTATIONS OF ONE LIST
 * -----------------------------
 * Below `md` the rows render as stacked cards and from `md` up as the table,
 * following the pattern the Admin Reports page already sets. Five columns do
 * not survive a 375px viewport, and this is the surface a guard actually reads
 * on a phone — it is the confirmation that the report they just filed from the
 * guardhouse landed. Both presentations render the same `rows` array and share
 * one selection Set, so a card ticked on a phone is the row the desktop bulk
 * bar acts on.
 *
 * Cards carry Location and Status, which the table has never shown. On desktop
 * those live one click away in the detail drawer; on a phone, where this list
 * IS the page, "where was it and what happened to it" is the whole question.
 */

/** One filed report as a stacked card. Below `md` only. */
function FiledReportCard({ report, checked, onToggle, onOpen }) {
  return (
    <li className={`border-t border-divider transition ${checked ? 'bg-brand-50' : ''}`}>
      <div className="flex items-start gap-2 p-4">
        {/* The input stays 20px; the label around it is the 44px target, so the
            tap area is honest without drawing a giant checkbox. */}
        <label className="-m-1.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center p-1.5">
          <input
            type="checkbox"
            aria-label={`Select report by ${report.reportedByName ?? 'unknown'}`}
            checked={checked}
            onChange={onToggle}
            className="h-5 w-5 rounded border-tint/20 bg-tint/5 accent-brand-500"
          />
        </label>

        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate font-medium text-text-primary">
              {report.reportedByName || 'Unknown'}
            </p>
            <span className="shrink-0 font-mono text-2xs text-text-muted">
              {formatFiledAt(report.reportedAt)}
            </span>
          </div>

          <p className="mt-0.5 font-mono text-2xs text-text-muted">
            Officer {officerId(report.reporterUid)}
          </p>

          <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-text-secondary">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-400" />
            <span className="min-w-0 break-words">{report.location || 'Location not provided'}</span>
          </p>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <StatusBadge tone={categoryTone(report.category)}>
              {formatCategory(report.category)}
            </StatusBadge>
            <StatusBadge status={report.status ?? 'Pending'} />
          </div>
        </button>
      </div>

      {/* An explicit control, not just a tappable card: touch has no hover, so
          without one nothing on screen says the row opens. */}
      <div className="flex justify-end border-t border-divider px-4 py-2">
        <button type="button" onClick={onOpen} className="btn btn-sm btn-outline min-h-11 px-4">
          <Eye className="h-4 w-4" />
          View report
        </button>
      </div>
    </li>
  )
}

function EmptyState({ message }) {
  return (
    <div className="px-4 py-14 text-center">
      <FileText className="mx-auto mb-2 h-6 w-6 text-text-muted" />
      <p className="text-sm text-text-secondary">{message}</p>
    </div>
  )
}

export default function FiledReportsTable({ incidents = [], loading = false, loadError = null, onView }) {
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  // { kind: 'delete' | 'restore', rows: [...] } — restore is confirmed too,
  // not just delete: putting a record back into the active queue is a
  // visible change to what the whole dispatch team is looking at, and a
  // mis-aimed click on a dense table should not commit it silently.
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const buckets = useMemo(() => {
    const byNewest = (a, b) => (b.reportedAt?.getTime?.() ?? 0) - (a.reportedAt?.getTime?.() ?? 0)
    return {
      active: incidents.filter((i) => !isDeleted(i)).sort(byNewest),
      archived: incidents.filter(isDeleted).sort(byNewest),
    }
  }, [incidents])

  /**
   * Chips are derived from what this officer actually filed, not from the full
   * seven-category vocabulary. A personal log usually spans two or three kinds,
   * and rendering all seven wraps to three rows on a 375px screen — a hundred
   * vertical pixels of controls, most of which would return nothing, pushing
   * the list itself below the fold on the one screen where it is the content.
   */
  const categories = useMemo(() => {
    const present = new Set(buckets[tab].map((report) => report.category).filter(Boolean))
    return [...present].sort()
  }, [buckets, tab])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return buckets[tab]
      .filter((report) => category === 'all' || report.category === category)
      .filter((report) => {
        if (!term) return true
        return [
          report.reportedByName,
          report.location,
          report.status,
          formatCategory(report.category),
          officerId(report.reporterUid),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term)
      })
  }, [buckets, tab, category, search])

  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  useEffect(() => {
    setPage(1)
  }, [tab, category, search, rowsPerPage])

  // Both views below render the SAME slice: the card list on a phone and the
  // table from md up are two presentations of one page, not two lists.
  const pageRows = useMemo(() => {
    const start = (Math.min(page, totalPages) - 1) * rowsPerPage
    return rows.slice(start, start + rowsPerPage)
  }, [rows, page, totalPages, rowsPerPage])

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id))
  const selected = rows.filter((row) => selectedIds.has(row.id))
  const filtering = Boolean(search.trim()) || category !== 'all'

  const emptyMessage = loadError
    ? 'Could not load your filed reports.'
    : buckets[tab].length === 0
      ? tab === 'archived'
        ? 'Nothing archived.'
        : 'No reports filed yet.'
      : 'No reports match these filters.'

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function switchTab(key) {
    setTab(key)
    // Selection is per-view: carrying checked ids across the Active/Archived
    // boundary would arm "Restore" against records that are not archived.
    setSelectedIds(new Set())
    setCategory('all')
    setError('')
  }

  async function run(action, ids) {
    setBusy(true)
    setError('')
    try {
      await action(ids)
      setSelectedIds(new Set())
      setConfirming(null)
    } catch (err) {
      console.error('Filed-reports action failed', err)
      setConfirming(null)
      setError(describeFirestoreError(err, 'update those reports'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden p-0 lg:flex-1">
      {/* ── ONE TOOLBAR BAND ────────────────────────────────────────────────
          Search and the Active/Archived filters used to be two stacked bands,
          each with its own `p-4` and its own bottom border — a hangover from
          when this table was a 27rem column and the two could not fit on a
          line. Now that it is the whole page they share one row, on the same
          shape the Admin announcement feed uses: the search field takes the
          slack, the status filters sit at the far right.

          One band also means one padding box. The toolbar's `p-4`, the row
          cells' `px-4` and the card's `p-4` are now the same 16px gutter down
          the whole component, so the search field's left edge, the first
          column heading and the first cell of every row land on one line
          rather than three near-misses.

          44px controls below `sm:`, collapsing to the 36px desktop baseline
          from `sm:` up. The search field no longer disappears on an empty
          bucket: a toolbar that comes and goes is the opposite of a fixed
          grid, and the row it used to save is worth less than the page not
          reflowing under a guard who just archived their last report. */}
      <div className="flex flex-col gap-3 border-b border-hairline p-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="flex h-11 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 sm:h-9 sm:flex-1">
            <Search className="h-4 w-4 shrink-0 text-text-secondary" />
            {/* text-base below `sm:` — iOS zooms the viewport on focus for any
                field under 16px, and it never zooms back out afterwards. */}
            <input
              type="text"
              inputMode="search"
              autoComplete="off"
              className="h-full w-full bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted sm:text-sm"
              placeholder="Search name, location, or status"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="icon-btn h-8 w-8 shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {/* A tray, not the four loose pills the announcement feed uses.
              There are two of them and they are the two halves of one
              lifecycle — a segmented control is the honest shape for that. */}
          <SegmentedControl
            ariaLabel="Report lifecycle"
            className="w-full shrink-0 sm:w-auto"
            segmentClassName="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
            options={TABS.map((t) => ({ value: t.key, label: t.label, count: buckets[t.key].length }))}
            value={tab}
            onChange={switchTab}
          />
        </div>

        {/* Second row: the category chips, and the count of what they left.
            Only rendered when there is a choice to make — a lone "All" chip is
            a control with one option, and the count line is noise until
            something is actually filtering. */}
        {categories.length > 1 || filtering ? (
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            {categories.length > 1 ? (
              <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
                {/* Category chips keep their category's own hue when on — the
                    colour is how a guard scans the log by kind — so the
                    selected chip is the tinted badge treatment with a firmer
                    ring, not the generic brand fill `.chip-active` uses. */}
                <StatusBadge
                  as="button"
                  type="button"
                  aria-pressed={category === 'all'}
                  onClick={() => setCategory('all')}
                  tone={category === 'all' ? 'brand' : 'neutral'}
                  className={`min-h-11 sm:min-h-0 ${category === 'all' ? 'ring-2' : 'opacity-70 hover:opacity-100'}`}
                >
                  All
                </StatusBadge>
                {categories.map((key) => {
                  const active = category === key
                  return (
                    <StatusBadge
                      key={key}
                      as="button"
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCategory(active ? 'all' : key)}
                      tone={active ? categoryTone(key) : 'neutral'}
                      className={`min-h-11 sm:min-h-0 ${active ? 'ring-2' : 'opacity-70 hover:opacity-100'}`}
                    >
                      {formatCategory(key)}
                    </StatusBadge>
                  )
                })}
              </div>
            ) : (
              <span />
            )}

            {filtering ? (
              <p className="shrink-0 text-2xs text-text-muted">
                <span className="font-mono tabular-nums text-text-secondary">{rows.length}</span> of{' '}
                <span className="font-mono tabular-nums">{buckets[tab].length}</span> shown
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {loadError ? (
        <p className="flex items-start gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2.5 text-xs text-danger">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {describeFirestoreError(loadError, 'load your filed reports')}
          </span>
        </p>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2.5 text-xs text-danger">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-danger/15">
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      ) : null}

      {selected.length > 0 ? (
        /* Wraps to two rows on a phone — count and dismiss, then the command at
           full width. `sm:order-*` restores the desktop reading order. */
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-brand-50 px-4 py-2.5 sm:gap-3">
          <span className="text-xs font-medium text-text-primary">
            <span className="font-mono">{selected.length}</span> selected
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            aria-label="Clear selection"
            className="icon-btn ml-auto h-11 w-11 shrink-0 sm:order-2 sm:ml-0 sm:h-9 sm:w-9"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex w-full items-center gap-2 sm:order-1 sm:ml-auto sm:w-auto">
            {tab === 'active' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming({ kind: 'delete', rows: selected })}
                className="btn btn-sm btn-danger min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {`Delete ${selected.length}`}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming({ kind: 'restore', rows: selected })}
                className="btn btn-sm btn-success min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {`Restore ${selected.length}`}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* ══ CARDS — below md ══ */}
      <div className="md:hidden">
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`sk-card-${i}`} className="space-y-2 rounded-xl border border-hairline p-4">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-44" />
                <div className="flex gap-1.5 pt-1">
                  <Skeleton variant="circle" className="h-5 w-20" />
                  <Skeleton variant="circle" className="h-5 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState message={emptyMessage} />
        ) : (
          <>
            <label className="flex min-h-11 items-center gap-2.5 border-b border-hairline px-4 py-2">
              <input
                type="checkbox"
                aria-label="Select all reports"
                checked={allSelected}
                onChange={() => setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                className="h-5 w-5 rounded border-tint/20 bg-tint/5 accent-brand-500"
              />
              <span className="text-xs font-medium text-text-secondary">Select all {rows.length}</span>
            </label>
            <ul>
              {pageRows.map((report) => (
                <FiledReportCard
                  key={report.id}
                  report={report}
                  checked={selectedIds.has(report.id)}
                  onToggle={() => toggleRow(report.id)}
                  onOpen={() => onView?.(report)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ══ TABLE — md and up ══ */}
      <div className="custom-scrollbar hidden min-h-0 overflow-x-auto md:block lg:flex-1 lg:overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="table-head">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all reports"
                  checked={allSelected}
                  onChange={() => setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                />
              </th>
              <th className="px-4 py-3">Submitted by</th>
              <th className="w-[10rem] px-4 py-3">Date &amp; time</th>
              <th className="px-4 py-3">Location</th>
              <th className="w-[11rem] px-4 py-3">Category</th>
              <th className="w-[9.5rem] px-4 py-3">Status</th>
              <th className="w-[9rem] px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-divider">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <Skeleton className="h-3 w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-0">
                  <EmptyState message={emptyMessage} />
                </td>
              </tr>
            ) : (
              pageRows.map((report) => {
                const checked = selectedIds.has(report.id)
                return (
                  <tr
                    key={report.id}
                    onClick={() => toggleRow(report.id)}
                    className={`cursor-pointer border-t border-divider transition ${
                      checked ? 'bg-brand-50' : 'hover:bg-tint/[0.03]'
                    }`}
                  >
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select report by ${report.reportedByName ?? 'unknown'}`}
                        checked={checked}
                        onChange={() => toggleRow(report.id)}
                        className="h-3.5 w-3.5 rounded border-tint/20 bg-tint/5 accent-brand-500"
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-medium text-text-primary">
                        {report.reportedByName || 'Unknown'}
                      </p>
                      <p className="mt-0.5 font-mono text-2xs text-text-muted">
                        Officer {officerId(report.reporterUid)}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">
                      {formatFiledAt(report.reportedAt)}
                    </td>
                    <td className="px-4 py-3.5 text-text-secondary">
                      {report.location || 'Not provided'}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge tone={categoryTone(report.category)}>
                        {formatCategory(report.category)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={report.status ?? 'Pending'} />
                    </td>
                    <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onView?.(report)}
                        className="btn btn-sm btn-outline"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(confirming)}
        busy={busy}
        // `success` renders the emerald confirm button; `danger` the red one.
        // Cancel is the outlined secondary in both, and takes focus on open —
        // the safe option should be what a stray Enter lands on.
        tone={confirming?.kind === 'restore' ? 'success' : 'danger'}
        title={
          confirming?.kind === 'restore'
            ? 'Confirm report restoration'
            : confirming?.rows.length === 1
              ? 'Delete this report?'
              : `Delete ${confirming?.rows.length ?? 0} reports?`
        }
        message={
          confirming?.kind === 'restore'
            ? `Restore ${
                confirming.rows.length === 1 ? 'this report' : `these ${confirming.rows.length} reports`
              } back to active records? ${
                confirming.rows.length === 1 ? 'It' : 'They'
              } will reappear in the dispatch queue and be visible to the whole team again.`
            : 'They move to Archived, where you can restore them. Nothing is destroyed — only an admin can permanently remove a report.'
        }
        confirmLabel={confirming?.kind === 'restore' ? 'Restore report' : 'Delete'}
        onConfirm={() =>
          run(
            confirming.kind === 'restore' ? restoreIncidents : softDeleteIncidents,
            confirming.rows.map((r) => r.id),
          )
        }
        onCancel={() => setConfirming(null)}
      />

      <TablePagination
        page={page}
        rowsPerPage={rowsPerPage}
        totalItems={rows.length}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        itemLabel="filed report"
      />
    </Card>
  )
}
