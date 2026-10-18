import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'

/**
 * The settings audit trail — one `settings_changes` document per confirmed
 * Save on Admin › Settings (2026-10-18).
 *
 * `system_settings/operations` only ever carried the LAST writer
 * (`updatedBy`), which answers "who touched it" but never "what did they
 * change". Each entry here records the actor and every field that moved, with
 * its value before and after, so Audit History can show a real trail.
 *
 * Append-only by rule: admins may create (stamped as themselves, at server
 * time) and read; nobody may edit or delete an entry.
 */

export const SETTINGS_CHANGES = 'settings_changes'

/** Every field a control on the Settings page edits, with its on-screen name. */
const FIELDS = [
  ['guardhouse.requireHandover', 'Require a duty log at clock-out'],
  ['sos.sirenEnabled', 'Emergency siren'],
  ['sos.escalateAfterMinutes', 'Auto-escalation window', (v) => `${v} min`],
  ['sos.geofenceAlert', 'Geofence boundary alert'],
  ['sos.hotlines', 'Emergency hotlines', (v) => (Array.isArray(v) ? v.map((h) => h?.label || h?.number).filter(Boolean).join(', ') || 'None' : '')],
  ['push.enabled', 'Resident push notifications'],
  ['incidents.autoAssign', 'Automatic assignment'],
  ['incidents.ackTargetMinutes', 'Acknowledgement target', (v) => `${v} min`],
  ['incidents.resolveTargetHours', 'Resolution target', (v) => `${v} h`],
  ['incidents.hazardTtlHours', 'Hazard pin lifetime', (v) => `${v} h`],
  ['guardhouse.sirenVolume', 'Alarm volume', (v) => `${Math.round(Number(v) * 100)}%`],
  ['guardhouse.telemetryIntervalSeconds', 'Location ping interval', (v) => `${v} s`],
  ['residentApp.maxUploadMb', 'Evidence upload limit', (v) => `${v} MB`],
  ['organisation.contactEmail', 'Contact email'],
  ['organisation.officeHours', 'Office hours'],
  ['organisation.logoUrl', 'Logo'],
  ['security.requireMfaForAdmins', 'Two-factor authentication'],
  ['security.sessionTimeoutMinutes', 'Idle sign-out', (v) => (Number(v) === 0 ? 'Never' : `${v} min`)],
  ['organisation.timeZone', 'Time zone'],
  ['organisation.auditRetentionDays', 'Audit history retention', (v) => (Number(v) === 0 ? 'Indefinitely' : `${v} days`)],
]

const at = (obj, path) => path.split('.').reduce((node, key) => node?.[key], obj)

function show(value, format) {
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (value == null || value === '') return 'Empty'
  return format ? format(value) : String(value)
}

/**
 * What differs between the saved settings and the draft, as display rows:
 * `[{ path, label, from, to }]`. Only fields the page edits are compared.
 */
export function diffSettings(saved, draft) {
  return FIELDS.flatMap(([path, label, format]) => {
    const before = at(saved, path)
    const after = at(draft, path)
    if (JSON.stringify(before) === JSON.stringify(after)) return []
    return [{ path, label, from: show(before, format), to: show(after, format) }]
  })
}

/** Append one entry to the trail. Throws on a denied write; callers decide. */
export function logSettingsChange(changes) {
  const user = auth.currentUser
  return addDoc(collection(db, SETTINGS_CHANGES), {
    at: serverTimestamp(),
    actorUid: user?.uid ?? null,
    actorName: user?.displayName || user?.email || null,
    changes: changes.map(({ path, label, from, to }) => ({ path, label, from, to })),
  })
}
