/**
 * The console side of the two time-based settings: SOS escalation and the
 * incident SLA targets.
 *
 * ── WHY THE CLIENT COMPUTES THIS AT ALL ─────────────────────────────────────
 * `functions/operationsSweep.js` stamps `escalatedAt` on an unattended alert
 * and `slaBreach` on a late report, and it cannot deploy while the project is
 * on the Spark plan. A badge that renders only the server's stamp would be a
 * badge that never appears — so these helpers derive the same state from the
 * timestamps already on the document, exactly as `isHazardStale` does for the
 * hazard window while the sweep handles the archiving half.
 *
 * The two halves are not redundant. The client's answer is live and free but
 * exists only while someone has a console open, which is precisely the case an
 * unattended SOS is not. The server's answer is durable, arrives with nobody
 * watching, and is what an audit reads back later.
 *
 * ── THESE MUST AGREE WITH THE SWEEP ─────────────────────────────────────────
 * `escalationDue` and `slaBreachState` are deliberate mirrors of
 * `shouldEscalateAlert` and `slaBreach` in `functions/sweepRules.js`, down to
 * the argument order, so that `npm run test:agreement` in `functions/` can run
 * both over the same inputs and fail on any divergence. A console calling an
 * alert unanswered a minute before or after the server agrees is a system
 * arguing with itself about an emergency.
 *
 * So: no `Date.now()` inside anything here. `nowMs` is a parameter, which is
 * also what lets the callers drive it from one ticking clock (see `useNow`)
 * rather than each render reading its own slightly different present.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * Milliseconds from a Firestore Timestamp, a mapped JS Date, a number or an
 * ISO string — because these helpers run against both the mapped objects the
 * tables hold and the raw documents the sweep reads.
 *
 * NaN for anything unusable, and every caller treats NaN as "cannot age this
 * document" rather than as zero. A `serverTimestamp()` reads back null for the
 * moment between a write landing and the server resolving it, so an unusable
 * timestamp is a normal transient state, not an old one.
 */
export function asMillis(value) {
  if (value == null) return NaN
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? NaN : parsed
  }
  if (typeof value._seconds === 'number') return value._seconds * 1000
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return NaN
}

// ── SOS escalation ──────────────────────────────────────────────────────────

export const ESCALATION = Object.freeze({
  none: 'none',
  overdue: 'overdue',
  escalated: 'escalated',
})

/**
 * Would the sweep escalate this alert right now?
 *
 * Mirror of `sweepRules.shouldEscalateAlert`, including the one-shot guard: an
 * alert that already carries `escalatedAt` answers false, because the sweep
 * would not write it twice. `escalationState` is what callers want for display.
 */
export function escalationDue(alert, nowMs, minutes) {
  if (!alert) return false
  if (alert.escalatedAt) return false
  if (String(alert.status || '').trim().toLowerCase() !== 'active') return false
  const created = asMillis(alert.createdAt)
  if (!Number.isFinite(created)) return false
  return nowMs - created >= minutes * MINUTE
}

/**
 * What to show: nothing, the client's own reading, or the server's stamp.
 *
 * ── AN ACKNOWLEDGED ALERT IS NOT UNATTENDED ─────────────────────────────────
 * The stamp is never removed once written, and it should not be: it is the
 * record that an emergency went unanswered for six minutes, which is exactly
 * what an audit wants. But a row badged "Unattended" after an officer has
 * responded is a false statement about the present, and it would sit there for
 * the life of the alert.
 *
 * So `escalated` is reported only while the alert is still active. Once someone
 * acknowledges, this returns `none` and the history moves to the detail view,
 * where there is room to say when it happened and how long it took.
 */
export function escalationState(alert, nowMs, minutes) {
  const active = String(alert?.status || '').trim().toLowerCase() === 'active'
  if (!active) return ESCALATION.none
  if (alert?.escalatedAt) return ESCALATION.escalated
  return escalationDue(alert, nowMs, minutes) ? ESCALATION.overdue : ESCALATION.none
}

/** How long an alert has gone unanswered, in whole minutes, or null. */
export function unansweredMinutes(alert, nowMs) {
  const created = asMillis(alert?.createdAt)
  if (!Number.isFinite(created)) return null
  const elapsed = nowMs - created
  if (elapsed < 0) return null
  return Math.floor(elapsed / MINUTE)
}

/**
 * The operator-facing sentence, or null when there is nothing worth saying.
 *
 * ── A SENTENCE, NOT A BADGE ─────────────────────────────────────────────────
 * This returned `{ tone, label, detail }` while an "Unattended" pill existed on
 * the alert surfaces. The pill was removed by request, so the tone and the
 * label went with it rather than being left in the return shape: an unread
 * `label: 'Unattended'` still ships the word in the bundle and still tells the
 * next reader that a badge is rendered somewhere, which would no longer be
 * true.
 */
export function describeEscalation(state, { minutes, elapsedMinutes } = {}) {
  if (state === ESCALATION.none) return null

  const waited =
    typeof elapsedMinutes === 'number' && elapsedMinutes > 0
      ? `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'}`
      : 'longer than the configured window'

  if (state === ESCALATION.escalated) {
    return `Escalated by the system after ${minutes} minutes with no acknowledgement. Unanswered for ${waited}.`
  }

  // Said plainly, because the two readings differ in durability, not in
  // whether the emergency is real.
  return `No acknowledgement after ${minutes} minutes. Unanswered for ${waited}.`
}

/** The history line for a detail view — shown whatever the current status. */
export function describeEscalationHistory(alert, minutes) {
  if (!alert?.escalatedAt) return null
  const after = Number.isFinite(Number(alert.escalatedAfterMinutes))
    ? Number(alert.escalatedAfterMinutes)
    : minutes
  return `This alert was escalated by the system after ${after} minutes without an acknowledgement.`
}

// ── Incident SLA targets ────────────────────────────────────────────────────

/**
 * Has this report missed either target?
 *
 * Mirror of `sweepRules.slaBreach`. Elapsed time runs from `reportedAt` to the
 * moment the clock stopped — `dispatchedAt` for acknowledgement, `resolvedAt`
 * for resolution — or to now while it is still running, so a report that was
 * answered late keeps its breach after the fact rather than clearing it.
 */
export function slaBreachState(incident, nowMs, targets) {
  const none = { ack: false, resolve: false }
  if (!incident) return none

  const reported = asMillis(incident.reportedAt)
  if (!Number.isFinite(reported)) return none

  const dispatched = asMillis(incident.dispatchedAt)
  const resolved = asMillis(incident.resolvedAt)

  const ackElapsed = (Number.isFinite(dispatched) ? dispatched : nowMs) - reported
  const resolveElapsed = (Number.isFinite(resolved) ? resolved : nowMs) - reported

  return {
    ack: ackElapsed > targets.ackTargetMinutes * MINUTE,
    resolve: resolveElapsed > targets.resolveTargetHours * HOUR,
  }
}

/**
 * What a report missed, as a sentence, or null when it missed nothing.
 *
 * Returned `{ tone, label, detail }` while the "Overdue" pills existed. Those
 * were removed by request and the labels went with them — see
 * `describeEscalation` for why an unrendered label is not worth keeping.
 *
 * A report that missed BOTH targets still gets one sentence naming both,
 * rather than two: whoever is reading this opened the record, and two
 * sentences saying the same report is late does not tell them more.
 */
export function describeSlaBreach(breach, targets) {
  if (!breach || (!breach.ack && !breach.resolve)) return null

  const ackText = `acknowledgement target of ${targets.ackTargetMinutes} minute${
    targets.ackTargetMinutes === 1 ? '' : 's'
  }`
  const resolveText = `resolution target of ${targets.resolveTargetHours} hour${
    targets.resolveTargetHours === 1 ? '' : 's'
  }`

  if (breach.ack && breach.resolve) return `Past both the ${ackText} and the ${resolveText}.`
  if (breach.resolve) return `Past the ${resolveText}.`
  return `Past the ${ackText}.`
}

/**
 * True when the server has recorded this breach as well as the client deriving
 * it. Only the detail views say so — in a table it is a distinction without a
 * decision.
 */
export function isServerRecordedBreach(incident) {
  const stored = incident?.slaBreach
  return Boolean(stored && (stored.ack || stored.resolve))
}
