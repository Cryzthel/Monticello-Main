import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Archive, FilePlus2, Send, CheckCircle2 } from 'lucide-react'
import Card from '@shared/components/Card'
import { categoryLabel } from '@shared/lib/incidentCategories'
import { isOfficerFiled } from '@shared/lib/staffFiling'
import { SkeletonFeed } from '@shared/components/Skeleton'

const EVENT_META = {
  created: { icon: FilePlus2, label: 'New report', color: 'text-info' },
  filed: { icon: FilePlus2, label: 'Report filed', color: 'text-info' },
  dispatched: { icon: Send, label: 'Dispatched', color: 'text-brand-400' },
  resolved: { icon: CheckCircle2, label: 'Resolved', color: 'text-success' },
}

// Derived, not a dedicated activity_log collection — every incident already
// carries reportedAt/dispatchedAt/resolvedAt, so a real-time feed falls out
// of the same live `incidents` query every other admin panel already reads.
function buildEvents(incidents) {
  const events = []
  incidents.forEach((incident) => {
    if (incident.reportedAt) events.push({ type: 'created', at: incident.reportedAt, incident })
    if (incident.dispatchedAt) events.push({ type: 'dispatched', at: incident.dispatchedAt, incident })
    if (incident.resolvedAt) events.push({ type: 'resolved', at: incident.resolvedAt, incident })
  })
  return events
}

/**
 * Formal filings only — one entry per report an OFFICER logged from a portal.
 *
 * ── WHAT THIS DELIBERATELY DROPS ───────────────────────────────────────────
 * Two whole classes of event:
 *
 *   1. Status churn. `dispatched` and `resolved` are operational transitions,
 *      and every ticket produces both. On a busy day they outnumber actual
 *      filings three to one and push them off the top of the panel, so the log
 *      an admin scans for "what happened" is mostly a machine narrating itself.
 *   2. Resident-filed reports. An admin's activity log is a record of what the
 *      security team DID, and the ticket queue beside it already lists every
 *      report regardless of origin.
 *
 * Officer authorship is a JOIN, not a field: an incident is officer-filed when
 * its `reporterUid` is a staff account (see useStaffAccounts). Without the id
 * set this cannot tell the two apart, so it yields nothing rather than
 * guessing — an empty feed is honest, a feed silently showing resident reports
 * as officer filings is not.
 */
function buildFilings(incidents, staffIds) {
  if (!staffIds) return []
  return incidents
    .filter((incident) => incident.reportedAt && isOfficerFiled(incident, staffIds))
    .map((incident) => ({ type: 'filed', at: incident.reportedAt, incident }))
}

/**
 * @param {object} props
 * @param {'operations'|'filings'} [props.variant] `operations` (default) is the
 *   full event stream — filings plus every dispatch and resolve — which is what
 *   a surface for WORKING tickets wants. `filings` is the administrative log:
 *   officer filings only. See buildFilings.
 * @param {Set<string>} [props.staffIds] Required by `filings`, ignored by
 *   `operations`.
 * @param {string} [props.className] Grid placement from the caller. Layout is
 *   the page's business, not the panel's — same contract as KpiCard.
 */
export default function ActionFeed({
  incidents = [],
  limit = 20,
  className = '',
  variant = 'operations',
  staffIds,
  /**
   * How far back the feed reaches, in hours. Null keeps everything.
   *
   * ── WHY THE FEED EXPIRES ─────────────────────────────────────────────
   * This panel answers "what is happening on my shift", and an event from
   * three days ago is not an answer to that — it is a record, and records
   * live in Incident History and the admin's archive. Left unbounded the
   * feed became a slowly scrolling museum: the top of it was still live,
   * but the guard had to know where the live part stopped.
   *
   * 24 hours is chosen to be longer than any single shift, so nothing that
   * happened while you were on falls off before you clock out.
   */
  windowHours = 24,
  /** Where the "Archive" control leads. Omitted renders no button. */
  archiveHref = null,
  /**
   * Whether the incident feed is still opening.
   *
   * The empty states below are specific sentences — "No reports filed by
   * security yet.", "Nothing in the last 24 hours." — and both were reachable
   * during the initial snapshot. On the admin overview that put a claim about
   * the security team's paperwork on screen before any of it had loaded.
   */
  loading = false,
}) {
  const filings = variant === 'filings'

  const events = useMemo(() => {
    const built = filings ? buildFilings(incidents, staffIds) : buildEvents(incidents)
    const cutoff =
      windowHours == null ? null : Date.now() - windowHours * 60 * 60 * 1000
    return built
      .filter((event) => {
        if (cutoff == null) return true
        const at = new Date(event.at).getTime()
        // An unparseable timestamp is kept rather than dropped: losing an
        // event because its date is malformed is worse than showing it late.
        return Number.isNaN(at) || at >= cutoff
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limit)
  }, [incidents, limit, filings, staffIds, windowHours])

  return (
    <Card className={`flex h-full min-h-0 flex-col p-4 ${className}`}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2 px-1">
        <p className="text-sm font-semibold text-text-primary">
          {filings ? 'Filed reports' : 'Activity feed'}
        </p>
        {archiveHref ? (
          <Link to={archiveHref} className="btn btn-sm btn-outline">
            <Archive className="h-3.5 w-3.5" />
            Archive
          </Link>
        ) : null}
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 pb-6">
        {loading ? (
          /* `divided={false}` — this feed spaces its rows with `space-y-3`
             rather than ruling them, so a skeleton drawing dividers would
             promise a different list shape than the one that arrives. */
          <SkeletonFeed rows={6} divided={false} className="gap-1" />
        ) : events.length === 0 ? (
          // Says WHAT is empty, not just that something is. "No activity yet"
          // over a filtered feed reads as a broken panel to anyone who can see
          // tickets moving on the same screen.
          <p className="px-2 py-8 text-center text-sm text-text-secondary">
            {filings
              ? 'No reports filed by security yet.'
              : windowHours == null
                ? 'No activity yet.'
                : `Nothing in the last ${windowHours} hours. Older activity is in the archive.`}
          </p>
        ) : (
          events.map((event, index) => {
            const meta = EVENT_META[event.type]
            const Icon = meta.icon
            return (
              <div key={`${event.incident.id}-${event.type}-${index}`} className="flex gap-3 px-1">
                <div className={`icon-tile mt-0.5 h-7 w-7 rounded-lg ${meta.color}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-text-primary">
                    <span className={`font-medium ${meta.color}`}>{meta.label}</span>{' '}
                    <span className="text-text-secondary">
                      {filings && event.incident.reportedByName
                        ? `· ${event.incident.reportedByName} `
                        : ''}
                      · {categoryLabel(event.incident.category)} ·{' '}
                      {event.incident.location ?? 'Unknown location'}
                    </span>
                  </p>
                  <p className="text-caption text-text-muted">{new Date(event.at).toLocaleString()}</p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
