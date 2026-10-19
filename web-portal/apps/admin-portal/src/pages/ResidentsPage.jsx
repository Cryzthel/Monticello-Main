import { toast } from '@shared/lib/toast'
import { useMemo, useState } from 'react'
import { UserCheck, UserPlus, Info, UserRoundCheck, X } from '@shared/icons'
import AppShell from '@/layouts/AppShell'
import { useWaitWhile } from '@/lib/waitState'
import ResidentVerificationModal from '@/components/ResidentVerificationModal'
import Card from '@shared/components/Card'
import ResidentAvatar from '@/components/ResidentAvatar'
import RowActionMenu from '@shared/components/RowActionMenu'
import StatusBadge from '@shared/components/StatusBadge'
import SegmentedControl from '@shared/components/SegmentedControl'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import { useResidents } from '@shared/hooks/useResidents'
import {
  residentAddress,
  residentTypeLabel,
  approveResident,
  isReviewFinal,
  rejectResident,
  importResidentFromUser,
  RESIDENT_STATUS,
  RESIDENT_STATUS_LABELS,
  RESIDENT_SOURCE,
} from '@shared/lib/residents'
import AddressSearch from '@shared/components/AddressSearch'
import {
  buildAddressIndex,
  matchesAddress,
  parseAddressQuery,
} from '@shared/lib/addressQuery'
import { formatDate } from '@shared/lib/dates'
import DataTable from '@shared/components/DataTable'

// `all` is the default and is deliberately first: the table's job is to show
// every registered account, and the status tabs are a filter on top of that
// rather than a gate in front of it.
const ALL = 'all'

const TABS = [
  { key: ALL, label: 'All residents' },
  { key: RESIDENT_STATUS.pending, label: 'Pending verification' },
  { key: RESIDENT_STATUS.verified, label: 'Verified' },
  { key: RESIDENT_STATUS.rejected, label: 'Rejected' },
]

// Resident statuses reuse the shared badge so "Verified" here is the same
// green as "Resolved" on an incident, and "Pending" the same amber — one
// status colour language across both portals (see StatusControl.jsx).
function ResidentStatusBadge({ status }) {
  return <StatusBadge status={RESIDENT_STATUS_LABELS[status] ?? status} />
}

// Record-keeping metadata, not a gate: the row is already on screen either
// way. This only tells an admin that the account is visible from its profile
// alone, so a review will create the verification record as it saves.
function SourceChip({ source }) {
  if (source !== RESIDENT_SOURCE.profile) return null
  return (
    <span
      title="Visible from the mobile profile — no verification record written yet. Approving or rejecting creates one."
      className="inline-flex shrink-0"
    >
      <StatusBadge tone="info">
        Profile only
      </StatusBadge>
    </span>
  )
}

export default function ResidentsPage() {
  const [tab, setTab] = useState(ALL)
  /*
   * ONE query string, where there used to be four controls.
   *
   * `search` now carries both halves — the address parts and whatever is left
   * over for the person — because lib/addressQuery can tell them apart. The
   * `phaseFilter`/`blockFilter`/`lotFilter` trio is gone with the dropdowns
   * that set them; a URL or a saved view that wants an exact address can put
   * "Phase 2 Block 14 Lot 7" in here and get the same result the three
   * dropdowns gave.
   */
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const { residents, counts, profileOnly, loading, error } = useResidents()
  useWaitWhile(loading, 'Syncing the resident directory')
  const [backfilling, setBackfilling] = useState(false)

  async function backfillProfileOnly() {
    setBackfilling(true)
    const total = profileOnly.length
    await toast.run(() => Promise.all(profileOnly.map((r) => importResidentFromUser(r))), {
      success: `Imported ${total} account${total === 1 ? '' : 's'} into the directory`,
      error: 'Could not import every account',
    })
    setBackfilling(false)
  }

  /*
   * THE ADDRESS INDEX, derived rather than stored.
   *
   * Every distinct Phase/Block/Lot the registered residents actually occupy,
   * with a count of how many sit at each. It is recomputed from the live
   * collection, so it cannot offer an address that matches nothing and cannot
   * fall behind a resident who registered a second ago — the two failure modes
   * of a separately-maintained index.
   *
   * This replaces three `uniq` lists that were independent of each other: the
   * old Block dropdown offered every block in the subdivision whatever phase
   * was selected, so "Phase 1 + Block 14" was a reachable combination that
   * matched nobody. A list of real COMBINATIONS cannot express that.
   */
  const addressIndex = useMemo(() => buildAddressIndex(residents), [residents])

  const parsedQuery = useMemo(() => parseAddressQuery(search), [search])

  const rows = useMemo(() => {
    const { text } = parsedQuery
    return residents
      .filter((r) => (tab === ALL ? true : r.status === tab))
      // The address half is an EXACT match per part, which is what makes
      // "Lot 7" exclude Lot 17. Only the parts actually typed are tested.
      .filter((r) => matchesAddress(r, parsedQuery))
      // Whatever was not an address part is matched against the person. The
      // address is still in the haystack so a pasted "Phase 2 • Block 14"
      // keeps working even though the parser has already consumed it.
      .filter((r) => {
        if (!text) return true
        return [r.name, r.email, r.phone, residentAddress(r)].join(' ').toLowerCase().includes(text)
      })
      // Newest applications first — that's the queue an admin works down.
      .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))
  }, [residents, tab, parsedQuery])

  // Re-derived from the live collection so the drawer reflects an approval
  // the instant onSnapshot echoes it back.
  const selected = residents.find((r) => r.id === selectedId) ?? null

  /*
   * A DECISION IS FINAL, AND IT ROUTES THE ROW.
   *
   * Verified and Rejected are terminal (lib/residents.js, firestore.rules), so
   * only a Pending row carries Approve / Reject at all. Each tab filters the
   * LIVE listener by status, so a decided row leaves the Pending queue and
   * lands under its outcome the moment the write echoes back (from any admin,
   * in any tab), with no refresh. The admin stays where they are, working
   * the queue; the toast offers the jump to where the row went.
   */
  function announceDecision(name, next, description) {
    const label = next === RESIDENT_STATUS.verified ? 'Verified' : 'Rejected'
    const offerJump = tab !== ALL && tab !== next
    toast.success(next === RESIDENT_STATUS.verified ? `${name} is approved` : `${name} was rejected`, {
      description: description ?? `Moved to ${label}.`,
      action: offerJump ? { label: `View ${label}`, onClick: () => setTab(next) } : undefined,
    })
  }

  async function decideFromRow(resident, next) {
    const approving = next === RESIDENT_STATUS.verified
    const ok = await toast.run(() => (approving ? approveResident(resident) : rejectResident(resident, '')), {
      quiet: true,
      error: approving ? 'Could not approve the resident' : 'Could not reject the application',
    })
    if (ok) announceDecision(resident.name, next)
  }

  return (
    <AppShell
      title="Residents"
      scroll={false}
    >
      <div className="flex min-h-0 flex-col gap-4 lg:h-full">
        {/* Informational, not a gate — these accounts are already listed
            below. The count matters because a profile with no verification
            record means that signup's residents/{uid} write never landed,
            and backfilling normalizes the data for anything that queries
            the `residents` collection directly. */}
        {profileOnly.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-info/30 bg-info/[0.07] p-4">
            <Info size="md" className="shrink-0 text-info" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary">
                {profileOnly.length} account{profileOnly.length === 1 ? '' : 's'} visible from their
                mobile profile only
              </p>
              <p className="mt-0.5 text-xs text-text-secondary">
                They are listed below and can be reviewed as normal — approving or rejecting writes
                the missing verification record. Backfill only to normalize the records up front.
              </p>
            </div>
            <button
              type="button"
              disabled={backfilling}
              onClick={backfillProfileOnly}
              className="btn btn-sm btn-outline shrink-0"
            >
              <UserPlus size="sm" />
              {backfilling ? 'Backfilling…' : `Backfill ${profileOnly.length} record${profileOnly.length === 1 ? '' : 's'}`}
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            ariaLabel="Verification status"
            options={TABS.map((t) => ({ value: t.key, label: t.label, count: counts[t.key] ?? 0 }))}
            value={tab}
            onChange={setTab}
          />

          {/* One box for names, emails, phones and addresses. The three
              Phase/Block/Lot dropdowns that used to sit here are gone — see
              AddressSearch for what replaced them and why. */}
          <AddressSearch
            value={search}
            onChange={setSearch}
            index={addressIndex}
            placeholder="Search by name, email, or address — try “Block 14” or “P2 B14 L7”"
            className="min-w-[18rem] flex-1"
          />
        </div>

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <DataTable
            minWidth="52rem"
            scrollClassName="pb-6"
            columns={[
              { header: <>Homeowner</> },
              { header: <>Property</> },
              { header: <>Type</> },
              { header: <>Status</> },
              { header: <>Registered</> },
              {},
            ]}
          >
                {error ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <p className="text-sm font-medium text-danger">Could not load resident registrations.</p>
                      {/* Surfacing the real code matters here: a
                          permission-denied points at firestore.rules, not at
                          the query — the exact confusion that hid this bug. */}
                      <p className="mt-1 text-xs text-text-secondary">
                        {error.code ? `Firestore error: ${error.code}` : error.message}
                      </p>
                    </td>
                  </tr>
                ) : loading ? (
                  // Skeleton rows rather than a bare "Loading…" so the table
                  // doesn't collapse and reflow once data lands. The markup
                  // was a local copy of the same six-column stack the security
                  // directory had; both now come from the shared component, so
                  // the two tables cannot pulse at different greys again.
                  <SkeletonTableRows
                    rows={5}
                    columns={[
                      { identity: true },
                      { width: 'w-40' },
                      { width: 'w-20' },
                      { variant: 'pill', width: 'w-16' },
                      { width: 'w-20' },
                      { empty: true },
                    ]}
                  />
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center">
                      <UserCheck size="lg" className="mx-auto mb-2 text-text-muted" />
                      <p className="text-sm text-text-secondary">
                        {search
                          ? 'No registrations match this search.'
                          : tab === ALL
                            ? 'No accounts have registered yet.'
                            : 'No accounts in this status.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  rows.map((resident) => (
                    <tr
                      key={resident.id}
                      onClick={() => setSelectedId(resident.id)}
                      className="data-row cursor-pointer border-t border-divider"
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <ResidentAvatar name={resident.name} photoUrl={resident.photoUrl} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium text-text-primary">{resident.name}</p>
                              <SourceChip source={resident.source} />
                            </div>
                            <p className="truncate text-xs text-text-secondary">{resident.email || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-text-secondary">{residentAddress(resident)}</td>
                      <td className="px-4 py-3.5 text-text-secondary">
                        {resident.residentType ? residentTypeLabel(resident.residentType) : '—'}
                      </td>
                      <td className="px-4 py-3.5">
                        <ResidentStatusBadge status={resident.status} />
                      </td>
                      <td className="px-4 py-3.5 text-text-secondary">
                        {formatDate(resident.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-right" onClick={(event) => event.stopPropagation()}>
                        <RowActionMenu
                          onView={() => setSelectedId(resident.id)}
                          // A decided row offers View only: RowActionMenu draws
                          // no action whose handler is withheld.
                          onDispatch={isReviewFinal(resident) ? undefined : () => decideFromRow(resident, RESIDENT_STATUS.verified)}
                          onResolve={isReviewFinal(resident) ? undefined : () => decideFromRow(resident, RESIDENT_STATUS.rejected)}
                          dispatchLabel="Approve"
                          resolveLabel="Reject"
                          dispatchIcon={UserRoundCheck}
                          resolveIcon={X}
                          dispatchIconClass="text-success"
                          resolveIconClass="text-danger"
                        />
                      </td>
                    </tr>
                  ))
                )}
          </DataTable>
        </Card>
      </div>

      {/* isOpen follows the LIVE row: if the resident is deleted while the
          modal is open, it closes rather than showing a stale record. */}
      <ResidentVerificationModal
        isOpen={Boolean(selected)}
        resident={selected}
        onClose={() => setSelectedId(null)}
        onDecided={announceDecision}
      />
    </AppShell>
  )
}
