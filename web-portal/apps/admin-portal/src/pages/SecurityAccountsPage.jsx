import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileClock,
  Search,
  UserPlus,
  Users,
  X,
} from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import Card from '@shared/components/Card'
import Select from '@shared/components/Select'
import SegmentedControl from '@shared/components/SegmentedControl'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { useAuth } from '@shared/auth/AuthContext'
import OnDutyHistoryTable from '@/components/OnDutyHistoryTable'
import SecurityDirectoryTable from '@/components/SecurityDirectoryTable'
import SecurityAuditLog from '@/components/SecurityAuditLog'
import ProvisionAccountModal from '@/components/ProvisionAccountModal'
import ResetCredentialDialog from '@/components/ResetCredentialDialog'
import { useSecurityAccounts } from '@/hooks/useSecurityAccounts'
import {
  ACCOUNT_STATUS,
  ACCESS_ROLES,
  resolveAccessRole,
  STATUS_LABELS,
  deleteSecurityAccount,
  describeCallableError,
  setSecurityAccountStatus,
} from '@/lib/securityAccounts'
import SearchField from '@shared/components/SearchField'

/**
 * Security Account Provisioning & Access Management.
 *
 * ── THREE VIEWS OF ONE ROSTER ───────────────────────────────────────────────
 * Directory (who has a credential and what state is it in), Shift History (when
 * were they actually on post), Provisioning Log (who changed what, and when).
 * They are tabs on one page rather than three nav entries because they answer
 * one another: an admin looking at a dormant account in the Directory reaches
 * for Shift History next, and an admin who finds an unexpected status reaches
 * for the log. Splitting them across the sidebar would put a back-and-forth
 * navigation between two halves of a single question.
 *
 * ── WHO CAN DO WHAT ─────────────────────────────────────────────────────────
 * Both admin roles READ this page. Only `super_admin` can write, and that is
 * enforced by the callables (functions/index.js#requireStaff(…, 'super_admin')),
 * not here. The UI disables the controls anyway, because a button that is going
 * to fail is worse than an absent one — but the disabled attribute is a courtesy
 * and the server is the rule.
 */

const TABS = [
  { key: 'directory', label: 'Personnel directory', icon: Users },
  { key: 'shifts', label: 'Shift history', icon: ClipboardList },
  { key: 'log', label: 'Change log', icon: FileClock },
]

const ANY = 'any'

const STATUS_OPTIONS = [
  { value: ANY, label: 'All statuses' },
  { value: ACCOUNT_STATUS.active, label: STATUS_LABELS[ACCOUNT_STATUS.active] },
  { value: ACCOUNT_STATUS.suspended, label: STATUS_LABELS[ACCOUNT_STATUS.suspended] },
  { value: ACCOUNT_STATUS.revoked, label: STATUS_LABELS[ACCOUNT_STATUS.revoked] },
]

const ROLE_OPTIONS = [
  { value: ANY, label: 'All roles' },
  ...ACCESS_ROLES.map((r) => ({ value: r.value, label: r.label })),
]

// NO SHIFT FILTER. A shift stopped being an account attribute when guards
// began choosing one at clock-in: every credential now carries the same
// placeholder value, so filtering on it would silently return everybody or
// nobody. Which shifts a guard actually worked is a guard_shifts question, and
// the Shift history tab beside this one already answers it.


/**
 * Inline result strip.
 *
 * ── WHY NOT THE SHARED TOAST ────────────────────────────────────────────────
 * `ToastProvider` is available on every page and would have been one line. Its
 * card is `IncidentNotificationToast`, which is incident-shaped all the way
 * down: it renders a priority chip, a category glyph and a Phase/Block/Lot pin
 * beside a map marker. Pushing "Account provisioned" through it produces a card
 * labelled **Medium** with an empty address next to a location pin — a
 * confident statement about severity and place that the event does not have.
 *
 * A shared component is worth reusing when the meaning matches. Here it does
 * not, so this is fifteen lines of its own rather than a misuse of ninety.
 */
function ResultStrip({ feedback, onDismiss }) {
  if (!feedback) return null
  const bad = feedback.tone === 'danger'
  const Icon = bad ? AlertTriangle : CheckCircle2
  return (
    <div
      role="status"
      className={`flex shrink-0 items-start gap-2.5 rounded-xl border p-3 text-sm ${
        bad
          ? 'border-danger/25 bg-danger/10 text-danger'
          : 'border-success/25 bg-success/10 text-success'
      }`}
    >
      <Icon size="sm" className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">{feedback.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 shrink-0 rounded-lg p-1 opacity-70 transition hover:bg-tint/10 hover:opacity-100"
      >
        <X size="sm" />
      </button>
    </div>
  )
}

export default function SecurityAccountsPage() {
  const { role } = useAuth()
  const canProvision = role === 'super_admin'

  const [tab, setTab] = useState('directory')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(ANY)
  const [roleFilter, setRoleFilter] = useState(ANY)

  const [modal, setModal] = useState(null) // { account } | { account: null }
  const [resetting, setResetting] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const { accounts, counts, loading, error } = useSecurityAccounts()

  // Success messages clear themselves; failures do not. An operator who missed
  // "New password issued" loses nothing — the directory already shows the new
  // state. An operator who missed "Permission denied" is left believing the
  // action worked.
  const dismissTimer = useRef(null)
  useEffect(() => () => clearTimeout(dismissTimer.current), [])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return accounts
      .filter((a) => (statusFilter === ANY ? true : a.status === statusFilter))
      // Compared against the DERIVED access role, not the stored RBAC role:
      // "Gate Guard" and "Roving Patrol" are both `security_officer`, so
      // filtering on `a.role` would make those two options select the same set.
      .filter((a) => (roleFilter === ANY ? true : resolveAccessRole(a) === roleFilter))
      .filter((a) => {
        if (!term) return true
        // Badge number is in the haystack because it is what an admin has in
        // hand when a guard calls in — the roster sheet lists badges, not
        // email addresses.
        return [a.name, a.email, a.badgeNumber]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term)
      })
  }, [accounts, search, statusFilter, roleFilter])

  const filtersActive =
    Boolean(search.trim()) || statusFilter !== ANY || roleFilter !== ANY

  // Clicking a tile that is already applied clears it, so the strip is a
  // toggle rather than a one-way trip that needs the Select to undo.
  function filterByStatus(value) {
    setTab('directory')
    setStatusFilter((current) => (current === value ? ANY : value))
  }

  function report(message, tone = 'success') {
    clearTimeout(dismissTimer.current)
    setFeedback({ message, tone })
    if (tone === 'success') {
      dismissTimer.current = setTimeout(() => setFeedback(null), 6000)
    }
  }

  async function runPendingAction() {
    if (!pendingAction) return
    setBusy(true)
    const who = pendingAction.account.name || pendingAction.account.email || 'That account'
    try {
      if (pendingAction.kind === 'delete') {
        await deleteSecurityAccount({ uid: pendingAction.account.uid })
        report(`${who} was removed from the directory. Their shift history is kept.`)
      } else {
        await setSecurityAccountStatus({
          uid: pendingAction.account.uid,
          status: pendingAction.status,
        })
        report(`${who} is now ${STATUS_LABELS[pendingAction.status].toLowerCase()}.`)
      }
      setPendingAction(null)
    } catch (err) {
      console.error('Security account action failed', err)
      // The dialog CLOSES on failure and the reason is left on the page. Holding
      // it open would put the message behind the scrim that raised it, where a
      // permission-denied reads as the button having done nothing at all.
      setPendingAction(null)
      report(describeCallableError(err, 'apply that change'), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const confirmCopy = useMemo(() => {
    if (!pendingAction) return null
    const who = pendingAction.account.name || pendingAction.account.email || 'This officer'

    if (pendingAction.kind === 'delete') {
      return {
        tone: 'danger',
        title: 'Delete this security account?',
        confirmLabel: 'Delete account',
        message: `${who} loses portal access immediately and the directory row is removed. Their shift history and filed reports are kept — those are the record an incident response was judged against.`,
      }
    }
    if (pendingAction.status === ACCOUNT_STATUS.suspended) {
      return {
        tone: 'warning',
        title: 'Suspend this account?',
        confirmLabel: 'Suspend access',
        message: `${who} will be signed out and cannot sign in again until the account is reactivated. Nothing else changes — the badge, roster slot and history stay as they are.`,
      }
    }
    if (pendingAction.status === ACCOUNT_STATUS.revoked) {
      return {
        tone: 'danger',
        title: 'Revoke this account?',
        confirmLabel: 'Revoke access',
        message: `${who} permanently loses portal access. Use this when an officer leaves; use Suspend for a temporary hold, since a revoked account is meant to stay revoked.`,
      }
    }
    return {
      tone: 'success',
      title: 'Reactivate this account?',
      confirmLabel: 'Reactivate',
      message: `${who} regains Guardhouse Portal access with their existing password. If they cannot recall it, issue a new one with Reset afterwards.`,
    }
  }, [pendingAction])

  return (
    <AppShell
      title="Security accounts"
      subtitle="Add guard logins, manage access, and see every change that was made."
      scroll={false}
    >
      <div className="flex min-h-0 flex-col gap-4 lg:h-full">
        {/* ── METRIC / FILTER STRIP ────────────────────────────────────── */}

        {/* ── TABS + PRIMARY ACTION ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="-mx-1 max-w-full overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SegmentedControl
              kind="tabs"
              size="lg"
              ariaLabel="Security account views"
              className="max-w-none"
              options={TABS.map((t) => ({ value: t.key, label: t.label, icon: t.icon }))}
              value={tab}
              onChange={setTab}
            />
          </div>

          <button
            type="button"
            disabled={!canProvision}
            onClick={() => setModal({ account: null })}
            title={
              canProvision
                ? undefined
                : 'Only a Super Admin can add accounts — the server refuses any other role.'
            }
            // `btn-sm`, like every other PRIMARY creation trigger in both portals.
            //
            // This was the only `btn-brand` wearing `btn-compact`. That class is
            // for compact SECONDARY actions — Copy, Test sound, View — and six
            // outline buttons still use it correctly; this one brand button was
            // the outlier. The comment here used to claim it matched "every other
            // action in this workflow", which was the reverse of true: it made the
            // page's one create button shorter than the Create announcement button
            // it is a sibling of, and shorter than the Search field beneath it,
            // because `btn-compact` sizes by padding rather than by a height token.
            className="btn btn-sm btn-brand"
          >
            <UserPlus size="sm" />
            Add account
          </button>
        </div>

        <ResultStrip feedback={feedback} onDismiss={() => setFeedback(null)} />

        {/* ── PANELS ───────────────────────────────────────────────────── */}
        {tab === 'directory' ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <SearchField
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, badge number or email"
                className="min-w-[16rem] flex-1"
              />
              <Select
                ariaLabel="Filter by status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUS_OPTIONS}
                className="min-w-[10rem]"
              />
              <Select
                ariaLabel="Filter by role"
                value={roleFilter}
                onChange={setRoleFilter}
                options={ROLE_OPTIONS}
                className="min-w-[11rem]"
              />
            </div>

            <SecurityDirectoryTable
              accounts={rows}
              loading={loading}
              error={error}
              filtered={filtersActive}
              onEdit={(account) => canProvision && setModal({ account })}
              onReset={(account) => canProvision && setResetting(account)}
              onStatusChange={(account, status) =>
                canProvision && setPendingAction({ kind: 'status', account, status })
              }
              onDelete={(account) =>
                canProvision && setPendingAction({ kind: 'delete', account })
              }
            />
          </>
        ) : tab === 'shifts' ? (
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pb-6">
            <OnDutyHistoryTable />
          </div>
        ) : (
          <SecurityAuditLog />
        )}
      </div>

      <ProvisionAccountModal
        open={Boolean(modal)}
        account={modal?.account ?? null}
        onClose={() => setModal(null)}
        onSaved={({ kind, name }) =>
          report(
            kind === 'created'
              ? `${name} was added. The password is on screen and shown only once.`
              : `${name}'s details were updated.`,
          )
        }
      />

      <ResetCredentialDialog
        open={Boolean(resetting)}
        account={resetting}
        onClose={() => setResetting(null)}
        onDone={({ name }) => report(`A new temporary password was issued for ${name}.`)}
      />

      <ConfirmDialog
        open={Boolean(pendingAction)}
        busy={busy}
        tone={confirmCopy?.tone ?? 'warning'}
        title={confirmCopy?.title ?? ''}
        message={confirmCopy?.message ?? ''}
        confirmLabel={confirmCopy?.confirmLabel ?? 'Confirm'}
        onConfirm={runPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </AppShell>
  )
}
