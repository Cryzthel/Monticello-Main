import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  Hash,
  Info,
  MapPin,
  Save,
  Send,
  Timer,
  User,
} from '@shared/icons'
import { incidentDurations, formatMinutes, saveResponderNotes } from '@shared/lib/incidents'
import { computePriorityScore, formatCategory, categoryWeightOf } from '@shared/lib/wpda'

/**
 * The full forensic breakdown of one incident report.
 *
 * ── ONE BREAKDOWN, BOTH PORTALS ────────────────────────────────────────────
 * Lifted out of the guardhouse's IncidentHistoryCard so the admin's report
 * sheet renders the SAME four sections rather than a shorter paraphrase of
 * them. Before this, an admin opening a report from Audit History got four
 * ad-hoc panels — reporting officer, location, description, guard notes — with
 * no WPDA score, no evidence count, no timeline and no response duration. The
 * two consoles were looking at the same incident and seeing different amounts
 * of it, which is the wrong way round: the admin is the one auditing.
 *
 * Extracted rather than copied for the reason the shared LoginForm gives —
 * each portal having its own copy is how they drift apart in the first place.
 *
 * The caller supplies [mediaCount] instead of this recomputing it, because both
 * hosts have already built their media list for their own gallery and building
 * it twice would parse the same URLs again on every render.
 */

function Section({ icon: Icon, title, action, children }) {
  return (
    <section className="rounded-xl border border-hairline bg-base-800">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
        {/* 14px semibold in primary ink. The labels inside moved up to 14px
            (`.meta-label`), and a 12px section title would have read SMALLER
            than the labels it heads — the hierarchy upside down. */}
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-normal text-text-primary">
          <Icon size="sm" className="text-brand-400" />
          {title}
        </h3>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Field({ icon: Icon, label, value, mono = false, tone = 'text-text-primary' }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 meta-label">
        {Icon ? <Icon size="sm" /> : null}
        {label}
      </p>
      <p className={`mt-1 break-words text-sm font-medium ${mono ? 'font-mono' : ''} ${tone}`}>
        {value || <span className="text-text-muted">—</span>}
      </p>
    </div>
  )
}

// A single leg of the response timeline. The dot carries the state so the
// column reads as a progress track at a glance, without needing to parse the
// timestamps first.
function TimelineRow({ icon: Icon, label, at, duration, pendingLabel, isLast = false }) {
  const done = Boolean(at)
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${
            done ? 'bg-brand-100 text-brand-400 ring-brand-500/30' : 'bg-tint/5 text-text-muted ring-tint/10'
          }`}
        >
          <Icon size="sm" />
        </span>
        {/* Connector to the next leg — omitted on the last row so the track
            doesn't trail off into empty space. */}
        {isLast ? null : <span className="mt-1 w-px flex-1 bg-tint/[0.07]" />}
      </div>
      <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-4'}`}>
        <p className="meta-label">{label}</p>
        <p className={`mt-0.5 text-sm font-medium ${done ? 'text-text-primary' : 'text-text-muted'}`}>
          {done ? new Date(at).toLocaleString() : pendingLabel}
        </p>
        {done && duration != null ? (
          <p className="mt-0.5 text-xs text-brand-400">+{formatMinutes(duration)} elapsed</p>
        ) : null}
      </div>
    </li>
  )
}

function NotesEditor({ report, canEdit = true }) {
  const [notes, setNotes] = useState('')
  const [summary, setSummary] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Reset to whatever is on the newly selected report, discarding any
  // half-typed draft that belonged to the previous one.
  useEffect(() => {
    setNotes(report?.responderNotes ?? '')
    setSummary(report?.resolutionSummary ?? '')
    setEditing(false)
    setError('')
  }, [report?.id, report?.responderNotes, report?.resolutionSummary])

  const hasContent = Boolean(report?.responderNotes || report?.resolutionSummary)

  async function save() {
    setBusy(true)
    setError('')
    try {
      await saveResponderNotes(report.id, { responderNotes: notes, resolutionSummary: summary })
      setEditing(false)
    } catch (err) {
      setError(err.message ?? 'Could not save these notes.')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        {hasContent ? (
          <>
            <div>
              <p className="meta-label">Responder notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
                {report.responderNotes || <span className="text-text-muted">None recorded</span>}
              </p>
            </div>
            <div>
              <p className="meta-label">
                Final resolution summary
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
                {report.resolutionSummary || <span className="text-text-muted">None recorded</span>}
              </p>
            </div>
            {report.notesUpdatedByName ? (
              <p className="text-xs text-text-secondary">
                Logged by {report.notesUpdatedByName}
                {report.notesUpdatedAt ? ` • ${new Date(report.notesUpdatedAt).toLocaleString()}` : ''}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-200 p-3">
            <Info size="sm" className="mt-0.5 shrink-0 text-text-muted" />
            <p className="text-xs text-text-secondary">
              No responder notes on this report yet. The mobile app never writes these — they are
              recorded here by whoever handled the call.
            </p>
          </div>
        )}
        {/* ── WHO MAY WRITE HERE ──────────────────────────────────────
            Only the portal that took the call. Responder notes are the field
            record of what an officer found and did, and an administrator
            revising them after the fact turns a first-hand account into an
            edited one with nothing on the document saying it was edited.
            The admin sheet passes canEdit={false} and gets the read view;
            the guardhouse keeps the control. */}
        {canEdit ? (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-sm btn-outline">
            <FileText size="sm" />
            {hasContent ? 'Edit notes' : 'Add notes'}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="responder-notes" className="mb-1.5 block meta-label">
          Responder notes
        </label>
        <textarea
          id="responder-notes"
          rows={3}
          className="field-textarea resize-none"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What was observed on arrival, who was spoken to, actions taken…"
        />
      </div>
      <div>
        <label htmlFor="resolution-summary" className="mb-1.5 block meta-label">
          Final resolution summary
        </label>
        <textarea
          id="resolution-summary"
          rows={2}
          className="field-textarea resize-none"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="How the incident was closed out."
        />
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={save} className="btn btn-sm btn-brand">
          <Save size="sm" />
          {busy ? 'Saving…' : 'Save to report'}
        </button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)} className="btn btn-sm btn-outline">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function IncidentBreakdown({ report, mediaCount = 0, canEditNotes = true }) {
  if (!report) return null

  // Prefer the authoritative score the onIncidentWrite Cloud Function stamped
  // on the doc; fall back to the client formula only for older docs written
  // before that trigger existed, so the number shown is never blank.
  const serverScore =
    typeof report.wpdaScore === 'number' && report.wpdaScore > 0 ? report.wpdaScore : null
  const wpdaScore = serverScore ?? computePriorityScore(report)
  const durations = incidentDurations(report)

  return (
    <div className="space-y-3">
      <Section icon={Gauge} title="Classification & priority">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Category" value={formatCategory(report.category)} />
          <Field label="Severity" value={report.severity} tone="text-text-primary capitalize" />
          <div className="min-w-0">
            <p className="meta-label">WPDA urgency</p>
            <p className="mt-1 font-mono text-sm font-semibold text-brand-400">{Math.round(wpdaScore)}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {serverScore ? 'Server-scored' : 'Client estimate'} • weight ×{categoryWeightOf(report.category)}
            </p>
          </div>
          <Field
            label="Evidence files"
            value={`${mediaCount} file${mediaCount === 1 ? '' : 's'}`}
          />
        </div>
        {report.description ? (
          <div className="mt-4 border-t border-hairline pt-3">
            <p className="meta-label">
              Reported description
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{report.description}</p>
          </div>
        ) : null}
      </Section>

      {/* "Resident data", not "Resident metadata". Metadata is what a system
          calls its own bookkeeping; this is the resident's name and address,
          and an admin reading an audit trail is looking for exactly that.

          Sentence case, like every other heading in these consoles. The four
          section titles here were the last Title Case holdouts, which put
          "Classification & Priority" next to the dispatch drawer's "Incident
          summary" on two screens a guard reads in the same minute. */}
      <Section icon={User} title="Resident data">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field icon={User} label="Full name" value={report.reportedByName} />
          <Field icon={Hash} label="Phase" value={report.phase} />
          <Field icon={Hash} label="Block" value={report.block} />
          <Field icon={Hash} label="Lot" value={report.lot} />
          <Field
            icon={Clock}
            label="Reported"
            value={report.reportedAt ? new Date(report.reportedAt).toLocaleString() : ''}
          />
          <Field
            icon={MapPin}
            label="Coordinates"
            mono
            value={
              typeof report.lat === 'number' && typeof report.lng === 'number'
                ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`
                : ''
            }
          />
        </div>
      </Section>

      {/* "Timeline". It was "Timeline Logs" — a log is the raw record and this
          is the readable track built from it, so the shorter name is also the
          accurate one. */}
      <Section icon={Timer} title="Timeline">
        <ol className="mb-1">
          <TimelineRow
            icon={FileText}
            label="Submitted"
            at={report.reportedAt}
            pendingLabel="No submission time"
          />
          <TimelineRow
            icon={Send}
            label="Dispatched"
            at={report.dispatchedAt}
            duration={durations.toDispatch}
            pendingLabel="Not yet dispatched"
          />
          <TimelineRow
            icon={CheckCircle2}
            label="Resolved"
            at={report.resolvedAt}
            duration={durations.onScene}
            pendingLabel="Not yet resolved"
            isLast
          />
        </ol>
        <div className="grid grid-cols-2 gap-4 border-t border-hairline pt-3">
          <Field
            label="Total response duration"
            value={durations.total != null ? formatMinutes(durations.total) : ''}
            tone={durations.total != null ? 'text-brand-400' : 'text-text-primary'}
          />
          <Field label="Responding officer" value={report.assignedGuardName} />
        </div>
      </Section>

      <Section icon={FileText} title="Responder notes & resolution">
        <NotesEditor report={report} canEdit={canEditNotes} />
      </Section>
    </div>
  )
}
