import { staffLabel } from '@shared/lib/identity'
import { formatMinutes, incidentDurations } from '@shared/lib/incidents'
import { minutesWaiting } from '@shared/lib/wpda'

/**
 * Derivations for the dispatch details drawer.
 *
 * ── THE RESPONSE TARGET IS COMPUTED, NOT STORED, AND SAYS SO ──────────────
 *
 *   the target    is a response WINDOW, not a prediction: how long this
 *                 severity is meant to take from report to arrival, and how
 *                 much of it is left. The road ETA is a separate number,
 *                 drawn from the assigned unit's live position by
 *                 useDispatchRoute, and the drawer labels each for what it is.
 *
 * It is useful precisely because it is honest about being arithmetic. A
 * fabricated ETA on a dispatch console is worse than none: a guard who trusts
 * "4 minutes" and finds it invented stops trusting the panel entirely.
 */

/**
 * Minutes from report to on-scene that each severity is expected to meet.
 *
 * A LOCAL DISPATCH POLICY, not a value read from anywhere. Nothing else in the
 * codebase declares response targets — not firestore.rules, not the WPDA
 * scorer, not the Cloud Functions — so this is the definition rather than a
 * copy of one, and moving it is a policy change with one place to make it.
 *
 * Ordered against the same severity vocabulary the WPDA urgency weights use
 * (critical/high/medium/low), so a report that scores as more urgent is also
 * given less time — the two would otherwise be able to disagree.
 */
export const RESPONSE_TARGET_MINUTES = {
  critical: 5,
  high: 10,
  medium: 20,
  low: 45,
}

export function responseTargetFor(severity) {
  return RESPONSE_TARGET_MINUTES[severity] ?? RESPONSE_TARGET_MINUTES.medium
}

/**
 * A short, human-quotable reference for one incident.
 *
 * Firestore ids are 20 random characters — unreadable over a radio and
 * impossible to check back against a screen. The first eight, uppercased, is
 * the same shortening `FiledReportsTable` already applies to an officer's uid,
 * so the two consoles abbreviate identifiers the same way.
 *
 * NOT a new identifier: it is a prefix of the real one, so it stays greppable
 * in Firestore and in logs. Collisions across eight base-62-ish characters are
 * not a practical concern at subdivision volumes, and the full id is still
 * what every query uses.
 */
export function incidentReference(id) {
  if (!id) return 'INC-????????'
  return `INC-${String(id).slice(0, 8).toUpperCase()}`
}

/**
 * Where this report stands against its response target.
 *
 * Measured from `reportedAt`, not from `dispatchedAt`. The resident's clock
 * starts when they press send — a report that sat unassigned for twenty
 * minutes and was then dispatched has not earned a fresh twenty-minute
 * window, and measuring from dispatch would let the worst delays disappear.
 *
 * Returns a `state` the caller styles from rather than colour classes, so the
 * drawer owns its own palette and this stays testable as plain data.
 */
export function dispatchEta(report) {
  const target = responseTargetFor(report?.severity)

  if (!report?.reportedAt) {
    return {
      state: 'unknown',
      label: 'No report time',
      detail: 'This report carries no submission timestamp to measure from.',
      target,
    }
  }

  if (report.status === 'Resolved') {
    const { total } = incidentDurations(report)
    return {
      state: 'resolved',
      label: total != null ? formatMinutes(total) : 'Resolved',
      detail:
        total != null
          ? `Actual, report to resolution — ${target}m target`
          : 'Closed without a recorded resolution time',
      target,
    }
  }

  // Once the unit is on site the window is closed, met or missed. It is not
  // still "running out" while the guard investigates.
  if (report.onSceneAt) {
    const toScene = (new Date(report.onSceneAt) - new Date(report.reportedAt)) / 60000
    return {
      state: toScene <= target ? 'met' : 'missed',
      label: `On scene in ${formatMinutes(toScene)}`,
      detail: `Report to arrival — ${target}m target ${toScene <= target ? 'met' : 'missed'}`,
      target,
    }
  }

  const elapsed = minutesWaiting(report.reportedAt)
  const remaining = target - elapsed
  const stage = report.dispatchStage
  const who = report.assignedGuardName || 'the unit'
  const context =
    stage === 'responding'
      ? `${who} en route`
      : stage === 'dispatched'
        ? `Waiting for ${who} to acknowledge`
        : 'No unit dispatched'

  if (remaining <= 0) {
    return {
      state: 'overdue',
      label: `Overdue by ${formatMinutes(-remaining)}`,
      detail: `${context} — ${target}m target passed`,
      target,
    }
  }

  return {
    state: stage === 'responding' ? 'en_route' : 'awaiting',
    label: `${formatMinutes(remaining)} left`,
    detail: `${context} — ${target}m target for ${report.severity ?? 'medium'} priority`,
    target,
  }
}

/**
 * Exactly what the resident will read, per stage — or null where the stage
 * sends nothing.
 *
 * ── MIRRORED FROM THE CLOUD FUNCTION, WHICH IS THE AUTHORITY ──────────────
 * `residentNotification` in functions/index.js composes and SENDS these. This
 * copy lets the drawer show an officer the sentence before they press the
 * button that sends it. The two files name each other: edit them together. A
 * shared module is not possible — `functions/` is CommonJS on the Firebase
 * runtime and `web-portal/` is ESM built by Vite, and no package spans them.
 *
 * DISPATCHED sends nothing. The resident is told a guard is coming only once
 * that guard has accepted the call. Telling them when a dispatcher picks a
 * name would promise a response nobody has agreed to yet.
 *
 * NOTE the function currently deployed predates stages, so until functions are
 * redeployed the resident reads its older sentence for the matching status
 * ("Patrol unit … has been dispatched", "… is currently on-site", "… has
 * been marked as resolved").
 */
export function residentMessageForStage(report, stage, guardName) {
  // `staffLabel`, not the raw stored name. This sentence is quoted to the
  // dispatcher as "Sends: …" and is the wording a resident is told to
  // expect, so an email-provisioned account must not put an address in it.
  // Callers already pass a cleaned label; this is the floor under them.
  const guard = staffLabel(guardName, '') || staffLabel(report?.assignedGuardName, 'Security')
  switch (stage) {
    case 'responding':
      return `Guard ${guard} is en route to your location.`
    // Sent by the automatic arrival stamp, which passes this stage name
    // explicitly even though the dispatch stage no longer moves — the
    // resident's "a guard is here now" message is the whole reason the
    // arrival event outlived its stage. See `autoArrival`.
    case 'on_site':
      return `Guard ${guard} has arrived and is handling your report.`
    case 'resolved':
      return `Your incident report #${incidentReference(report?.id)} has been resolved. Tap to rate the response.`
    default:
      return null
  }
}

/**
 * How the last push actually went, in words an officer can act on.
 *
 * `no-token` is the one that matters and the one that was previously
 * invisible. It does NOT mean the update failed — the stage is written and
 * the resident sees it whenever they next open the app — it means nothing
 * reached their phone, so if the message needed to arrive now, it still has to
 * be delivered by radio, phone or in person. See notifyResident.
 */
export function describeDelivery(reason) {
  switch (reason) {
    case 'sent':
      return { tone: 'success', text: 'Resident notified on their mobile app.' }
    case 'no-token':
      return {
        tone: 'warning',
        text: 'Status saved, but this resident has no device registered for push — they will see it next time they open the app.',
      }
    // Admin › Settings › Push notifications is switched off.
    // Not a failure, and not the officer's to fix — but they still need to
    // know the resident was not told.
    case 'disabled':
      return {
        tone: 'warning',
        text: 'Status saved. Report-update notifications are switched off for this subdivision, so the resident was not notified.',
      }
    default:
      return {
        tone: 'warning',
        text: 'Status saved, but the notification could not be sent. Contact the resident directly.',
      }
  }
}

/**
 * Why a dispatch action did not land, in words an officer can act on.
 *
 * `permission-denied` here almost always means the call moved on first:
 * another officer acknowledged, a supervisor reassigned it, or a queued
 * offline press arrived after the stage had changed. The rules refuse any
 * write that is not the NEXT edge of the machine from where the call is now.
 */
export function describeStageError(err, label) {
  if (err?.code === 'permission-denied') {
    return `${label} was refused. The call may have moved on — another officer or a supervisor may have acted first. Check its current stage.`
  }
  if (err?.code === 'unavailable') {
    return `${label} could not reach the server. Check the connection and try again.`
  }
  return `${label} failed. ${err?.message ?? 'Please try again.'}`
}

/**
 * A press that lost a race, said as what happened rather than as a failure.
 *
 * `current` is the call as the server has it now (StageConflictError, or a
 * re-read after a refused queued write). Nothing went wrong on this console:
 * somebody else got there first, and the drawer is already showing their
 * claim read-only. So this is an `info` receipt, never a red one.
 *
 * Returns null when the call is still where this officer left it — the
 * refusal was something else, and describeStageError should explain it.
 */
export function describeConflict(current, { uid, label } = {}) {
  if (!current) {
    return { tone: 'info', text: 'This call is no longer open. It may have been closed or removed.' }
  }
  const stage = current.dispatchStage
  const who = staffLabel(current.assignedGuardName, '') || 'another officer'
  if (stage === 'resolved') {
    return { tone: 'info', text: `Already resolved by ${staffLabel(current.resolvedByName, '') || who}.` }
  }
  if (current.assignedGuardUid && current.assignedGuardUid !== uid) {
    return {
      tone: 'info',
      text:
        stage === 'responding'
          ? `${who} is already en route to this call.`
          : `Acknowledged by ${who}. This call is theirs now.`,
    }
  }
  if (label === 'Arrived on scene' && current.onSceneAt) {
    return { tone: 'info', text: 'Arrival was already registered for this call.' }
  }
  return {
    tone: 'info',
    text: `${label ?? 'That action'} was not applied — the call was updated a moment ago. Check its stage and try again.`,
  }
}

/**
 * "Block 7 · Lot 14", or '' when neither is recorded.
 *
 * Phase is left out on purpose. Block and lot are what a responding unit
 * reads off the house; the phase is context, and the surfaces that want it
 * print it separately and quieter.
 */
export function blockLotLabel(report) {
  return [report?.block && `Block ${report.block}`, report?.lot && `Lot ${report.lot}`].filter(Boolean).join(' · ')
}

/**
 * A running clock: "0:47", "12:05", "1:02:33". For the elapsed-time counter
 * in the drawer header and the acknowledgement countdown, where seconds are
 * the point.
 */
export function formatStopwatch(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** "just now", "12 s ago", "4 min ago" — how old a GPS fix or heartbeat is. */
export function formatAgo(ms) {
  if (ms == null) return 'never'
  if (ms < 5000) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)} s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`
  return `${Math.round(ms / 3_600_000)} h ago`
}

/**
 * The Guardhouse's names for the FOUR steps (by request, 2026-10-19:
 * Acknowledge → En route → Arrived on scene → Resolve). Display only — the
 * stored stages stay three; arrival is the `onSceneAt` stamp:
 *   dispatched  → "Acknowledged": the call is taken or assigned (dispatchedAt)
 *   responding  → "En route": the officer is on the way (respondingAt)
 *   on_site     → "Arrived on scene": responding + onSceneAt
 *   resolved    → "Resolved" (resolvedAt)
 * Used by the drawer's stepper and status history and the route sheet's stage
 * badge. Admin and the resident app keep STAGE_LABELS.
 */
export const GUARD_STAGE_LABELS = {
  none: 'Awaiting acknowledgement',
  dispatched: 'Acknowledged',
  responding: 'En route',
  resolved: 'Resolved',
  // The third step is drawn from `onSceneAt`, not a stored stage (StageStepper).
  on_site: 'Arrived on scene',
  investigating: 'Arrived on scene',
}
