// Bridges the real `panic_alerts` Firestore schema (written by the mobile
// app's SOS button — see lib/features/panic_button/screens/panic_button_screen.dart
// _sendPanicAlert) to the flat shape the dashboard components expect. This
// collection has zero web UI today: onPanicAlertCreate (functions/index.js)
// only fans the alert out over FCM to on-duty guards' phones, so a guard at
// the desk watching the web dashboard currently has no way to see it at all.
import { doc, runTransaction, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'
import { isOffline } from '@shared/lib/connectivity'
import { staffLabel } from '@shared/lib/identity'
import { readLatLng } from '@shared/lib/coordinates'

export function mapPanicAlertDoc(d) {
  const createdAt = d.createdAt?.toDate ? d.createdAt.toDate() : d.createdAt
  const acknowledgedAt = d.acknowledgedAt?.toDate ? d.acknowledgedAt.toDate() : d.acknowledgedAt
  const resolvedAt = d.resolvedAt?.toDate ? d.resolvedAt.toDate() : d.resolvedAt
  // Written by the scheduled sweep, never by a console — update access to this
  // collection is security-only, and an alert nobody has attended is by
  // definition one no console is acting on.
  const escalatedAt = d.escalatedAt?.toDate ? d.escalatedAt.toDate() : d.escalatedAt

  return {
    id: d.id,
    residentUid: d.residentUid,
    residentName: d.residentName || 'Unknown resident',
    residentPhone: d.residentPhone || '',
    phase: d.propertyPhase,
    block: d.propertyBlock,
    lot: d.propertyLot,
    address: d.propertyLabel || 'Address unavailable',
    // Validated and shape-tolerant; see lib/coordinates.
    ...readLatLng(d),
    status: d.status || 'active',
    acknowledgedByName: d.acknowledgedByName,
    acknowledgedBy: d.acknowledgedBy ?? null,
    acknowledgedAt,
    escalatedAt,
    // The window that was in force when it fired. "Escalated" alone does not
    // say whether the target was three minutes or ten, and the setting will
    // have been changed by the time anyone reads this back.
    escalatedAfterMinutes: d.escalatedAfterMinutes,
    resolvedAt,
    createdAt,
  }
}

/**
 * The label shown for whoever acknowledged an alert — never an email address.
 *
 * ── WHY THIS IS A FUNCTION AND NOT JUST A BETTER WRITE ─────────────────────
 * `acknowledgedByName` used to be filled with the signed-in address, so every
 * alert already in Firestore carries one. Fixing the write only stops NEW
 * leaks; the badge on an alert acknowledged last week would still print an
 * officer's email at whoever opens it. So every render goes through here, and
 * anything that looks like an address is replaced rather than shown.
 *
 * The identity is not lost: `acknowledgedBy` holds the uid, which is the field
 * an audit actually needs and is not a contact detail.
 */
export function acknowledgedByLabel(value) {
  // Delegated to `staffLabel`, which is this same rule shared with the dispatch
  // surfaces. Behaviour is unchanged: blank or an address becomes the role.
  return staffLabel(value, 'Security personnel')
}

/**
 * ── THE SOS STATE MACHINE (2026-10-19) ─────────────────────────────────────
 *
 *   active ──Acknowledge / Respond──▶ acknowledged ──Submit & confirm──▶ resolved
 *
 * Strictly in that order, and each edge once. Thrown when an action finds the
 * alert has already moved: another officer acknowledged it first, or it was
 * resolved. `current` is the alert as the server has it now (mapped), and the
 * message names who acted, so every caller that prints `describeError(err)`
 * says "Acknowledged by River Santos" rather than a permission error.
 *
 * Online, both edges run as a TRANSACTION that reads the alert first — two
 * guards pressing Acknowledge at once used to both succeed, the second
 * silently replacing the first officer's name. Offline they stay a plain
 * update, applied locally and queued; firestore.rules refuses a queued one
 * that would overwrite an acknowledgement or reopen a resolved alert.
 */
export class PanicConflictError extends Error {
  constructor(current) {
    const who = current?.acknowledgedByName ? acknowledgedByLabel(current.acknowledgedByName) : 'another officer'
    super(
      current?.status === 'resolved'
        ? 'This SOS has already been resolved.'
        : current?.status === 'acknowledged'
          ? `Already acknowledged by ${who}.`
          : 'This SOS must be acknowledged before it can be resolved.',
    )
    this.name = 'PanicConflictError'
    this.code = 'sos-conflict'
    this.current = current
  }
}

/** One edge of the machine: `fields`, only if the alert is in `allowedFrom`. */
async function transition(alertId, { allowedFrom, fields }) {
  const ref = doc(db, 'panic_alerts', alertId)
  if (isOffline()) {
    await updateDoc(ref, fields)
    return
  }
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.exists() ? mapPanicAlertDoc({ id: snap.id, ...snap.data() }) : null
    if (!current || !allowedFrom.includes(current.status)) throw new PanicConflictError(current)
    tx.update(ref, fields)
  })
}

/** active → acknowledged. The officer who pressed it owns the response. */
export async function acknowledgePanicAlert(alertId, staffName) {
  const name = (staffName ?? '').trim()
  await transition(alertId, {
    allowedFrom: ['active'],
    fields: {
      status: 'acknowledged',
      // The uid is the audit trail. It identifies the officer without recording
      // a contact detail on a document the whole guardhouse can read.
      acknowledgedBy: auth.currentUser?.uid ?? null,
      // No `auth.currentUser.email` fallback. That fallback is how the address
      // got in here — a caller passing nothing silently wrote one.
      acknowledgedByName: acknowledgedByLabel(name),
      acknowledgedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  })
}

/**
 * Close an alert out, optionally with the account of what was done.
 *
 * ── THE RECORD IS OPTIONAL HERE, AND THAT IS DELIBERATE ────────────────────
 * An officer clearing a false alarm should not be made to write an essay, and
 * a console that demanded one would be a console where alerts stay open
 * because closing them is work. The modal offers notes and photo proof; both
 * may be left empty.
 *
 * `resolution` is written only when something was actually supplied, so an
 * empty object never lands on the document and "was anything recorded" stays
 * answerable by the field's presence.
 *
 * Only from `acknowledged` (2026-10-19), enforced here and in firestore.rules.
 */
export async function resolvePanicAlert(alertId, { notes = '', photoUrls = [] } = {}) {
  const trimmed = String(notes ?? '').trim()
  const photos = Array.isArray(photoUrls) ? photoUrls.filter(Boolean) : []

  // acknowledged → resolved only. An alert nobody has acknowledged is not
  // resolvable from any console (see the state machine above).
  await transition(alertId, {
    allowedFrom: ['acknowledged'],
    fields: {
      status: 'resolved',
      resolvedAt: serverTimestamp(),
      // Who closed it. The uid is the audit trail and the label is what a
      // console prints — the same split `acknowledgePanicAlert` makes, and for
      // the same reason: an email must not reach a document the whole
      // guardhouse can read.
      resolvedBy: auth.currentUser?.uid ?? null,
      resolvedByName: acknowledgedByLabel(auth.currentUser?.displayName ?? ''),
      ...(trimmed || photos.length
        ? { resolution: { ...(trimmed ? { notes: trimmed } : {}), ...(photos.length ? { photoUrls: photos } : {}) } }
        : {}),
      updatedAt: serverTimestamp(),
    },
  })
}
