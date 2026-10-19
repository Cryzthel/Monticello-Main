// Bridges the real `panic_alerts` Firestore schema (written by the mobile
// app's SOS button — see lib/features/panic_button/screens/panic_button_screen.dart
// _sendPanicAlert) to the flat shape the dashboard components expect. This
// collection has zero web UI today: onPanicAlertCreate (functions/index.js)
// only fans the alert out over FCM to on-duty guards' phones, so a guard at
// the desk watching the web dashboard currently has no way to see it at all.
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'
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

export async function acknowledgePanicAlert(alertId, staffName) {
  const name = (staffName ?? '').trim()
  await updateDoc(doc(db, 'panic_alerts', alertId), {
    status: 'acknowledged',
    // The uid is the audit trail. It identifies the officer without recording
    // a contact detail on a document the whole guardhouse can read.
    acknowledgedBy: auth.currentUser?.uid ?? null,
    // No `auth.currentUser.email` fallback. That fallback is how the address
    // got in here — a caller passing nothing silently wrote one.
    acknowledgedByName: acknowledgedByLabel(name),
    acknowledgedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Close an alert out, optionally with the account of what was done.
 *
 * ── THE RECORD IS OPTIONAL HERE, AND THAT IS DELIBERATE ────────────────────
 * The rail resolves with nothing: an officer clearing a false alarm from a
 * list of fourteen should not be made to write an essay, and a console that
 * demanded one would be a console where alerts stay open because closing them
 * is work. The modal resolves WITH notes and photo proof, because somebody who
 * has opened a single alert and is closing it there has the time and is
 * usually the person who attended.
 *
 * `resolution` is written only when something was actually supplied, so an
 * empty object never lands on the document and "was anything recorded" stays
 * answerable by the field's presence.
 *
 * No rules change was needed: `panic_alerts` allows `update: if
 * isSecurityStaff()` with no field validation, so the whole status surface —
 * including this — moves together. See the note in firestore.rules.
 */
export async function resolvePanicAlert(alertId, { notes = '', photoUrls = [] } = {}) {
  const trimmed = String(notes ?? '').trim()
  const photos = Array.isArray(photoUrls) ? photoUrls.filter(Boolean) : []

  await updateDoc(doc(db, 'panic_alerts', alertId), {
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
  })
}
