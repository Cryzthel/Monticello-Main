import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { jsPDF } from 'jspdf'
import { ClipboardList, FileText, ShieldCheck, X } from '@shared/icons'
import Pill from '@shared/components/Pill'
import SearchField from '@shared/components/SearchField'
import DataTable, { DataTableEmpty } from '@shared/components/DataTable'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { db } from '@shared/lib/firebase'
import { formatDateTime, formatTime } from '@shared/lib/dates'
import { toast } from '@shared/lib/toast'
import { postLabel } from '@/lib/securityAccounts'

/**
 * One guard's whole duty history — opened by "View shift record" on Security
 * accounts › Shift history (user's reference, 2026-10-18).
 *
 *   ┌ [GT●] guard.name (● On duty)                               (PDF report) [×] ┐
 *   │       (Badge #MV-0142) · Patrol officer · Perimeter patrol                 │
 *   ├────────────────────────────────────────────────────────────────────────────┤
 *   │ OFFICIAL SHIFT DUTY LOGS                                  [search…]        │
 *   │ Date & time │ Time in │ Time out │ Duration │ Status                       │
 *   ├────────────────────────────────────────────────────────────────────────────┤
 *   │ (shield) Monticello Villas security network        Showing 4 of 12 records │
 *   └────────────────────────────────────────────────────────────────────────────┘
 *
 * ── LIVE ───────────────────────────────────────────────────────────────────
 * `guard.shifts` comes from OnDutyHistoryTable's `guard_shifts` listener, so a
 * clock-in or clock-out lands in the open table as it happens. Badge, role and
 * post are not on the shift records; they come from this modal's own listener
 * on `staff_accounts/{guardUid}` (admins may read it).
 *
 * Clicking a shift opens ShiftRecordDrawer for what was dispatched and
 * resolved during it, as the drawer this replaces did.
 *
 * ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
 * No on-time rate: nothing rosters a guard to a shift, so there is no
 * scheduled start to measure a clock-in against (see the note this file
 * replaced, in git history as GuardShiftDrawer.jsx).
 */

/** Minutes as `7h 20m`. */
function hoursAndMinutes(total) {
  if (!total && total !== 0) return '—'
  if (total < 1) return '0m'
  const h = Math.floor(total / 60)
  const m = Math.round(total % 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

const initialsOf = (name) =>
  String(name || '?')
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?'

/** `staff_accounts/{uid}`, live while the modal is open. */
function useStaffRecord(uid) {
  const [record, setRecord] = useState(null)
  useEffect(() => {
    setRecord(null)
    if (!uid) return undefined
    return onSnapshot(
      doc(db, 'staff_accounts', uid),
      (snap) => setRecord(snap.exists() ? snap.data() : null),
      () => setRecord(null),
    )
  }, [uid])
  return record
}

export default function GuardShiftRecordModal({ guard, onClose, onOpenShift, suspended = false }) {
  const [search, setSearch] = useState('')
  const staff = useStaffRecord(guard?.guardUid)
  const panelRef = useRef(null)
  useDialogFocus({ open: Boolean(guard), containerRef: panelRef })

  useEffect(() => {
    setSearch('')
  }, [guard?.key])

  // Escape closes this modal — but not while a shift is open on top of it,
  // or one key press would close both and drop the admin back on the table.
  useEffect(() => {
    if (!guard || suspended) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [guard, suspended, onClose])

  const rows = useMemo(() => {
    if (!guard) return []
    const term = search.trim().toLowerCase()
    if (!term) return guard.shifts
    return guard.shifts.filter((s) =>
      [
        formatDateTime(s.timeIn),
        formatTime(s.timeIn),
        s.timeOut ? formatTime(s.timeOut) : 'on duty',
        s.shift,
        s.open ? 'active' : 'completed',
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [guard, search])

  if (!guard) return null

  const completed = guard.shifts.filter((s) => !s.open)
  const displayName = staff?.name || guard.name || guard.email || 'Officer'
  const badge = staff?.badgeNumber
  const role = staff?.role === 'security_head' ? 'Security supervisor' : 'Patrol officer'
  const post = postLabel(staff?.assignedPost)
  const fileBase = `duty-log-${(badge || displayName).replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase()}`

  const exportRows = () =>
    rows.map((s) => ({
      date: formatDateTime(s.timeIn),
      timeIn: formatTime(s.timeIn),
      timeOut: s.open ? 'On duty' : formatTime(s.timeOut),
      duration: s.open ? '' : hoursAndMinutes(s.durationMinutes),
      shift: s.shift || '',
      status: s.open ? 'Active' : 'Completed',
    }))

  function exportPdf() {
    try {
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
      const left = 48
      let y = 56
      pdf.setFont('helvetica', 'bold').setFontSize(16).text('Shift duty log', left, y)
      y += 20
      pdf.setFont('helvetica', 'normal').setFontSize(10)
      pdf.text(`${displayName}${badge ? ` · Badge #${badge}` : ''} · ${role}${post ? ` · ${post}` : ''}`, left, y)
      y += 14
      pdf.text(
        `Total ${hoursAndMinutes(guard.totalMinutes)} · ${completed.length} completed shift${completed.length === 1 ? '' : 's'} · Generated ${formatDateTime(new Date())}`,
        left,
        y,
      )
      y += 26
      const cols = [left, left + 170, left + 245, left + 320, left + 410]
      const head = ['Date & time', 'Time in', 'Time out', 'Duration', 'Status']
      pdf.setFont('helvetica', 'bold')
      head.forEach((h, i) => pdf.text(h, cols[i], y))
      y += 6
      pdf.setLineWidth(0.5).line(left, y, 547, y)
      y += 14
      pdf.setFont('helvetica', 'normal')
      exportRows().forEach((r) => {
        if (y > 790) {
          pdf.addPage()
          y = 56
        }
        ;[r.date, r.timeIn, r.timeOut, r.duration || '—', r.status].forEach((cell, i) => pdf.text(String(cell), cols[i], y))
        y += 16
      })
      if (!rows.length) pdf.text('No duty records match.', left, y)
      pdf.save(`${fileBase}.pdf`)
      toast.success('PDF report exported', { description: `${fileBase}.pdf` })
    } catch (err) {
      console.error('PDF export failed', err)
      toast.error('Could not build the PDF report')
    }
  }

  const ghostBtn =
    'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-tint/[0.05] px-4 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-tint/[0.1] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50'

  // Rendered in place, NOT portalled: ShiftRecordDrawer is its next sibling in
  // OnDutyHistoryTable and must paint above this modal when a shift is opened.
  return (
    <div
      className="dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="duty-log-title"
        onClick={(event) => event.stopPropagation()}
        className="dialog-panel flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-base-900 shadow-2xl shadow-black/70 sm:max-h-[92vh] sm:rounded-2xl"
      >
        {/* ── Officer profile header ── */}
        <header className="flex shrink-0 flex-col justify-between gap-4 border-b border-hairline bg-gradient-to-r from-base-900 to-base-950/60 px-6 py-5 md:flex-row md:items-center dark:to-base-950">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative shrink-0">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-brand-500/40 bg-brand-500/15 text-base font-bold text-brand-500 shadow-lg shadow-brand-500/10">
                {initialsOf(displayName)}
              </span>
              {guard.onDuty ? (
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-base-900 bg-success">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-base-950 motion-reduce:animate-none" />
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 id="duty-log-title" className="truncate text-base font-bold tracking-tight text-text-primary">
                  {displayName}
                </h2>
                {guard.onDuty ? (
                  <Pill tone="success" pulse>
                    On duty
                  </Pill>
                ) : (
                  <Pill>Off duty</Pill>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-secondary">
                {badge ? <Pill className="font-mono">Badge #{badge}</Pill> : null}
                <span className="inline-flex items-center gap-1 font-semibold text-text-primary">
                  <ShieldCheck size={14} className="text-brand-500" aria-hidden="true" />
                  {role}
                </span>
                {post ? (
                  <>
                    <span aria-hidden="true" className="text-text-muted">•</span>
                    <span className="font-mono">{post}</span>
                  </>
                ) : null}
              </div>
              {guard.email && staff?.name ? <p className="mt-1 truncate text-xs text-text-muted">{guard.email}</p> : null}
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto">
            <button type="button" onClick={exportPdf} disabled={!rows.length} className={ghostBtn}>
              <FileText size="sm" aria-hidden="true" />
              PDF report
            </button>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close duty log"
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary"
            >
              <X size="md" />
            </button>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          <section className="space-y-3">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold tracking-tight text-text-primary">
                  <ClipboardList size="sm" className="text-brand-500" aria-hidden="true" />
                  Official shift duty logs
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Every clock-in and clock-out, newest first. Select a shift to see what was dispatched during it.
                </p>
              </div>
              <SearchField
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onClear={() => setSearch('')}
                placeholder="Search date, time or status"
                aria-label="Search duty logs"
                className="w-full sm:w-64"
              />
            </div>

            <div className="overflow-hidden rounded-xl border border-hairline">
              <DataTable
                scroll="x"
                sticky={false}
                minWidth="36rem"
                columns={[
                  { header: 'Date & time' },
                  { header: 'Time in' },
                  { header: 'Time out' },
                  { header: 'Shift duration' },
                  { header: 'Status', align: 'right' },
                ]}
              >
                {guard.shifts.length === 0 ? (
                  <DataTableEmpty colSpan={5} icon={ClipboardList}>
                    No shifts recorded for this officer in the selected period.
                  </DataTableEmpty>
                ) : rows.length === 0 ? (
                  <DataTableEmpty colSpan={5} detail="Try a date like “Oct 16”, a time, or “active”.">
                    No duty records match that search.
                  </DataTableEmpty>
                ) : (
                  rows.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => onOpenShift?.(s.id)}
                      tabIndex={0}
                      aria-label={`Open shift from ${formatDateTime(s.timeIn)}`}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault()
                          onOpenShift?.(s.id)
                        }
                      }}
                      className={`data-row cursor-pointer border-t border-divider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 ${
                        s.open ? 'bg-success/[0.05]' : ''
                      }`}
                    >
                      <td className={`whitespace-nowrap px-4 py-3.5 ${s.open ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
                        {formatDateTime(s.timeIn)}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3.5 font-mono text-xs tabular-nums ${s.open ? 'text-success' : 'text-text-secondary'}`}>
                        {formatTime(s.timeIn)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs tabular-nums text-text-secondary">
                        {s.open ? (
                          <Pill tone="success" pulse>
                            On duty
                          </Pill>
                        ) : (
                          formatTime(s.timeOut)
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs tabular-nums text-text-muted">
                        {s.open ? '—' : hoursAndMinutes(s.durationMinutes)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-right">
                        {s.open ? <Pill tone="success">Active</Pill> : <Pill>Completed</Pill>}
                      </td>
                    </tr>
                  ))
                )}
              </DataTable>
            </div>
          </section>
        </div>

        {/* ── Footer ── */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-base-950/40 px-6 py-3.5 text-xs text-text-muted">
          <span className="flex items-center gap-2">
            <ShieldCheck size="sm" className="text-brand-500" aria-hidden="true" />
            Monticello Villas security network
          </span>
          <span className="tabular-nums">
            Showing {rows.length} of {guard.shifts.length} duty record{guard.shifts.length === 1 ? '' : 's'}
          </span>
        </footer>
      </div>
    </div>
  )
}
