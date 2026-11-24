import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { auth, db } from '@shared/lib/firebase'

/**
 * Removing an audit entry.
 *
 * The audit trail is DERIVED from timestamps already on incidents and
 * announcements (see AdminHistoryPage), so there is no log row to delete —
 * deleting the incident would destroy the very evidence the log exists to
 * record. "Delete entry" therefore writes a dismissal keyed by the synthetic
 * event id, and the table filters against it. Shared rather than per-browser,
 * so the log reads the same for every admin.
 *
 * One batch rather than N parallel setDoc calls: a partial batch delete would
 * leave the operator staring at a half-cleared table with no way to tell which
 * half committed. Firestore caps a batch at 500 writes, which is far above any
 * plausible manual selection.
 *
 * REQUIRES the `/audit_dismissals` rule in firestore.rules to be DEPLOYED.
 * Without it both the write AND the read fall through to the catch-all
 * `allow read, write: if false`, which is silent in both directions — the
 * dismissal never persists and the collection reads back empty, so the row
 * reappears. That is the single most common cause of "delete does nothing"
 * here; `firebase deploy --only firestore:rules` is the fix.
 */
export async function dismissAuditEvents(events) {
  if (!events?.length) return

  const actor = {
    dismissedBy: auth.currentUser?.uid ?? '',
    dismissedByName: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
  }

  const batch = writeBatch(db)
  events.forEach((event) => {
    batch.set(doc(db, 'audit_dismissals', event.id), {
      ...actor,
      eventCategory: event.category ?? '',
      dismissedAt: serverTimestamp(),
    })
  })
  await batch.commit()
}

/**
 * Turns a Firestore error into something an operator can act on.
 *
 * `permission-denied` is by far the most likely failure here and the least
 * self-explanatory, so it names the actual remedy instead of echoing the SDK's
 * "Missing or insufficient permissions."
 */
export function describeFirestoreError(err, action = 'complete that') {
  if (err?.code === 'permission-denied') {
    return `Permission denied. The audit rules may not be deployed yet — run "firebase deploy --only firestore:rules".`
  }
  if (err?.code === 'unavailable') {
    return 'Cannot reach the database. Check your connection and try again.'
  }
  return err?.message || `Could not ${action}. Please try again.`
}
