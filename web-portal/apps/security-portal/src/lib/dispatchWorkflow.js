import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'
import { notifyResident } from '@shared/lib/incidents'
import {
  ARRIVAL_RADIUS_M,
  STAGE_TO_DISPLAY_STATUS,
  STAGE_TO_WIRE_STATUS,
} from '@shared/lib/dispatchStage'
import { captureForensics, locateDevice } from '@/lib/forensics'
import { distanceMeters } from '@/lib/directions'

/**
 * The dispatch commands. Each one is a single atomic write.
 *
 *   dispatchUnit          POST /incidents/dispatch   none → DISPATCHED
 *   acknowledgeAndRespond POST /incidents/respond    DISPATCHED → RESPONDING
 *   autoArrival           stamps onSceneAt           (stage unchanged)
 *   updateInvestigation / escalateIncident           within INVESTIGATING
 *   resolveIncident       POST /incidents/resolve    INVESTIGATING → RESOLVED
 *
 * ── A BATCH, NOT AN ENDPOINT ────────────────────────────────────────────────
 * The brief names REST endpoints. This project has no server of its own, and
 * its Cloud Functions cannot be redeployed on the Spark plan. So each "endpoint"
 * is a batched Firestore write, and firestore.rules is the server-side check:
 * it accepts a write only if it is the next edge of the machine, made by
 * someone allowed to make it, carrying the fields that edge requires, WITH its
 * audit entry in the same batch. That is the same guarantee an endpoint would
 * give. It also means the check cannot be bypassed from a browser console.
 *
 * ── A BATCH, NOT A TRANSACTION ──────────────────────────────────────────────
 * Transactions need the server and fail offline. A batch is applied to the
 * local cache at once and queued until the device reconnects. So a guard on
 * the far side of the estate with no signal can still press "I have arrived":
 * their screen moves on, and the write lands when the signal returns. If the
 * call has moved on in the meantime (another officer acted first), the rules
 * refuse the queued write when it arrives, and the local change is rolled
 * back by the next snapshot.
 *
 * Every command returns `{ committed, notify }`:
 *   committed  a Promise that settles when the SERVER accepts or refuses the
 *              write. Offline, that is when the device reconnects.
 *   notify     a function, called once `committed` resolves, that pushes the
 *              resident where this stage has a message, and resolves to the
 *              delivery outcome. null where the stage tells the resident nothing.
 */

export const SUPERVISOR_ROLES = ['super_admin', 'security_head']

/** May this signed-in officer advance a call that is booked to someone? */
export function canActOn(incident, { uid, role }) {
  if (!incident || !uid) return false
  return incident.assignedGuardUid === uid || SUPERVISOR_ROLES.includes(role)
}

function actorName() {
  return auth.currentUser?.displayName || auth.currentUser?.email || 'Security'
}

/** Stages that push the resident, and why. See residentMessageForStage in lib/dispatch.js. */
const NOTIFY_STAGES = new Set(['responding', 'on_site', 'resolved'])

/**
 * @param {object} args
 * @param {string} [args.notifyStatus] Push this display status to the
 *   resident instead of the one the stage implies.
 *
 *   ── WHY AN OVERRIDE EXISTS AT ALL ────────────────────────────────────
 *   The resident's push is normally derived: a stage change implies a
 *   status, and a write that does not move the stage is not news. The
 *   arrival stamp broke both halves of that. It deliberately does NOT move
 *   the stage — the on-site stage was removed — so the derivation would
 *   have sent nothing; and the stage it sits in maps to "Dispatched", so
 *   had it sent anything it would have told a resident with a guard on
 *   their doorstep that one had been assigned.
 *
 *   "A guard is here now" is the one update in this machine a resident
 *   actually feels, and it was the thing most at risk from shortening the
 *   stages. This is what keeps it.
 */
async function commitStage({ incident, action, toStage, fields, role, forensics, detail, notifyStatus }) {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in.')

  const incidentRef = doc(db, 'incidents', incident.id)
  const logRef = doc(collection(incidentRef, 'status_log'))
  const batch = writeBatch(db)
  batch.update(incidentRef, {
    ...fields,
    lastLogId: logRef.id,
    stageUpdatedAt: serverTimestamp(),
  })
  batch.set(logRef, {
    action,
    fromStage: incident.dispatchStage,
    toStage,
    status: STAGE_TO_WIRE_STATUS[toStage],
    userId: user.uid,
    userName: actorName(),
    userRole: role ?? '',
    assignedGuardUid: fields.assignedGuardUid ?? incident.assignedGuardUid ?? '',
    at: serverTimestamp(),
    clientAt: forensics.clientAt,
    queuedOffline: forensics.queuedOffline,
    geolocation: forensics.geolocation,
    batteryLevel: forensics.batteryLevel,
    charging: forensics.charging,
    deviceTelemetry: forensics.deviceTelemetry,
    detail: detail ?? {},
  })

  const committed = batch.commit()
  const derived = NOTIFY_STAGES.has(toStage) && toStage !== incident.dispatchStage
  const status = notifyStatus ?? (derived ? STAGE_TO_DISPLAY_STATUS[toStage] : null)
  const notify = status
    ? () => notifyResident(incident.id, { status, stage: toStage })
    : null
  return { committed, notify }
}

/**
 * Stage 1a. The dispatcher books the call to an officer. Also a reassignment:
 * the same edge from DISPATCHED, when the first officer has not acknowledged.
 *
 * `guard` is a unit from useGuardUnits: `{ uid, name, badgeNumber, position }`.
 * The resident is not told yet. A unit is only "on the way" once the officer
 * has accepted, which is the next stage.
 */
export async function dispatchUnit(incident, guard, { role }) {
  const forensics = await captureForensics({ timeout: 2500 })
  const guardDistanceM =
    guard.position && typeof incident.lng === 'number'
      ? Math.round(distanceMeters([guard.position.lng, guard.position.lat], [incident.lng, incident.lat]))
      : null
  return commitStage({
    incident,
    action: incident.dispatchStage === 'dispatched' ? 'reassign' : 'dispatch',
    toStage: 'dispatched',
    role,
    forensics,
    fields: {
      status: 'dispatched',
      dispatchStage: 'dispatched',
      assignedGuardUid: guard.uid,
      assignedGuardName: guard.name,
      assignedGuardBadge: guard.badgeNumber ?? '',
      dispatchedAt: serverTimestamp(),
      dispatchedByUid: auth.currentUser?.uid ?? '',
      dispatchedByName: actorName(),
    },
    detail: {
      previousGuardUid: incident.dispatchStage === 'dispatched' ? incident.assignedGuardUid ?? '' : '',
      guardDistanceM,
    },
  })
}

/**
 * Stage 1b. The officer accepts. Their device switches to high-precision GPS
 * (useGuardTelemetry sees the stage change) and the resident is told they are
 * on the way. The fix is taken fresh, since it is the start of the route.
 */
export async function acknowledgeAndRespond(incident, { role }) {
  const forensics = await captureForensics({ fresh: true, timeout: 5000 })
  return commitStage({
    incident,
    action: 'respond',
    toStage: 'responding',
    role,
    forensics,
    fields: {
      dispatchStage: 'responding',
      // Every surface reads `status`; see STAGE_TO_WIRE_STATUS.
      status: STAGE_TO_WIRE_STATUS.responding,
      respondingAt: serverTimestamp(),
    },
  })
}

/**
 * The fix is only trusted to confirm arrival when the device itself claims it
 * is this good. A browser on Wi-Fi positioning reports ±100 m and worse, and
 * "within 30 m" means nothing from a fix that could be anywhere in 100.
 */
export const ARRIVAL_ACCURACY_LIMIT_M = 50

/**
 * The "I have arrived" proximity check. Measures, does not write.
 *
 * Returns `{ fix, distanceM, accuracyM, verdict }`, where `verdict` is:
 *   within     inside ARRIVAL_RADIUS_M on a fix accurate enough to trust
 *   far        outside it
 *   imprecise  inside or outside, but the fix is too coarse to say
 *   no-fix     no position at all (denied, indoors, timed out)
 *   no-pin     the report has no coordinates to measure against
 * Anything but `within` needs an override with a reason.
 *
 * A metre of margin under the radius: firestore.rules re-measures the same fix
 * with its own geodesic formula, and a haversine 29.99 m can come back as
 * 30.01 m there, refusing a claim this screen had accepted.
 */
export async function checkArrival(incident) {
  if (typeof incident?.lat !== 'number' || typeof incident?.lng !== 'number') {
    return { fix: null, distanceM: null, accuracyM: null, verdict: 'no-pin' }
  }
  const { fix, error } = await locateDevice({ fresh: true, timeout: 10_000 })
  if (!fix) return { fix: null, distanceM: null, accuracyM: null, verdict: 'no-fix', error }

  const distanceM = Math.round(distanceMeters([fix.lng, fix.lat], [incident.lng, incident.lat]) * 10) / 10
  const accuracyM = fix.accuracy
  let verdict = distanceM <= ARRIVAL_RADIUS_M - 1 ? 'within' : 'far'
  if (verdict === 'within' && (accuracyM == null || accuracyM > ARRIVAL_ACCURACY_LIMIT_M)) verdict = 'imprecise'
  return { fix, distanceM, accuracyM, verdict }
}

/**
 * The unit has reached the pin. Stamp it — and do NOT move the stage.
 *
 * ── THE BUTTON THIS REPLACED, AND WHY IT HAD TO GO ───────────────────────
 * "I have arrived" was a stage of its own, pressed by a guard standing at a
 * scene with their phone out. It was friction at the worst possible moment,
 * and the timestamps it produced were worse than useless: routinely pressed
 * late, sometimes in a batch at the end of a call, which is a measurement of
 * when somebody remembered rather than when they arrived.
 *
 * So the EVENT survived and the STAGE did not. The console already knows
 * where the unit is — it is drawing the marker — so it stamps `onSceneAt`
 * the first time the assigned officer's own telemetry comes inside the
 * radius. That keeps the response-target metric's endpoint, keeps the
 * resident's On-Site notification, and asks the guard for nothing.
 *
 * ── NO OVERRIDE PATH, DELIBERATELY ───────────────────────────────────────
 * `confirmArrival` took an override reason, because a human was ASSERTING
 * they had arrived and the rules wanted them to account for a GPS that
 * disagreed. Nobody is asserting anything now. If the fix never comes inside
 * the radius the stamp simply does not happen, the call goes from Dispatched
 * to Resolved, and no record claims an arrival that was not observed. A
 * silent gap is the honest outcome; an automatic override would be the
 * console inventing one.
 *
 * Idempotent at two levels: the caller only fires it once per call (see
 * `useAutoArrival`), and the rules refuse a second stamp because
 * `onSceneAt` is already set.
 */
export async function autoArrival(incident, check, { role }) {
  if (check?.verdict !== 'within') return false
  const forensics = await captureForensics({ fix: check.fix ?? null })
  await commitStage({
    incident,
    action: 'arrive',
    // The stage does not move; the log entry still records that it happened,
    // which is what `status_log` is for.
    toStage: 'responding',
    role,
    forensics,
    fields: {
      status: 'in_progress',
      onSceneAt: serverTimestamp(),
      arrival: {
        lat: check.fix?.lat ?? null,
        lng: check.fix?.lng ?? null,
        accuracyM: check.accuracyM ?? null,
        distanceM: check.distanceM ?? null,
        withinRadius: true,
        override: false,
        overrideReason: '',
      },
    },
    detail: { verdict: check.verdict, automatic: true },
    // The whole point of keeping the arrival event — see the note on
    // `notifyStatus`.
    notifyStatus: 'On-Site',
  })
  return true
}

/**
 * ── WHAT USED TO BE HERE ────────────────────────────────────────────────
 * `currentInvestigation`, `toggleInvestigationTag`, `addInvestigationPhotos`
 * and `escalateIncident`.
 *
 * The first three wrote an `investigation` field an officer edited live,
 * mid-response, each press its own logged write. The quick tags moved into
 * the resolution, where they are stated once alongside the outcome and notes
 * they belong with; the scene photos went with them, because resolving
 * already requires at least one photo and two trays on one call is a
 * question about which to use rather than extra evidence.
 *
 * `escalateIncident` raised a critical alert on every console. It was removed
 * on the understanding that backup is called by radio. Worth recording what
 * that gave up, because the premise offered for it was not quite right: the
 * scheduled sweep escalates unattended SOS ALERTS and has never escalated an
 * incident, so nothing automatic inherited this. An officer who needs a
 * second unit has no in-console way to say so.
 *
 * Reinstating any of them means restoring its rule too — `isSceneWork` and
 * `validEscalation` went with them.
 */

/**
 * Stage 3. Closes the call. The outcome, notes and at least one photo are
 * required here and by the rules. `ratingRequestedAt` is what the resident
 * app watches to ask for a rating. The resolved report leaves the live map
 * (the dashboard only queries open calls) and appears in Incident history.
 * The officer's device drops back to idle telemetry when it sees the stage
 * change.
 */
export async function resolveIncident(incident, { outcome, notes, photoUrls, tags = [] }, { role }) {
  const forensics = await captureForensics()
  return commitStage({
    incident,
    action: 'resolve',
    toStage: 'resolved',
    role,
    forensics,
    fields: {
      status: 'resolved',
      dispatchStage: 'resolved',
      resolvedAt: serverTimestamp(),
      resolvedBy: auth.currentUser?.uid ?? '',
      resolvedByName: actorName(),
      // `tags` rides INSIDE the resolution rather than beside it: one
      // object, written in one batch, that reads back as the account of how
      // this call ended. They used to be a separate `investigation` field
      // toggled live during the response — see ResolveIncidentModal.
      resolution: { outcome, notes: notes.trim(), photoUrls, tags },
      ratingRequestedAt: serverTimestamp(),
    },
    detail: { outcome, photoCount: photoUrls.length, tagCount: tags.length },
  })
}
