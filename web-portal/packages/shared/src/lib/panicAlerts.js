// Bridges the real `panic_alerts` Firestore schema (written by the mobile
// app's SOS button — see lib/features/panic_button/screens/panic_button_screen.dart
// _sendPanicAlert) to the flat shape the dashboard components expect. This
// collection has zero web UI today: onPanicAlertCreate (functions/index.js)
// only fans the alert out over FCM to on-duty guards' phones, so a guard at
// the desk watching the web dashboard currently has no way to see it at all.
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'
import { staffLabel } from '@shared/lib/identity'

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
    lat: d.location?.lat,
    lng: d.location?.lng,
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

export async function resolvePanicAlert(alertId) {
  await updateDoc(doc(db, 'panic_alerts', alertId), {
    status: 'resolved',
    resolvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}
