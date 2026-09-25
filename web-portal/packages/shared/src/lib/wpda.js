// Weighted Priority Dispatching Algorithm
// Priority Score = (Category Weight x Urgency) + Time Waiting (minutes)
// Mirrors the scoring the Node.js middleware computes server-side; used here
// only to re-sort/display already-scored reports coming from Firestore.

// Keys mirror the category taxonomy actually written by the mobile app and
// scored server-side in functions/index.js's CATEGORY_SCORE — not an
// independent list, so a report's category weight here always matches how
// it was scored on write.
export const CATEGORY_WEIGHTS = {
  fire: 10,
  medical: 9,
  security: 7,
  hazard: 6,
  flooding: 5,
  maintenance: 2,
  noise: 2,
}

// Reports carry a `severity` (mapped from the mobile client's `priority`
// enum: low/medium/high/critical — see mapIncidentDoc), not a raw numeric
// urgency, so it's converted to one here.
export const URGENCY_WEIGHTS = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

// [now] is injectable so a caller computing a whole ROW of clock-relative
// metrics measures every one of them against the same instant, and so those
// metrics are testable without stubbing the global clock. Defaulted, so the
// dozen existing one-shot callers are unchanged.
export function minutesWaiting(reportedAt, now = Date.now()) {
  if (!reportedAt) return 0
  const reportedMs = reportedAt?.toMillis ? reportedAt.toMillis() : new Date(reportedAt).getTime()
  if (Number.isNaN(reportedMs)) return 0
  return Math.max(0, (now - reportedMs) / 60000)
}

// Firestore category values aren't guaranteed lowercase (older/seeded docs
// use Title Case) — normalize the same way functions/index.js's
// computeWpdaScore already does server-side, so a lookup here never silently
// falls through to the default weight just because of casing.
export function categoryWeightOf(category) {
  return CATEGORY_WEIGHTS[String(category ?? '').toLowerCase()] ?? 1
}

export function computePriorityScore({ category, severity, reportedAt }) {
  const categoryWeight = categoryWeightOf(category)
  const urgency = URGENCY_WEIGHTS[severity] ?? URGENCY_WEIGHTS.medium
  return categoryWeight * urgency + minutesWaiting(reportedAt)
}

export function sortByPriority(reports) {
  return [...reports].sort((a, b) => computePriorityScore(b) - computePriorityScore(a))
}

// Bucket an incident into the same hot/warm/cold/resolved response phases
// shown on the Admin Hazard Map's legend and now on the Guard Triage Queue —
// one definition so both portals agree on what "hot" means.
export const RESPONSE_PHASE_COLORS = {
  resolved: '#22C55E',
  hot: '#F2545C',
  warm: '#FB923C',
  cold: '#94A3B8',
}

export function responsePhase(incident) {
  if (incident.status === 'Resolved') return 'resolved'
  const ageHours = minutesWaiting(incident.reportedAt) / 60
  if (ageHours <= 2) return 'hot'
  if (ageHours <= 24) return 'warm'
  return 'cold'
}

// A second, independent color dimension for the map's radar pulse — WHAT
// kind of emergency this is, not how long it's been open (that's
// responsePhase's job). Critical/medical reads as the most urgent color
// regardless of category; everything else follows its category.
export const EMERGENCY_COLORS = {
  critical: '#F2545C', // red — medical / critical severity
  fire: '#FB923C', // orange — fire, hazard, flooding
  maintenance: '#FBBF24', // amber — maintenance
  security: '#38BDF8', // blue — security, noise, and anything uncategorized
}

export function emergencyWaveColor(incident) {
  const category = String(incident.category ?? '').toLowerCase()
  if (incident.severity === 'critical' || category === 'medical') return EMERGENCY_COLORS.critical
  if (category === 'fire' || category === 'hazard' || category === 'flooding') return EMERGENCY_COLORS.fire
  if (category === 'maintenance') return EMERGENCY_COLORS.maintenance
  return EMERGENCY_COLORS.security
}

// "suspicious_activity" -> "Suspicious Activity" for display; the raw
// snake_case keys above stay as the actual category identifiers.
export function formatCategory(category) {
  if (!category) return 'Uncategorized'
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
