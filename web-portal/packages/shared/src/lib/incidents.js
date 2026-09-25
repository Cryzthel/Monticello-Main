// Bridges the real `incidents` Firestore schema (written by the mobile app —
// see lib/features/incidents/models/incident.dart toFirestore/fromFirestore:
// nested `location: {lat,lng}`, `priority` enum, snake_case `status` wire
// values) to the flat shape the web dashboard's components already expect
// (IncidentMap wants flat lat/lng + severity; IncidentsTable and
// IncidentHistoryTable want the Dispatched/On-Site/Resolved vocabulary).

import { doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '@shared/lib/firebase'
// Re-exported, not re-implemented. `computeCategoryBreakdown` is pure
// taxonomy logic and now lives beside the taxonomy itself, where it can be
// exercised without dragging the Firebase SDK in. Callers importing it from
// here keep working.
export { computeCategoryBreakdown } from '@shared/lib/incidentCategories'
import { normalizeCategory } from '@shared/lib/incidentCategories'
import { deriveDispatchStage } from '@shared/lib/dispatchStage'

// Mobile's IncidentStatus wire values -> the dashboard's display buckets.
//
// `verifying` now reads as its own stage, "Verified", rather than collapsing
// into Pending — it is the state the detail modal's first action sets, so it
// has to be nameable. `in_progress` reads as "On-Site": the button that sets
// it says On-Site, the badge it produces says On-Site, and the resident is
// told a unit is on site. See STATUS_STYLES for why that word beat the two
// this state was called before it.
//
// THE WIRE VALUES ARE UNTOUCHED by any of those renames. Firestore still holds
// `in_progress`, the Flutter app still writes and reads `in_progress`, and
// nothing about a display label reaches the database — which is the entire
// reason this table exists.
//
// 'closed'/'false_alarm' still both read as Resolved: neither is reachable from
// this dashboard, and both mean "no longer open" to an operator.
export const STATUS_TO_DISPLAY = {
  pending: 'Pending',
  verifying: 'Verified',
  dispatched: 'Dispatched',
  in_progress: 'On-Site',
  resolved: 'Resolved',
  closed: 'Resolved',
  false_alarm: 'Resolved',
}

const notifyIncidentUpdate = httpsCallable(functions, 'notifyIncidentUpdate')

/**
 * Push the reporting resident about a dispatch stage the console has ALREADY
 * written. Returns `{ delivered, reason }`, the callable's own answer.
 *
 * ── THE WRITE MOVED, THE PUSH STAYED ────────────────────────────────────────
 * This was `updateIncidentStatus`, which wrote a bare `status` and then called
 * the function. Status now only changes as part of a dispatch stage, which
 * firestore.rules checks as a whole transition with its audit entry (see
 * security-portal/src/lib/dispatchWorkflow.js). A bare status write is refused,
 * so only the notification half is left here.
 *
 * `status` is the DISPLAY status, which is all the deployed function reads.
 * `stage` is new. A function built from this repository uses it to say "Guard
 * Ana is en route" rather than "a unit has been dispatched". The one still
 * deployed ignores it and sends its existing sentence for `status`, which is
 * still true. So the two can ship in either order.
 *
 * `reason` is 'sent' | 'no-token' | 'disabled' | 'failed'. It is never thrown:
 * the stage has landed, and a resident with no registered device must not turn
 * a successful dispatch into an error on the guard's screen.
 */
export async function notifyResident(incidentId, { status, stage }) {
  try {
    const result = await notifyIncidentUpdate({ incidentId, status, stage })
    return {
      delivered: Boolean(result?.data?.delivered),
      reason: result?.data?.reason ?? 'sent',
    }
  } catch (err) {
    console.error('Failed to notify resident of status update', err)
    return { delivered: false, reason: 'failed' }
  }
}

// ── Soft delete ─────────────────────────────────────────────────────────────
// Deleting a ticket must never destroy the record. An incident report is the
// primary evidence that something happened on the property, so removal is a
// state change (`deletedAt` stamped) rather than a `deleteDoc`. Everything
// stays queryable, auditable, and restorable.
//
// The active/deleted split is applied CLIENT-side from `deletedAt` rather than
// by a Firestore `where` clause: existing documents have no `deletedAt` field
// at all, and Firestore's inequality filters skip documents missing the field
// entirely — so `where('deletedAt', '==', null)` would return nothing for the
// whole existing backlog.
export function isDeleted(incident) {
  return Boolean(incident?.deletedAt)
}

export async function softDeleteIncidents(ids) {
  const actor = {
    deletedBy: auth.currentUser?.uid ?? '',
    deletedByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
  }
  await Promise.all(
    ids.map((id) =>
      updateDoc(doc(db, 'incidents', id), {
        ...actor,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ),
  )
}

/**
 * Hard delete — the document is gone.
 *
 * The second tier of the pipeline, and the only operation in this file that
 * destroys data. Deliberately separate from `softDeleteIncidents` and reachable
 * only from the Audit History trash, so "delete" in the day-to-day ticket queue
 * can never reach it by accident.
 *
 * `firestore.rules` restricts this to `isAdminStaff()`, so a security officer
 * can soft-delete a ticket but cannot purge it.
 */
export async function purgeIncidents(ids) {
  await Promise.all(ids.map((id) => deleteDoc(doc(db, 'incidents', id))))
}

/**
 * ── Admin review lifecycle ──────────────────────────────────────────────────
 *
 * A THIRD axis, deliberately separate from the two that already exist.
 *
 *   dispatch status   pending → dispatched → on-scene → resolved   (operations)
 *   deletedAt         soft delete / restore                        (data hygiene)
 *   reviewedAt        an admin has read this officer's report      (oversight)
 *
 * They are genuinely independent: a report can be Resolved on the ground and
 * still unread by an admin, and marking it reviewed must not touch the
 * dispatch state a guard is acting on. Folding review into `status` would have
 * done exactly that.
 *
 * The review axis itself lives in lib/reviewState.js — pure, so it can be
 * exercised without this module's Firebase imports. Re-exported here because
 * every existing caller imports it from `incidents`.
 */
export { reviewState, REVIEW_TONES, REVIEW_PENDING, REVIEW_DONE } from '@shared/lib/reviewState'

export async function markReportsReviewed(ids) {
  const actor = {
    reviewedBy: auth.currentUser?.uid ?? '',
    reviewedByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
  }
  await Promise.all(
    ids.map((id) => updateDoc(doc(db, 'incidents', id), { ...actor, reviewedAt: serverTimestamp() })),
  )
}

/**
 * ── Archive ─────────────────────────────────────────────────────────────────
 *
 * Distinct from soft delete, and worth being explicit about because the two
 * look similar from the outside. Archive means "dealt with, off my list";
 * delete means "this should not be here". Both are reversible and neither
 * destroys anything, but they answer different questions, and an admin
 * clearing a reviewed backlog should not have to file it under "deleted".
 *
 * Archived reports leave the Reports working list and the incident queue but
 * stay fully readable — the record is evidence either way.
 */
/**
 * How long a resolved report stays on the working surfaces.
 *
 * Longer than any single shift, so a report resolved at the start of one is
 * still on screen when the officer who closed it clocks out.
 */
export const RESOLVED_VISIBLE_HOURS = 24

/**
 * Whether a resolved report has aged out of the live views.
 *
 * ── WHY THIS IS A PREDICATE AND NOT A QUERY FILTER ─────────────────────────
 * The cutoff is relative to NOW, and Firestore cannot express "resolvedAt older
 * than 24 hours from whenever you happen to be reading this" without rewriting
 * the query on a timer. Evaluated client-side the rule is exact at every render
 * and costs one comparison per row.
 *
 * ── AND WHY IT ONLY APPLIES TO RESOLVED REPORTS ────────────────────────────
 * An old report that is still open is the opposite of noise — it is the thing
 * most in need of attention, and hiding it after a day would quietly drop the
 * worst cases off the queue. Only a CLOSED report has nothing left to do.
 *
 * A resolved report with no `resolvedAt` never expires. That is a data gap, not
 * a reason to hide a record.
 */
export function isResolvedExpired(incident, hours = RESOLVED_VISIBLE_HOURS) {
  if (incident?.status !== 'Resolved') return false
  const at = incident?.resolvedAt ? new Date(incident.resolvedAt).getTime() : NaN
  if (Number.isNaN(at)) return false
  return Date.now() - at > hours * 60 * 60 * 1000
}

/**
 * Whether an OPEN hazard pin has gone stale — older than the configured
 * lifetime and so due for re-verification.
 *
 * ── THIS IS NOT isResolvedExpired, AND THE DIFFERENCE MATTERS ───────────────
 * That predicate hides CLOSED reports, on the argument written above it: a
 * closed report has nothing left to do, so after a day it is only noise. The
 * same comment makes the opposite case just as firmly — an old report that is
 * still OPEN "is the thing most in need of attention, and hiding it after a
 * day would quietly drop the worst cases off the queue."
 *
 * Both are right, which is why this returns STALE rather than HIDDEN. A hazard
 * pin that has outlived its lifetime is not resolved and not noise; it is
 * unverified. On the resident map that is a reason to stop showing it, because
 * a puddle from Tuesday misinforms someone planning a route tonight. On an
 * operations console it is a reason to mark it, and the caller decides — the
 * hazard map says how many it is holding back and lets an administrator look.
 *
 * Measured from the report time, not the last update: re-verification is the
 * act that should reset this, and nothing yet records one. A report that is
 * edited is not thereby re-verified.
 *
 * A pin with no usable timestamp never goes stale. That is a data gap, not a
 * reason to drop a hazard.
 */
export function isHazardStale(incident, hours) {
  if (!incident || incident.status === 'Resolved') return false
  if (!Number.isFinite(hours) || hours <= 0) return false
  const at = incident.reportedAt ? new Date(incident.reportedAt).getTime() : NaN
  if (Number.isNaN(at)) return false
  return Date.now() - at > hours * 60 * 60 * 1000
}

export function isArchived(incident) {
  return Boolean(incident?.archivedAt)
}

export async function archiveIncidents(ids) {
  const actor = {
    archivedBy: auth.currentUser?.uid ?? '',
    archivedByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
  }
  await Promise.all(
    ids.map((id) =>
      updateDoc(doc(db, 'incidents', id), { ...actor, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    ),
  )
}

export async function unarchiveIncidents(ids) {
  await Promise.all(
    ids.map((id) =>
      updateDoc(doc(db, 'incidents', id), {
        archivedAt: null,
        archivedBy: '',
        archivedByName: '',
        updatedAt: serverTimestamp(),
      }),
    ),
  )
}

export async function restoreIncidents(ids) {
  await Promise.all(
    ids.map((id) =>
      updateDoc(doc(db, 'incidents', id), {
        // Cleared rather than set to a sentinel, so `isDeleted` stays a simple
        // truthiness check and a restored ticket is indistinguishable from one
        // that was never deleted.
        deletedAt: null,
        deletedBy: '',
        deletedByName: '',
        restoredBy: auth.currentUser?.uid ?? '',
        restoredByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
        restoredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ),
  )
}

// The guard History card's notes section writes here. Nothing else in either
// portal or the mobile app populates these fields, so without this handler
// that section could only ever render an empty placeholder. Firestore rules
// already allow isStaff() to update an incident (see firestore.rules
// /incidents), which is the same gate the status transitions above use.
export async function saveResponderNotes(incidentId, { responderNotes, resolutionSummary }) {
  await updateDoc(doc(db, 'incidents', incidentId), {
    responderNotes: (responderNotes ?? '').trim(),
    resolutionSummary: (resolutionSummary ?? '').trim(),
    // Attribution is part of the record, not a nicety — a resolution summary
    // with no author is not much use as an operational log.
    notesUpdatedBy: auth.currentUser?.uid ?? '',
    notesUpdatedByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Security',
    notesUpdatedAt: serverTimestamp(),
  })
}

// Timeline durations for the History card, in the same units formatMinutes
// renders. Returns null (not 0) when a leg hasn't happened yet, so the card
// can show "Not yet dispatched" instead of a misleading "0m 0s".
export function incidentDurations(report) {
  const span = (from, to) => (from && to ? (new Date(to) - new Date(from)) / 60000 : null)
  return {
    toDispatch: span(report?.reportedAt, report?.dispatchedAt),
    onScene: span(report?.dispatchedAt, report?.resolvedAt),
    total: span(report?.reportedAt, report?.resolvedAt),
  }
}

// Shared by SecurityPerformancePage (guard MTTR) and MetricsPanel (admin
// analytics) so the "mean time to respond" formula only lives in one place.
// Scales the unit to the magnitude — real MTTR values are usually minutes/
// seconds, but stale/demo data can produce durations spanning days, and
// "68428m 32s" is not a readable way to show that.
export function formatMinutes(totalMinutes) {
  if (totalMinutes < 1) return `${Math.round(totalMinutes * 60)}s`
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${Math.round(totalMinutes % 60)}m`
  const minutes = Math.floor(totalMinutes)
  const seconds = Math.round((totalMinutes - minutes) * 60)
  return `${minutes}m ${seconds}s`
}

/**
 * Mean report -> dispatch time in MINUTES, or null when nothing has been
 * dispatched in the set.
 *
 * Split out from the formatted version below because a period-over-period
 * delta cannot be computed from "4m 12s". Both callers now share one formula,
 * so the Overview card and the Metrics page cannot disagree about what the
 * average response time is — which is precisely what happened when each
 * derived its own.
 */
export function meanMinutesToRespond(reports) {
  const responded = reports.filter((r) => r.dispatchedAt && r.reportedAt)
  if (!responded.length) return null
  const totalMinutes = responded.reduce((sum, r) => sum + (r.dispatchedAt - r.reportedAt) / 60000, 0)
  return totalMinutes / responded.length
}

export function computeMeanTimeToRespond(reports) {
  const minutes = meanMinutesToRespond(reports)
  if (minutes == null) return 'No data yet'
  return formatMinutes(minutes)
}

// Distinct from MTTR (report -> dispatch): this is report -> resolution, the
// guard's "how long did the whole case take" efficiency metric.
export function computeMeanResolutionTime(reports) {
  const resolved = reports.filter((r) => r.resolvedAt && r.reportedAt)
  if (!resolved.length) return 'No data yet'
  const totalMinutes = resolved.reduce((sum, r) => sum + (r.resolvedAt - r.reportedAt) / 60000, 0)
  return formatMinutes(totalMinutes / resolved.length)
}

// Flattens a report's photoUrls/videoUrls arrays into one ordered list for
// the forensic viewers (guard History panel + Admin ticket modal) to page
// through — images first, then videos.
export function buildMediaItems(report) {
  const photos = (report?.photoUrls ?? []).map((url) => ({ url, type: 'image' }))
  const videos = (report?.videoUrls ?? []).map((url) => ({ url, type: 'video' }))
  return [...photos, ...videos]
}

// Used by both AdminDashboardPage's AnalyticsPanel (line trend) and
// AdminMetricsPage's MetricsPanel (bar chart) — `days` lets each pick its own
// window instead of hardcoding one.
export function computeDailyCounts(incidents, days) {
  const buckets = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date()
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - i)
    buckets.push({ date: day, count: 0 })
  }

  incidents.forEach((incident) => {
    if (!incident.reportedAt) return
    const reportedDay = new Date(incident.reportedAt)
    reportedDay.setHours(0, 0, 0, 0)
    const bucket = buckets.find((b) => b.date.getTime() === reportedDay.getTime())
    if (bucket) bucket.count += 1
  })

  return buckets
}

/**
 * The incidents that fall inside a timeframe — the ONE windowing rule.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The Admin Overview had two windowing implementations and one place with none,
 * which produced a visible discrepancy: moving the timeframe pill from 30d to
 * 7d updated the KPI cards and the volume chart but left the category donut
 * showing all-time counts — its own caption said "(all time)" while the card
 * beside it said 7 days. Two numbers on one screen describing different
 * periods, with nothing to tell the reader which.
 *
 * Every windowed figure now derives from a single call to this, made once in
 * the page and passed down, so a chart cannot silently disagree with the KPI
 * above it.
 *
 * [offsetDays] shifts the window backwards by whole periods, which is what the
 * "vs. previous period" deltas compare against: `offsetDays = days` gives the
 * period immediately before this one.
 *
 * Half-open at the start and inclusive at the end (`> start && <= end`) so two
 * adjacent windows never both claim the same incident.
 */
export function selectInRange(incidents, days, offsetDays = 0) {
  if (!Number.isFinite(days)) return [...incidents]
  const end = Date.now() - offsetDays * 86400000
  const start = end - days * 86400000
  return incidents.filter((incident) => {
    if (!incident.reportedAt) return false
    const ms = new Date(incident.reportedAt).getTime()
    return ms > start && ms <= end
  })
}


// "Data integrity validation rate" — the share of incidents that actually
// carry forensic evidence (photoUrls/videoUrls), i.e. were verifiable rather
// than a bare text report. Reuses buildMediaItems so this always agrees with
// what the verification modal itself considers "has evidence".
export function computeDataIntegrityRate(incidents) {
  if (!incidents.length) return 'No data yet'
  const verified = incidents.filter((incident) => buildMediaItems(incident).length > 0).length
  return `${Math.round((verified / incidents.length) * 100)}%`
}

// Category vs. average resolution time — an operational insight distinct
// from computeCategoryBreakdown's plain counts: which categories take
// longest to close, not just which are most frequent.
export function computeCategoryResolutionTimes(incidents) {
  const buckets = new Map()
  incidents.forEach((incident) => {
    if (!incident.resolvedAt || !incident.reportedAt) return
    // Same taxonomy as the Overview donut. Without it this chart keeps a
    // 'Hazard' row and a separate 'Security'/'security' pair, so the two
    // category views in the portal disagree about what the categories are.
    const key = normalizeCategory(incident.category)
    const minutes = (new Date(incident.resolvedAt).getTime() - new Date(incident.reportedAt).getTime()) / 60000
    const bucket = buckets.get(key) ?? { totalMinutes: 0, count: 0 }
    bucket.totalMinutes += minutes
    bucket.count += 1
    buckets.set(key, bucket)
  })
  return [...buckets.entries()]
    .map(([category, { totalMinutes, count }]) => ({ category, avgMinutes: totalMinutes / count, count }))
    .sort((a, b) => b.avgMinutes - a.avgMinutes)
}

// Spatial cluster indicator using the `phase` field already on every
// incident — a real, computable stand-in for "hot-spots across subdivision
// phases" that doesn't require polygon/geo-boundary data the app doesn't have.
export function computePhaseHotspots(incidents) {
  const counts = new Map()
  incidents.forEach((incident) => {
    const key = (incident.phase || '').toString().trim()
    if (!key) return
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return [...counts.entries()].map(([phase, count]) => ({ phase, count })).sort((a, b) => b.count - a.count)
}

/**
 * The human-readable address for a report.
 *
 * WHY THIS EXISTS. On the raw document `location` is the mobile app's GEO PAIR
 * — `{ lat, lng }` (see the header note, and incident.dart's toFirestore).
 * `propertyLabel` is the address string, and it is written by the WEB report
 * composer only. A report filed from the phone therefore has no propertyLabel
 * at all, and the previous `d.propertyLabel ?? d.location` fell straight
 * through to the coordinate object.
 *
 * Handing an object to a text slot is not a cosmetic problem: React throws
 * "Objects are not valid as a React child" and unmounts the whole subtree, so
 * opening one of these reports tore the detail sheet's contents out and left
 * the bare overlay behind. Every mobile-filed report hit it.
 *
 * The address is now DERIVED from phase/block/lot — which those documents do
 * carry — so a phone-filed report names its own location instead of falling
 * back to nothing. Coordinates are not a substitute: they are already surfaced
 * as flat `lat`/`lng` for the map, and "14.2011, 121.1553" is not what an
 * operator reading an incident log needs to see.
 */
export function describeIncidentLocation(d) {
  if (typeof d?.propertyLabel === 'string' && d.propertyLabel.trim()) {
    return d.propertyLabel.trim()
  }
  // Only when a writer actually stored a string there — never the geo pair.
  if (typeof d?.location === 'string' && d.location.trim()) return d.location.trim()

  const parts = [
    d?.phase && `Phase ${d.phase}`,
    d?.block && `Block ${d.block}`,
    d?.lot && `Lot ${d.lot}`,
  ].filter(Boolean)

  return parts.length ? parts.join(' • ') : ''
}

// `d` here is already the flattened { id, ...data() } object useLiveCollection
// hands back (see shared/hooks/useLiveCollection.js) — NOT a raw Firestore
// DocumentSnapshot, so this must not call d.data() itself.
export function mapIncidentDoc(d) {
  const reportedAt = d.reportedAt?.toDate ? d.reportedAt.toDate() : d.reportedAt
  const dispatchedAt = d.dispatchedAt?.toDate ? d.dispatchedAt.toDate() : d.dispatchedAt
  const resolvedAt = d.resolvedAt?.toDate ? d.resolvedAt.toDate() : d.resolvedAt
  // The two middle stages were left as raw Firestore Timestamps: nothing
  // rendered them, so `...d` passing them straight through was harmless.
  // The shift audit modal shows the full four-stage log, and a Timestamp
  // reaching a date formatter is a crash, not a blank.
  const acknowledgedAt = d.acknowledgedAt?.toDate ? d.acknowledgedAt.toDate() : d.acknowledgedAt
  const onSceneAt = d.onSceneAt?.toDate ? d.onSceneAt.toDate() : d.onSceneAt
  const notesUpdatedAt = d.notesUpdatedAt?.toDate ? d.notesUpdatedAt.toDate() : d.notesUpdatedAt
  const deletedAt = d.deletedAt?.toDate ? d.deletedAt.toDate() : d.deletedAt
  const reviewedAt = d.reviewedAt?.toDate ? d.reviewedAt.toDate() : d.reviewedAt
  const archivedAt = d.archivedAt?.toDate ? d.archivedAt.toDate() : d.archivedAt
  // The dispatch stages that have no older equivalent. Same treatment as the
  // two above, for the same reason: the drawer's timeline formats them.
  const respondingAt = d.respondingAt?.toDate ? d.respondingAt.toDate() : d.respondingAt
  const investigatingAt = d.investigatingAt?.toDate ? d.investigatingAt.toDate() : d.investigatingAt
  const escalatedAt = d.escalation?.at?.toDate ? d.escalation.at.toDate() : d.escalation?.at
  // The scheduled sweep's SLA flags. `...d` already carries the map through,
  // but its `at` arrives as a raw Timestamp, and a Timestamp reaching a date
  // formatter is a crash rather than a blank.
  //
  // NOTE the name: this document's `escalatedAt` above is the DISPATCH
  // escalation a guard files during an investigation. The sweep's escalation
  // is a different thing entirely and lives on `panic_alerts`, never here.
  const slaBreach = d.slaBreach
    ? {
        ack: Boolean(d.slaBreach.ack),
        resolve: Boolean(d.slaBreach.resolve),
        ackTargetMinutes: d.slaBreach.ackTargetMinutes,
        resolveTargetHours: d.slaBreach.resolveTargetHours,
        at: d.slaBreach.at?.toDate ? d.slaBreach.at.toDate() : d.slaBreach.at,
      }
    : undefined
  return {
    ...d,
    slaBreach,
    // Read from the RAW status, before it is replaced by its display label
    // below. deriveDispatchStage maps a report written before the field existed.
    dispatchStage: deriveDispatchStage(d),
    respondingAt,
    investigatingAt,
    escalatedAt,
    notesUpdatedAt,
    deletedAt,
    reviewedAt,
    archivedAt,
    lat: d.location?.lat,
    lng: d.location?.lng,
    severity: d.priority ?? 'medium',
    status: STATUS_TO_DISPLAY[d.status] ?? 'Pending',
    location: describeIncidentLocation(d) || undefined,
    reportedByName: d.reporterName,
    reportedAt,
    acknowledgedAt,
    onSceneAt,
    dispatchedAt,
    resolvedAt,
  }
}
