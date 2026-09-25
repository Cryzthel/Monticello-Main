import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'
import {
  SETTINGS_COLLECTION,
  SETTINGS_DOC,
  commitSettings,
  readMeta,
  sanitizeSettings,
} from '@shared/lib/systemSettingsStore'

/**
 * The Firestore half of the notification preferences (schema and store:
 * systemSettingsStore.js).
 *
 * The read is live (`onSnapshot`), so a siren switched off in Admin ›
 * Settings reaches every open guardhouse console within a second.
 */

const settingsRef = () => doc(db, SETTINGS_COLLECTION, SETTINGS_DOC)

/** Subscribe the store to the settings document. Returns the unsubscribe. */
export function watchSettings() {
  commitSettings({ values: undefined, status: 'loading' })
  return onSnapshot(
    settingsRef(),
    (snap) => {
      const raw = snap.exists() ? snap.data() : null
      commitSettings({
        values: sanitizeSettings(raw ?? {}),
        status: raw ? 'live' : 'default',
        meta: readMeta(raw),
      })
    },
    (error) => {
      // Denied (rules not yet deployed) or offline. Defaults are the original
      // behaviour, so this is a safe place to land — but it is recorded, and
      // the Settings page says so rather than pretending a save took effect.
      console.warn(`[settings] could not read ${SETTINGS_COLLECTION}/${SETTINGS_DOC}:`, error?.code ?? error)
      commitSettings({ values: sanitizeSettings({}), status: 'error', error: error?.code ?? 'unknown' })
    },
  )
}

function stamp() {
  const user = auth.currentUser
  return {
    updatedAt: serverTimestamp(),
    updatedBy: { uid: user?.uid ?? null, name: user?.displayName || user?.email || null },
  }
}

/**
 * Save one or more settings groups, stamped with who saved them.
 *
 * ── WHAT `merge: true` DOES AND DOES NOT MERGE ──────────────────────────────
 * Maps merge RECURSIVELY, so `{ sos: { sirenEnabled } }` leaves the rest of
 * `sos` alone — hotlines and the escalation window survive a switch being
 * flipped. Arrays do NOT merge: writing `hotlines` replaces the whole list,
 * which is what you want for a list the admin is editing as a list.
 *
 * Callers still hand over a whole sanitized group rather than a loose field,
 * for a different reason: `sanitizeSettings` is what clamps these values, and
 * writing a group that has been through it is what keeps a value the form
 * never validated — a pasted number, an old build's field — out of the
 * document the mobile app reads.
 *
 * @param {object} groups e.g. `{ sos: {...} }` or several groups at once.
 */
export function saveSettings(groups) {
  return setDoc(settingsRef(), { ...groups, ...stamp() }, { merge: true })
}
