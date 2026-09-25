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
 *   confirmArrival        POST /incidents/arrive     RESPONDING → ON-SITE
 *   beginInvestigation                               ON-SITE → INVESTIGATING
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

async function commitStage({ incident, action, toStage, fields, role, forensics, detail }) {
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
  const notify = NOTIFY_STAGES.has(toStage) && toStage !== incident.dispatchStage
    ? () => notifyResident(incident.id, { status: STAGE_TO_DISPLAY_STATUS[toStage], stage: toStage })
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
    fields: { dispatchStage: 'responding', respondingAt: serverTimestamp() },
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
 * Stage 2a. Pass the result of `checkArrival`. Anything but `within` needs
 * `overrideReason`. The rules demand one, and they re-measure a `within`
 * claim against the pin themselves.
 */
export async function confirmArrival(incident, check, { role, overrideReason = '' }) {
  const within = check.verdict === 'within'
  const reason = overrideReason.trim()
  if (!within && reason.length < 3) throw new Error('Give a reason for confirming arrival without a GPS match.')

  const forensics = await captureForensics({ fix: check.fix ?? null })
  return commitStage({
    incident,
    action: 'arrive',
    toStage: 'on_site',
    role,
    forensics,
    fields: {
      status: 'in_progress',
      dispatchStage: 'on_site',
      onSceneAt: serverTimestamp(),
      arrival: {
        lat: check.fix?.lat ?? null,
        lng: check.fix?.lng ?? null,
        accuracyM: check.accuracyM ?? null,
        distanceM: check.distanceM ?? null,
        withinRadius: within,
        override: !within,
        overrideReason: within ? '' : reason.slice(0, 280),
      },
    },
    detail: { verdict: check.verdict },
  })
}

/** Stage 2b. Opens scene photos, quick tags and escalation. */
export async function beginInvestigation(incident, { role }) {
  const forensics = await captureForensics()
  return commitStage({
    incident,
    action: 'investigate',
    toStage: 'investigating',
    role,
    forensics,
    fields: {
      dispatchStage: 'investigating',
      investigatingAt: serverTimestamp(),
      investigation: { tags: [], photoUrls: [] },
    },
  })
}

function currentInvestigation(incident) {
  return {
    tags: incident.investigation?.tags ?? [],
    photoUrls: incident.investigation?.photoUrls ?? [],
  }
}

/** Toggle one quick tag. Logged like a stage change: it is part of the record of the scene. */
export async function toggleInvestigationTag(incident, tag, { role }) {
  const investigation = currentInvestigation(incident)
  const on = !investigation.tags.includes(tag)
  const tags = on ? [...investigation.tags, tag] : investigation.tags.filter((t) => t !== tag)
  const forensics = await captureForensics()
  return commitStage({
    incident,
    action: on ? 'tag_added' : 'tag_removed',
    toStage: 'investigating',
    role,
    forensics,
    fields: { investigation: { ...investigation, tags } },
    detail: { tag },
  })
}

/** Append uploaded scene photos. */
export async function addInvestigationPhotos(incident, urls, { role }) {
  const investigation = currentInvestigation(incident)
  const forensics = await captureForensics()
  return commitStage({
    incident,
    action: 'photos_added',
    toStage: 'investigating',
    role,
    forensics,
    fields: { investigation: { ...investigation, photoUrls: [...investigation.photoUrls, ...urls] } },
    detail: { count: urls.length },
  })
}

/**
 * Emergency escalation, once per call. Every console's watchdog raises a
 * critical alert for it (see DispatchWatchdog).
 */
export async function escalateIncident(incident, reason, { role }) {
  const forensics = await captureForensics({ fresh: true, timeout: 4000 })
  return commitStage({
    incident,
    action: 'escalate',
    toStage: 'investigating',
    role,
    forensics,
    fields: {
      escalation: {
        at: serverTimestamp(),
        byUid: auth.currentUser?.uid ?? '',
        byName: actorName(),
        reason: reason.trim().slice(0, 280),
      },
    },
    detail: { reason: reason.trim().slice(0, 280) },
  })
}

/**
 * Stage 3. Closes the call. The outcome, notes and at least one photo are
 * required here and by the rules. `ratingRequestedAt` is what the resident
 * app watches to ask for a rating. The resolved report leaves the live map
 * (the dashboard only queries open calls) and appears in Incident history.
 * The officer's device drops back to idle telemetry when it sees the stage
 * change.
 */
export async function resolveIncident(incident, { outcome, notes, photoUrls }, { role }) {
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
      resolution: { outcome, notes: notes.trim(), photoUrls },
      ratingRequestedAt: serverTimestamp(),
    },
    detail: { outcome, photoCount: photoUrls.length },
  })
}
