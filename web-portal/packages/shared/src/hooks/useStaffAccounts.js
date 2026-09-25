import { useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'

/**
 * The set of uids belonging to staff accounts, live.
 *
 * ── WHY A SET OF IDS AND NOT THE DOCUMENTS ─────────────────────────────────
 * Every caller so far asks the same question — "was this report filed by an
 * officer rather than a resident?" — and an incident answers it only by
 * association: `reporterUid` is a staff uid. There is no flag on the incident
 * saying so, and adding one would only mark reports filed after the change,
 * leaving the entire existing backlog looking resident-filed.
 *
 * `AdminSecurityReportsPage` already performs exactly this join inline. This
 * hook is that join, named, so the definition of "an officer's formal report"
 * lives in one place rather than being re-derived per page.
 */
export function useStaffAccounts() {
  const staffQuery = useMemo(() => query(collection(db, 'staff_accounts')), [])
  const { data, loading } = useLiveCollection(staffQuery)

  const staffIds = useMemo(() => new Set(data.map((member) => member.id)), [data])

  return { staffIds, loading }
}

// Re-exported for callers that want the hook and the predicate together.
// The predicate itself is pure and lives in lib/staffFiling.js so components
// can use it without importing this module's Firebase dependencies.
export { isOfficerFiled } from '@shared/lib/staffFiling'
