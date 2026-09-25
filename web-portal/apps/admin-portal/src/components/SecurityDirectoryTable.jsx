import {
  BadgeAlert,
  KeyRound,
  PauseCircle,
  PlayCircle,
  ShieldOff,
  SquarePen,
  UserX,
} from 'lucide-react'
import Card from '@shared/components/Card'
import StatusBadge from '@shared/components/StatusBadge'
import OverflowMenu from '@shared/components/OverflowMenu'
import Tooltip from '@shared/components/Tooltip'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import ResidentAvatar from '@/components/ResidentAvatar'
import { relativeTime } from '@shared/lib/notifications'
import {
  ACCESS_ROLE_LABELS,
  ACCOUNT_STATUS,
  SHIFT_BY_VALUE,
  STATUS_LABELS,
  STATUS_TONES,
  postLabel,
  resolveAccessRole,
  shiftLabel,
} from '@/lib/securityAccounts'

/**
 * The security personnel directory.
 *
 * ── COLUMN ORDER IS THE ANSWER ORDER ────────────────────────────────────────
 * Identity, then credential, then posting, then state, then recency. That is
 * the order the three questions an admin opens this page with resolve in —
 * "who is this", "are they active", "when were they last on post" — and it is
 * why Status sits fourth rather than first despite being the most colourful
 * column. A status pill in column one is read before the name it belongs to.
 *
 * ── EVERY ROW STAYS ON ONE LINE ─────────────────────────────────────────────
 * A directory is scanned DOWN its columns, so a table whose row heights vary
 * with the roster stops being scannable at exactly the point it gets long
 * enough to need scanning. Three things hold that line, and all three were
 * found by measuring rather than by reading:
 *
 *   • Access role is ONE badge. It was a role badge plus a variable-length row
 *     of duty chips, which is what made this the tallest cell in the table.
 *   • The badge number and the "Reset pending" marker are `whitespace-nowrap`;
 *     both were breaking mid-token at 1100px.
 *   • Below `min-w-[64rem]` the panel scrolls sideways instead of compressing.
 */

function LastActiveCell({ account }) {
  if (account.onDuty && account.onDutySince) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-success">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-success" />
        On duty now
      </span>
    )
  }
  if (!account.lastActiveAt) {
    // Not "Never" — an account provisioned an hour ago has not failed to do
    // anything. The distinction matters when the column is being used to find
    // dormant credentials to revoke.
    return <span className="whitespace-nowrap text-xs text-text-muted">No shifts logged</span>
  }
  return (
    <Tooltip side="left" label={account.lastActiveAt.toLocaleString()}>
      <span className="whitespace-nowrap text-xs text-text-secondary">
        {relativeTime(account.lastActiveAt)}
      </span>
    </Tooltip>
  )
}


/**
 * Replaced a local copy of this markup, which was one of four near-identical
 * hand-rolled versions across the two portals — this one at `bg-tint/10`,
 * the resident table at the same, the audit log at a third weight. The lead
 * column is the shared identity block; the rest are plain bars.
 */
function SkeletonRows({ columns, rows = 5 }) {
  return (
    <SkeletonTableRows
      rows={rows}
      columns={[
        { identity: true },
        ...Array.from({ length: columns - 1 }, () => ({ width: "w-20" })),
      ]}
    />
  )
}

export default function SecurityDirectoryTable({
  accounts,
  loading,
  error,
  filtered,
  onEdit,
  onReset,
  onStatusChange,
  onDelete,
}) {
  const COLUMNS = 7

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      {/* `overflow-x-auto`, not just `-y`. The seven columns have a real
          min-content width, and below roughly 1100px it exceeds the panel:
          measured at 1100px the table wanted 1061px inside a 1050px container.
          The Card is `overflow-hidden` for its corner radius, so without this
          those 11 pixels were not scrolled — they were SILENTLY CLIPPED, and
          what got clipped was the right-hand edge of the actions column. A
          table that quietly amputates its own controls at a common laptop
          width is worse than one that scrolls. */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-auto pb-6">
        <table className="w-full min-w-[64rem] text-left text-sm">
          {/* PROPORTIONAL HINTS, not hard widths — `table-layout` is `auto`, so
              a column whose content cannot fit will still take what it needs.
              What these buy is a STABLE proportion: without them the Officer
              column collapses the moment one badge number is long, and every
              column re-measures each time the live query echoes a change, so
              the table visibly twitches while an admin is reading it.

              `min-w-[64rem]` is the other half. It is the width below which the
              columns stop fitting at all; past that point the panel scrolls
              horizontally instead of squeezing text into two-line cells and
              breaking the row rhythm the fixed heights above exist to keep. */}
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[9%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="table-head">
              <th className="px-4 py-3 font-medium">Officer</th>
              <th className="px-4 py-3 font-medium">Badge</th>
              <th className="px-4 py-3 font-medium">Access role</th>
              <th className="px-4 py-3 font-medium">Assignment</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last active</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={COLUMNS} className="px-4 py-12 text-center">
                  <p className="text-sm font-medium text-danger">
                    Could not load the security directory.
                  </p>
                  {/* Surfacing the code matters: a permission-denied points at
                      firestore.rules (staff_accounts read requires
                      isAdminStaff), not at the query. */}
                  <p className="mt-1 text-xs text-text-secondary">
                    {error.code ? `Firestore error: ${error.code}` : error.message}
                  </p>
                </td>
              </tr>
            ) : loading ? (
              <SkeletonRows columns={COLUMNS} />
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS} className="px-4 py-14 text-center">
                  <ShieldOff className="mx-auto mb-2 h-6 w-6 text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    {filtered
                      ? 'No accounts match these filters.'
                      : 'No security accounts yet. Provision one to give a guard portal access.'}
                  </p>
                </td>
              </tr>
            ) : (
              accounts.map((account) => {
                const active = account.status === ACCOUNT_STATUS.active
                const revoked = account.status === ACCOUNT_STATUS.revoked

                return (
                  <tr
                    key={account.uid}
                    onClick={() => onEdit?.(account)}
                    // FIXED HEIGHT, not min-height and not padding alone.
                    // Measured at 71 / 75 / 73 / 60px across four rows before
                    // this: a cell with two stacked badges (Active + Reset
                    // pending) is taller than one with a single line, so row
                    // height tracked the DATA. Pinning it makes the rhythm a
                    // property of the table rather than of who happens to hold
                    // three duties.
                    className={`data-row h-[4.5rem] cursor-pointer border-t border-divider ${
                      // A revoked credential is history, not roster. Dimming it
                      // keeps it findable (an admin still needs to see that the
                      // account exists) without it reading as staffing.
                      revoked ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <ResidentAvatar name={account.name || account.email} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text-primary">
                            {account.name || 'Unnamed officer'}
                          </p>
                          <p className="truncate text-xs text-text-secondary">
                            {account.email || '—'}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <span className="whitespace-nowrap font-mono text-xs text-text-secondary">
                        {account.badgeNumber || '—'}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      {/* Supervisors carry the warning tone so the one row in a
                          roster that outranks the rest is findable by colour.
                          Derived, not read raw: an account provisioned before
                          `accessRole` existed still resolves from its RBAC role
                          and duties rather than rendering "No role". */}
                      <StatusBadge
                        tone={account.role === 'security_head' ? 'warning' : 'neutral'}
                      >
                        {ACCESS_ROLE_LABELS[resolveAccessRole(account)] ?? 'No role'}
                      </StatusBadge>
                    </td>

                    <td className="px-4 py-3.5">
                      {account.assignedPost || account.shift ? (
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-text-primary">
                            {postLabel(account.assignedPost) || 'Unassigned post'}
                          </p>
                          <p className="truncate text-caption text-text-secondary">
                            {SHIFT_BY_VALUE[account.shift]
                              ? `${SHIFT_BY_VALUE[account.shift].label} · ${SHIFT_BY_VALUE[account.shift].window}`
                              : shiftLabel(account.shift) || 'No shift'}
                          </p>
                        </div>
                      ) : (
                        // Accounts that predate this form have no posting. Say
                        // so rather than printing an em dash — it is an action
                        // item, not a blank.
                        <span className="text-xs text-text-muted">Not rostered</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      {/* ONE LINE, so `flex-nowrap` and an ICON for the
                          secondary marker. As a labelled "Reset pending" chip
                          this cell wrapped to 50px against the other cells'
                          ~36px, which alone made every row holding one 4px
                          taller than its neighbours — the exact data-dependent
                          row height the fixed `h-[4.5rem]` above exists to
                          prevent. The marker is secondary information in a 13%
                          column; the glyph carries it, and the tooltip and
                          `aria-label` carry the words. */}
                      <div className="flex flex-nowrap items-center gap-1.5">
                        <StatusBadge tone={STATUS_TONES[account.status]} dot>
                          {STATUS_LABELS[account.status]}
                        </StatusBadge>
                        {account.mustChangePassword && !revoked ? (
                          <Tooltip
                            side="left"
                            label="Reset pending"
                            hint="A temporary password was issued and has not been replaced."
                          >
                            <span
                              role="img"
                              aria-label="Reset pending: a temporary password was issued and has not been replaced."
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info ring-1 ring-inset ring-info/25"
                            >
                              <BadgeAlert className="h-3 w-3" />
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <LastActiveCell account={account} />
                    </td>

                    <td className="px-4 py-3.5" onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Reset is the one action promoted out of the overflow
                            menu. It is what this page is opened for more than
                            anything else — a guard who cannot sign in at the
                            start of a shift — and burying the fix two clicks
                            deep costs minutes at the exact moment they matter. */}
                        {/* ICON-ONLY, AND THAT WAS A MEASUREMENT, NOT A TASTE
                            CALL. With the label the row's min-content width was
                            1079px against a 1050px panel at a 1100px viewport,
                            so the actions cell — including this very button —
                            started off-screen behind a horizontal scroll on a
                            normal laptop. Dropping the word buys ~55px and
                            brings the table inside its container.

                            The accessible name is on `aria-label`, so this is
                            not a loss for a screen reader, and the tooltip
                            carries it for everyone else. */}
                        <Tooltip side="left" label="Reset password">
                          <button
                            type="button"
                            onClick={() => onReset?.(account)}
                            disabled={revoked}
                            aria-label={`Reset password for ${account.name || account.email}`}
                            className="btn btn-icon-sm btn-outline"
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <OverflowMenu
                          ariaLabel={`Actions for ${account.name || account.email}`}
                          items={[
                            {
                              label: 'Edit assignment',
                              icon: SquarePen,
                              onSelect: () => onEdit?.(account),
                            },
                            active
                              ? {
                                  label: 'Suspend access',
                                  icon: PauseCircle,
                                  onSelect: () =>
                                    onStatusChange?.(account, ACCOUNT_STATUS.suspended),
                                }
                              : {
                                  label: 'Reactivate access',
                                  icon: PlayCircle,
                                  onSelect: () => onStatusChange?.(account, ACCOUNT_STATUS.active),
                                },
                            ...(revoked
                              ? []
                              : [
                                  {
                                    label: 'Revoke access',
                                    icon: ShieldOff,
                                    tone: 'danger',
                                    onSelect: () =>
                                      onStatusChange?.(account, ACCOUNT_STATUS.revoked),
                                  },
                                ]),
                            {
                              label: 'Delete account',
                              icon: UserX,
                              tone: 'danger',
                              onSelect: () => onDelete?.(account),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
