import { useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { isTestIdentity } from '@shared/lib/identity'
import { mapShiftDoc } from '@shared/lib/shifts'
import {
  ACCOUNT_STATUS,
  SECURITY_ROLE_VALUES,
  mapSecurityAccount,
} from '@/lib/securityAccounts'

/**
 * The security roster, live: one row per guardhouse credential.
 *
 * ── WHERE "LAST ACTIVE" COMES FROM, AND WHY IT IS NOT A LOGIN TIME ──────────
 * The obvious source is Firebase Auth's `lastSignInTime`, and it is not
 * available: it lives on the UserRecord, which only the Admin SDK can read, and
 * only one user at a time. Reading it for a roster of thirty guards would be
 * thirty server round trips on every render of this page.
 *
 * The next obvious source is a `lastLoginAt` field on `staff_accounts`, written
 * by the guard's own client on sign-in. That is not available either, and for a
 * better reason: `staff_accounts` is `allow update: if false`, so no client can
 * write it — which is the rule that stops a guard editing their own role, and
 * is worth far more than a timestamp.
 *
 * So the column is derived from `guard_shifts`, the clock-in log the guardhouse
 * portal already writes: the most recent `timeOut`, or `timeIn` for a shift
 * still open. That is genuinely "last active" — it is when the officer was last
 * ON POST, which is what an admin auditing the roster actually wants to know,
 * and it is more honest than a sign-in time would be (a guard who opens the
 * portal and does nothing is not active).
 *
 * `lastLoginAt` is still read off the document and wins when present, so the
 * day a server-side login hook starts stamping it — the callable exists in
 * functions/index.js, it is simply not wired to a sign-in yet — this column
 * upgrades itself with no change here. The SQL schema in ../../../../db models
 * it as a real `last_login_at` column for exactly that reason: in a relational
 * deployment the login handler owns that write and the constraint above
 * disappears.
 */
export function useSecurityAccounts() {
  // Server-side role filter rather than a client-side one. The admin console
  // is allowed to read every staff document, but the directory only ever
  // renders guardhouse credentials — pulling the admin rows across the wire to
  // drop them in `useMemo` would put the console's own account list into the
  // page's memory for no purpose. `in` takes up to 30 values; there are two.
  const accountsQuery = useMemo(
    () => query(collection(db, 'staff_accounts'), where('role', 'in', SECURITY_ROLE_VALUES)),
    [],
  )
  const { data: rawAccounts, loading, error } = useLiveCollection(accountsQuery)

  const shiftsQuery = useMemo(() => query(collection(db, 'guard_shifts')), [])
  const { data: rawShifts } = useLiveCollection(shiftsQuery)

  // uid -> { lastActiveAt, onDutySince, shiftsLogged }
  const activityByUid = useMemo(() => {
    const map = new Map()
    rawShifts.forEach((raw) => {
      const shift = mapShiftDoc(raw)
      if (!shift.guardUid) return

      const entry = map.get(shift.guardUid) ?? {
        lastActiveAt: null,
        onDutySince: null,
        shiftsLogged: 0,
      }
      entry.shiftsLogged += 1

      // An open shift means the officer is on post RIGHT NOW, so its timeIn is
      // the most recent activity there can be — it is still accruing.
      const stamp = shift.open ? shift.timeIn : shift.timeOut ?? shift.timeIn
      if (stamp && (!entry.lastActiveAt || stamp > entry.lastActiveAt)) {
        entry.lastActiveAt = stamp
      }
      if (shift.open && shift.timeIn) {
        // Keep the EARLIEST open clock-in. A duplicate open shift (a guard who
        // clocked in twice without clocking out — it happens on a handover)
        // should report the duration they have actually been standing there,
        // not the shorter of the two.
        if (!entry.onDutySince || shift.timeIn < entry.onDutySince) entry.onDutySince = shift.timeIn
      }

      map.set(shift.guardUid, entry)
    })
    return map
  }, [rawShifts])

  const accounts = useMemo(() => {
    return rawAccounts
      .map(mapSecurityAccount)
      // Seeded fixtures are dropped at the top of the pipeline, so they are
      // absent from the table, the search AND the counts below. Filtering
      // further down would leave `guard.test` inflating "Active accounts".
      // The documents are not deleted — see shared/lib/identity.js for why,
      // and for how narrow the match is.
      .filter((account) => !isTestIdentity({ name: account.name, email: account.email }))
      .map((account) => {
        const activity = activityByUid.get(account.uid)
        return {
          ...account,
          shiftsLogged: activity?.shiftsLogged ?? 0,
          onDutySince: activity?.onDutySince ?? null,
          // A revoked credential cannot be on duty whatever the shift log says.
          // The log is history and does not retract itself; the roster is a
          // statement about now.
          onDuty:
            account.status === ACCOUNT_STATUS.active && Boolean(activity?.onDutySince),
          lastActiveAt: account.lastLoginAt ?? activity?.lastActiveAt ?? null,
        }
      })
      .sort((a, b) => {
        // On duty first — that is the answer to "who is on post" and it should
        // not require a sort click. Then by name, so the rest of the table is a
        // directory an operator can scan alphabetically rather than a list in
        // Firestore's document order.
        if (a.onDuty !== b.onDuty) return a.onDuty ? -1 : 1
        return (a.name || a.email).localeCompare(b.name || b.email)
      })
  }, [rawAccounts, activityByUid])

  const counts = useMemo(
    () =>
      accounts.reduce(
        (acc, account) => {
          acc.all += 1
          acc[account.status] = (acc[account.status] ?? 0) + 1
          if (account.onDuty) acc.onDuty += 1
          if (account.mustChangePassword) acc.pendingReset += 1
          return acc
        },
        {
          all: 0,
          onDuty: 0,
          pendingReset: 0,
          [ACCOUNT_STATUS.active]: 0,
          [ACCOUNT_STATUS.suspended]: 0,
          [ACCOUNT_STATUS.revoked]: 0,
        },
      ),
    [accounts],
  )

  return { accounts, counts, loading, error }
}
