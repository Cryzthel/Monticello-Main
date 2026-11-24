import { formatDate, formatTime } from '@shared/lib/dates'

/** Helpers behind the shared incident detail cards (components/detail/IncidentDetailCards). */

/** Human-quotable code, derived from the document id — the same one IncidentsTable prints. */
export const ticketCode = (id) => (id ? `MV-${String(id).slice(0, 8).toUpperCase()}` : '')

export const incidentAddress = (report) =>
  `Phase ${report.phase ?? '—'} • Block ${report.block ?? '—'} • Lot ${report.lot ?? '—'}`

const validDate = (value) => {
  if (!value) return null
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// The shared formatters, so timeline stamps follow the organisation's time
// zone (Settings › System) like every other date.
export const stampOf = (date) => `${formatDate(date)} • ${formatTime(date)}`

/** "+4 min", "+2 h 05 min", "+3 d" — the gap a stage took after the one before it. */
export function elapsed(fromMs, toMs) {
  const minutes = Math.max(0, Math.round((toMs - fromMs) / 60000))
  if (minutes < 1) return '+<1 min'
  if (minutes < 60) return `+${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `+${hours} h ${String(minutes % 60).padStart(2, '0')} min`
  return `+${Math.floor(hours / 24)} d`
}

/**
 * Every stage the report has a timestamp for, oldest first.
 *
 * Built from the recorded fields, never from the status: a report closed
 * straight from Pending has no `dispatchedAt`, and drawing "Dispatched" for it
 * would state something that did not happen. Legacy stages appear only on the
 * reports that have them. `labels` renames a step per console (the Guardhouse
 * calls `dispatched` "Verified by Security").
 */
export function incidentStatusHistory(report, labels = {}) {
  const steps = [
    { key: 'reported', label: 'Reported', at: report.reportedAt, detail: report.reportedByName },
    {
      key: 'dispatched',
      label: 'Dispatched',
      at: report.dispatchedAt,
      detail: report.assignedGuardName ? `To ${report.assignedGuardName}` : report.dispatchedByName,
    },
    { key: 'acknowledged', label: 'Acknowledged', at: report.acknowledgedAt },
    { key: 'responding', label: 'Dispatch in progress', at: report.respondingAt },
    { key: 'onScene', label: 'On scene', at: report.onSceneAt },
    { key: 'investigating', label: 'Investigating', at: report.investigatingAt },
    { key: 'escalated', label: 'Escalated', at: report.escalatedAt, tone: 'warning' },
    { key: 'swept', label: 'Flagged by scheduled sweep', at: report.slaBreach?.at, detail: 'SLA breach recorded', tone: 'warning' },
    { key: 'resolved', label: 'Resolved', at: report.resolvedAt, detail: report.resolvedByName },
  ]
  return steps
    .map((step) => ({ ...step, label: labels[step.key] ?? step.label, date: validDate(step.at) }))
    .filter((step) => step.date)
    .sort((a, b) => a.date - b.date)
}

