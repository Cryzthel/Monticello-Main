import { useEffect, useMemo, useState } from 'react'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import {
  FileClock,
  KeyRound,
  Mail,
  PauseCircle,
  PlayCircle,
  ShieldOff,
  SquarePen,
  UserPlus,
  UserX,
} from '@shared/icons'
import Card from '@shared/components/Card'
import TablePagination from '@shared/components/TablePagination'
import StatusBadge from '@shared/components/StatusBadge'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { relativeTime } from '@shared/lib/notifications'
import { describeFirestoreError } from '@shared/lib/audit'
import { Skeleton } from '@shared/components/Skeleton'
import { formatDateTimeSeconds } from '@shared/lib/dates'

/**
 * The provisioning audit trail — `provisioning_logs`, filtered to security actions.
 *
 * ── WHY THIS IS A REAL COLLECTION AND THE OTHER AUDIT VIEW IS NOT ───────────
 * AdminHistoryPage's audit trail is DERIVED: it reconstructs events from the
 * timestamps already sitting on incidents and announcements, because those
 * records are their own evidence. Account provisioning has no such record. If
 * a credential is issued, suspended and deleted, the only trace left on
 * `staff_accounts` after the delete is an absence — and an absence cannot say
 * who created the account, who revoked it, or when.
 *
 * So these rows are written explicitly, and they are written SERVER-SIDE by the
 * Admin SDK inside the same callable that performs the action. That placement
 * is the whole point:
 *
 *   • A client-written log entry is a log entry the client can decline to
 *     write. The action and its record commit together or not at all.
 *   • `provisioning_logs` grants admins read and create in firestore.rules but
 *     never update or delete, so no session can edit or erase an entry —
 *     including the super_admin whose actions it records. Append-only is what
 *     makes an audit trail worth reading.
 *
 * Read access is `isAdminStaff()`. A guard cannot see the roster's history.
 */

// Icon and tone per action. Resolved from the `action` string rather than
// stored on the document, so the vocabulary can grow server-side without
// old rows losing their glyph — an unknown action falls back to the neutral
// clock rather than rendering nothing.
const ACTION_STYLE = {
  'security.account.created': { icon: UserPlus, tone: 'success', label: 'Provisioned' },
  'security.credential.reset': { icon: KeyRound, tone: 'info', label: 'Credential reset' },
  'security.assignment.updated': { icon: SquarePen, tone: 'neutral', label: 'Assignment' },
  'security.status.suspended': { icon: PauseCircle, tone: 'warning', label: 'Suspended' },
  'security.status.reactivated': { icon: PlayCircle, tone: 'success', label: 'Reactivated' },
  'security.status.revoked': { icon: ShieldOff, tone: 'danger', label: 'Revoked' },
  'security.account.deleted': { icon: UserX, tone: 'danger', label: 'Deleted' },
  // Written by functions/scripts/migrateStaffEmails.cjs, not by a callable:
  // a sign-in email change is an account migration run from a terminal.
  'security.account.email_changed': { icon: Mail, tone: 'info', label: 'Email changed' },
  // A staff member's own change: functions/emailChange.js (code-verified) and
  // the sign-in sync in functions/accountSync.js.
  'staff.email.changed': { icon: Mail, tone: 'info', label: 'Email changed' },
}

const FALLBACK_STYLE = { icon: FileClock, tone: 'neutral', label: 'Event' }

const toDate = (value) => (value?.toDate ? value.toDate() : value ? new Date(value) : null)

export default function SecurityAuditLog() {
  /**
   * `where('category','==','security')` rather than a prefix match on `action`.
   *
   * Firestore has no `startsWith`, so filtering on the `action` string would
   * mean a range query, and a range filter must be the FIRST orderBy — which
   * would sort the log alphabetically by action instead of chronologically. A
   * flat `category` field sidesteps that entirely: an equality filter composes
   * with any sort order.
   *
   * REQUIRES the `provisioning_logs (category ASC, at DESC)` composite index in
   * ../../../../firestore.indexes.json to be DEPLOYED. An equality filter plus
   * an orderBy on a DIFFERENT field is not covered by the automatic
   * single-field indexes; without it the listener fails with
   * `failed-precondition` and this panel shows its error state rather than the
   * log. `firebase deploy --only firestore:indexes` is the fix.
   */
  const logQuery = useMemo(
    () =>
      query(
        collection(db, 'provisioning_logs'),
        where('category', '==', 'security'),
        orderBy('at', 'desc'),
        // The page is a recent-activity view, not an archive. An unbounded
        // listener on an append-only collection grows without limit and is
        // billed per document on every reconnect.
        limit(200),
      ),
    [],
  )
  const { data, loading, error } = useLiveCollection(logQuery)

  const entries = useMemo(
    () => data.map((row) => ({ ...row, at: toDate(row.at) })),
    [data],
  )

  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const totalPages = Math.max(1, Math.ceil(entries.length / rowsPerPage))

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  useEffect(() => {
    setPage(1)
  }, [rowsPerPage])

  const pageEntries = useMemo(() => {
    const start = (Math.min(page, totalPages) - 1) * rowsPerPage
    return entries.slice(start, start + rowsPerPage)
  }, [entries, page, totalPages, rowsPerPage])

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pb-6">
        {error ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-danger">Could not load the provisioning log.</p>
            <p className="mt-1 text-xs text-text-secondary">
              {describeFirestoreError(error, 'load the audit log')}
            </p>
          </div>
        ) : loading ? (
          <div className="divide-y divide-hairline">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`sk-${i}`} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-64" />
                  <Skeleton variant="muted" className="h-2.5 w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <FileClock size="lg" className="mx-auto mb-2 text-text-muted" />
            <p className="text-sm text-text-secondary">No provisioning activity recorded yet.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-text-muted">
              Entries are written by the Cloud Functions that perform each action, so this stays
              empty until an account is created, reset, suspended or revoked.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {pageEntries.map((entry) => {
              const style = ACTION_STYLE[entry.action] ?? FALLBACK_STYLE
              const Icon = style.icon
              return (
                <li key={entry.id} className="flex items-start gap-3 px-4 py-3.5">
                  <span
                    aria-hidden="true"
                    className={`icon-tile icon-tile-sm mt-0.5 ${
                      style.tone === 'danger'
                        ? 'icon-tile-danger'
                        : style.tone === 'warning'
                          ? 'icon-tile-warning'
                          : style.tone === 'info'
                            ? 'icon-tile-info'
                            : style.tone === 'neutral'
                              ? 'icon-tile-neutral'
                              : ''
                    }`}
                  >
                    <Icon size="sm" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* No icon in the badge: the tile beside it already
                          carries the action's glyph, and the row drew it twice. */}
                      <StatusBadge tone={style.tone}>{style.label}</StatusBadge>
                      <p className="min-w-0 text-sm text-text-primary">
                        {/* The summary is composed server-side, in the same
                            function that made the change, so it describes what
                            was actually written rather than what the UI asked
                            for. */}
                        {entry.summary || entry.action}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      by{' '}
                      <span className="font-medium text-text-primary">
                        {entry.actorName || entry.actorUid || 'Unknown admin'}
                      </span>
                      {entry.targetEmail ? (
                        <>
                          {' · '}
                          <span className="font-mono">{entry.targetEmail}</span>
                        </>
                      ) : null}
                    </p>
                  </div>

                  <time
                    dateTime={entry.at ? entry.at.toISOString() : undefined}
                    title={entry.at ? formatDateTimeSeconds(entry.at) : undefined}
                    className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-text-muted"
                  >
                    {relativeTime(entry.at)}
                  </time>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <TablePagination
        page={page}
        rowsPerPage={rowsPerPage}
        totalItems={entries.length}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        itemLabel="log entry"
      />
    </Card>
  )
}
