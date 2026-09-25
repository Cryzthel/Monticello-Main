import { useMemo, useState } from 'react'
import { Search, UserCheck, UserPlus, Info } from 'lucide-react'
import AppShell from '@/layouts/AppShell'
import { useWaitWhile } from '@/lib/waitState'
import ResidentReviewDrawer from '@/components/ResidentReviewDrawer'
import Card from '@shared/components/Card'
import ResidentAvatar from '@/components/ResidentAvatar'
import RowActionMenu from '@shared/components/RowActionMenu'
import StatusBadge from '@shared/components/StatusBadge'
import SegmentedControl from '@shared/components/SegmentedControl'
import Select from '@shared/components/Select'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import { useResidents } from '@shared/hooks/useResidents'
import {
  residentAddress,
  residentTypeLabel,
  approveResident,
  rejectResident,
  importResidentFromUser,
  RESIDENT_STATUS,
  RESIDENT_STATUS_LABELS,
  RESIDENT_SOURCE,
} from '@shared/lib/residents'

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

const ANY = 'any'

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
  const [search, setSearch] = useState('')
  const [phaseFilter, setPhaseFilter] = useState(ANY)
  const [blockFilter, setBlockFilter] = useState(ANY)
  const [lotFilter, setLotFilter] = useState(ANY)
  const [selectedId, setSelectedId] = useState(null)

  const { residents, counts, profileOnly, loading, error } = useResidents()
  useWaitWhile(loading, 'Syncing the resident directory')
  const [backfilling, setBackfilling] = useState(false)

  async function backfillProfileOnly() {
    setBackfilling(true)
    try {
      await Promise.all(profileOnly.map((r) => importResidentFromUser(r)))
    } catch (err) {
      console.error('Backfill failed', err)
    } finally {
      setBackfilling(false)
    }
  }

  // Options come from the data actually present, so the dropdowns can never
  // offer a Phase/Block/Lot that matches nothing.
  const { phases, blocks, lots } = useMemo(() => {
    const uniq = (key) => [...new Set(residents.map((r) => r[key]).filter(Boolean))].sort()
    return { phases: uniq('phase'), blocks: uniq('block'), lots: uniq('lot') }
  }, [residents])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return residents
      .filter((r) => (tab === ALL ? true : r.status === tab))
      .filter((r) => (phaseFilter === ANY ? true : r.phase === phaseFilter))
      .filter((r) => (blockFilter === ANY ? true : r.block === blockFilter))
      .filter((r) => (lotFilter === ANY ? true : r.lot === lotFilter))
      .filter((r) => {
        if (!term) return true
        return [r.name, r.email, r.phone, residentAddress(r)].join(' ').toLowerCase().includes(term)
      })
      // Newest applications first — that's the queue an admin works down.
      .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))
  }, [residents, tab, search, phaseFilter, blockFilter, lotFilter])

  // Re-derived from the live collection so the drawer reflects an approval
  // the instant onSnapshot echoes it back.
  const selected = residents.find((r) => r.id === selectedId) ?? null

  async function runAction(action) {
    try {
      await action()
    } catch (err) {
      console.error('Resident verification action failed', err)
    }
  }

  return (
    <AppShell
      title="Residents"
      subtitle="Every registered account, live. Verification status is recorded, not required to appear."
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
            <Info className="h-5 w-5 shrink-0 text-info" />
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
              <UserPlus className="h-3.5 w-3.5" />
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

          <div className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-xl border border-hairline bg-base-800 px-4 py-2">
            <Search className="h-4 w-4 shrink-0 text-text-secondary" />
            <input
              type="text"
              className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
              placeholder="Search by name, email, contact, or property"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <Select
            ariaLabel="Filter by phase"
            value={phaseFilter}
            onChange={setPhaseFilter}
            className="min-w-[8.5rem]"
            options={[
              { value: ANY, label: 'All phases' },
              ...phases.map((p) => ({ value: p, label: `Phase ${p}` })),
            ]}
          />
          <Select
            ariaLabel="Filter by block"
            value={blockFilter}
            onChange={setBlockFilter}
            className="min-w-[8.5rem]"
            options={[
              { value: ANY, label: 'All blocks' },
              ...blocks.map((b) => ({ value: b, label: `Block ${b}` })),
            ]}
          />
          <Select
            ariaLabel="Filter by lot"
            value={lotFilter}
            onChange={setLotFilter}
            className="min-w-[8.5rem]"
            options={[
              { value: ANY, label: 'All lots' },
              ...lots.map((l) => ({ value: l, label: `Lot ${l}` })),
            ]}
          />

        </div>

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-auto pb-6">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="table-head">
                  <th className="px-4 py-3 font-medium">Homeowner</th>
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Registered</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
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
                      <UserCheck className="mx-auto mb-2 h-6 w-6 text-text-muted" />
                      <p className="text-sm text-text-secondary">
                        {search || phaseFilter !== ANY || blockFilter !== ANY || lotFilter !== ANY
                          ? 'No registrations match these filters.'
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
                        {resident.createdAt ? new Date(resident.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-right" onClick={(event) => event.stopPropagation()}>
                        <RowActionMenu
                          onView={() => setSelectedId(resident.id)}
                          onDispatch={() => runAction(() => approveResident(resident))}
                          onResolve={() => runAction(() => rejectResident(resident, ''))}
                          dispatchLabel="Approve"
                          resolveLabel="Reject"
                          dispatchDisabled={resident.status === RESIDENT_STATUS.verified}
                          resolveDisabled={resident.status === RESIDENT_STATUS.rejected}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <ResidentReviewDrawer resident={selected} onClose={() => setSelectedId(null)} />
    </AppShell>
  )
}
