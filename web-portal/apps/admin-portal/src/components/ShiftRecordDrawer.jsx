import { useEffect, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  LogOut,
  Mail,
  Send,
  User,
  X,
} from '@shared/icons'
import PriorityBadge from '@shared/components/PriorityBadge'
import StatusBadge from '@shared/components/StatusBadge'
import IncidentTicketDetailsModal from '@/components/IncidentTicketDetailsModal'
import { formatMinutes } from '@shared/lib/incidents'
import { shiftActivity } from '@shared/lib/shifts'
import { categoryLabel } from '@shared/lib/incidentCategories'
import { formatTime } from '@shared/lib/dates'
import Pill from '@shared/components/Pill'

function Stat({ icon: Icon, label, value, tone = 'text-text-primary' }) {
  return (
    <div className="rounded-xl border border-hairline bg-base-800 p-3">
      <p className="flex items-center gap-1.5 text-2xs font-semibold text-text-muted">
        <Icon size="sm" />
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold ${tone}`}>{value}</p>
    </div>
  )
}

function Section({ icon: Icon, title, count, children }) {
  return (
    <section>
      <p className="mb-2 flex items-center gap-2 text-2xs font-semibold text-text-muted">
        <Icon size="sm" className="text-brand-400" />
        {title}
        <span className="count-pill text-text-secondary">{count}</span>
      </p>
      {children}
    </section>
  )
}

/**
 * One incident in a shift list.
 *
 * A `<button>`, not a div with an onClick. These rows are keyboard-reachable
 * and announce themselves as controls, which matters more here than usual: this
 * panel is an audit surface, and the deep-dive modal is the only route to the
 * evidence and the timestamp log behind each line.
 *
 * The chevron is the affordance. Without it a row that highlights on hover
 * still gives no static signal that it opens anything — an admin reading the
 * list with a trackpad parked elsewhere sees a table.
 */
function IncidentRow({ incident, at, onOpen }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(incident)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-hairline bg-base-800 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-tint/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <PriorityBadge severity={incident.severity}>
          {categoryLabel(incident.category)}
        </PriorityBadge>
        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {incident.location ?? 'Location not provided'}
        </span>
        <StatusBadge status={incident.status ?? 'Pending'} size="sm" />
        <span className="shrink-0 font-mono text-2xs text-text-muted">
          {formatTime(at)}
        </span>
        <ChevronRight size="sm" className="shrink-0 text-text-muted" />
      </button>
    </li>
  )
}

function Empty({ children }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-text-secondary">
      {children}
    </p>
  )
}

/**
 * Everything one guard did during one shift.
 *
 * The activity is DERIVED from the incident documents (see shiftActivity), not
 * read from a separate log: each incident already stamps who dispatched it and
 * who resolved it, so the shift window plus those stamps is the authoritative
 * record. Nothing here can disagree with the tickets.
 *
 * ── LIVE, AND NOW ACTUALLY LIVE FOR RESOLUTIONS ────────────────────────────
 * `incidents` arrives from OnDutyHistoryTable's `onSnapshot` subscription, so
 * this panel has always re-rendered the moment a ticket changed. What was
 * missing was not the transport but the attribution: a resolution was credited
 * to the guard ASSIGNED at dispatch rather than the one who closed it, so a
 * report closed by a different guard was filtered out of every shift record and
 * looked exactly like a feed that had not updated. See shiftActivity.
 *
 * ── "REPORTS ANNOTATED" IS GONE ────────────────────────────────────────────
 * Removed per spec, and the `handled` count no longer counts annotations
 * either — a number an admin cannot reconcile against a list on screen is
 * worse than one less number. Every figure in this panel is now backed by the
 * section beneath it.
 *
 * ── ROWS OPEN THE SHARED TICKET MODAL ──────────────────────────────────────
 * The same `IncidentDetailModal` the Incident Tickets queue and the guard
 * triage queue open, not a variant of it. A bespoke read-only modal lived
 * here briefly; it drifted from the ticket layout the moment either changed,
 * which is the failure mode a shared component exists to prevent.
 *
 * It carries live status controls, so an admin reviewing a shift can act on a
 * ticket without leaving the record. That is a deliberate choice rather than
 * an oversight of one: a shift record is often read WHILE the shift is
 * running, and sending an admin to another page to advance a ticket they are
 * already looking at is the friction, not the safeguard.
 */
export default function ShiftRecordDrawer({ shift, incidents = [], nextShiftStart, onClose }) {
  const [openId, setOpenId] = useState(null)

  // Cleared when the drawer is pointed at a different shift, so switching
  // guards never leaves the previous shift's incident open over the new one.
  useEffect(() => {
    setOpenId(null)
  }, [shift?.id])

  if (!shift) return null

  const { dispatches, resolutions, handled, offShift } = shiftActivity(shift, incidents, {
    nextShiftStart,
  })

  // Resolved from the live array by id rather than held as an object, so an
  // incident edited while an admin is reading it updates in place instead of
  // freezing at whatever it was when the row was clicked.
  const openIncident = openId ? incidents.find((i) => i.id === openId) ?? null : null

  return (
    // The audit modal is a SIBLING of the drawer, not a child of it.
    // Nested, every click inside the modal — including its own backdrop —
    // would bubble into the drawer's `onClick={onClose}` and dismiss the
    // whole shift record behind it. stopPropagation on the modal panel
    // would cover the panel but not its backdrop, which is exactly the
    // click an admin uses to dismiss one incident and carry on reading.
    <>
      <div className="dialog-scrim fixed inset-0 z-50 flex justify-end bg-scrim" onClick={onClose}>
        <div
          className="card flex h-full w-full max-w-lg animate-[drawerInRight_260ms_var(--ease-out-strong)] flex-col overflow-hidden rounded-none border-y-0 border-r-0 bg-base-900 shadow-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-text-primary">{shift.name}</h2>
                {shift.open ? (
                  <Pill tone="success" pulse>
                    On duty
                  </Pill>
                ) : (
                  <Pill>Shift ended</Pill>
                )}
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-text-secondary">
                <Mail size="sm" className="shrink-0" />
                {shift.email || 'No email on file'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-icon-sm shrink-0 text-text-secondary hover:text-text-primary"
            >
              <X size="md" />
            </button>
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                icon={Clock}
                label="Time in"
                value={formatTime(shift.timeIn)}
              />
              <Stat
                icon={Clock}
                label="Time out"
                value={formatTime(shift.timeOut, 'Open')}
                tone={shift.open ? 'text-success' : 'text-text-primary'}
              />
              <Stat
                icon={Activity}
                label="On duty"
                value={
                  shift.durationMinutes != null ? formatMinutes(shift.durationMinutes) : '—'
                }
                tone="text-brand-400"
              />
              <Stat icon={User} label="Handled" value={handled.length} />
            </div>

            {/*
              The officer's own words come FIRST, above the derived activity.

              Everything below this is reconstructed from the incident
              documents and would be there whether or not anyone wrote a log.
              This is the part that only exists because someone typed it, and
              it is usually the reason an administrator opened the shift at
              all — "what do I need to know" outranks "what was logged".
            */}
            {shift.handover ? (
              <Section icon={ClipboardList} title="Duty log" count={shift.handover.outstanding ? 2 : 1}>
                <div className="rounded-lg border border-hairline bg-base-800 p-3">
                  <p className="whitespace-pre-line text-xs leading-relaxed text-text-primary">
                    {shift.handover.summary}
                  </p>
                  {shift.handover.outstanding ? (
                    <div className="mt-3 border-t border-divider pt-3">
                      <p className="text-2xs font-semibold text-text-muted">For the next officer</p>
                      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-text-primary">
                        {shift.handover.outstanding}
                      </p>
                    </div>
                  ) : null}
                </div>
              </Section>
            ) : shift.open ? null : (
              // A closed shift with no log is a fact worth stating: it means
              // either the requirement was off, or this shift predates it.
              <Section icon={ClipboardList} title="Duty log" count={0}>
                <Empty>No duty log was filed for this shift.</Empty>
              </Section>
            )}

            <Section icon={Send} title="Dispatches performed" count={dispatches.length}>
              {dispatches.length === 0 ? (
                <Empty>No dispatches during this shift.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {dispatches.map((incident) => (
                    <IncidentRow
                      key={incident.id}
                      incident={incident}
                      at={incident.dispatchedAt}
                      onOpen={() => setOpenId(incident.id)}
                    />
                  ))}
                </ul>
              )}
            </Section>

            <Section icon={CheckCircle2} title="Incidents resolved" count={resolutions.length}>
              {resolutions.length === 0 ? (
                <Empty>No incidents were closed out during this shift.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {resolutions.map((incident) => (
                    <IncidentRow
                      key={incident.id}
                      incident={incident}
                      at={incident.resolvedAt}
                      onOpen={() => setOpenId(incident.id)}
                    />
                  ))}
                </ul>
              )}
            </Section>

            {/* Only rendered when it has something to say, so an ordinary shift is
                unchanged. A guard who closed a ticket after clocking out produced a
                real event that used to belong to no shift at all — this is where it
                surfaces, labelled for what it is rather than folded into the
                timesheet above. */}
            {offShift.length > 0 ? (
              <Section icon={LogOut} title="After clock-out" count={offShift.length}>
                <p className="mb-2 text-caption leading-relaxed text-text-muted">
                  Worked by this guard between clocking out
                  {shift.timeOut ? ` at ${formatTime(shift.timeOut)}` : ''} and
                  {nextShiftStart
                    ? ` clocking back in at ${formatTime(nextShiftStart)}`
                    : ' now'}
                  . Counted in neither the totals above nor another shift.
                </p>
                <ul className="space-y-1.5">
                  {offShift.map(({ incident, at }) => (
                    <IncidentRow
                      key={incident.id}
                      incident={incident}
                      at={at}
                      onOpen={() => setOpenId(incident.id)}
                    />
                  ))}
                </ul>
              </Section>
            ) : null}

            <p className="text-caption leading-relaxed text-text-muted">
              Activity is derived from the incident records themselves — each ticket stamps who
              dispatched and who resolved it — so this view can never disagree with the Incident
              Tickets queue. Select any row for the full audit record.
            </p>
          </div>
        </div>
      </div>

      {/* Sibling, not child — see the fragment note above. Rendered after
          the drawer so it stacks over it at the same z-index. */}
      <IncidentTicketDetailsModal report={openIncident} onClose={() => setOpenId(null)} />
    </>
  )
}
