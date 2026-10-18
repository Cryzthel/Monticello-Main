import { useMemo, useState } from 'react'
import { Siren, MapPin, Phone, Send, CheckCircle2, Crosshair } from '@shared/icons'
import OverflowMenu from '@shared/components/OverflowMenu'
import Card from '@shared/components/Card'
import StatusBadge from '@shared/components/StatusBadge'
import SegmentedControl from '@shared/components/SegmentedControl'
import { panicSignal } from '@shared/lib/panicStatus'
import { acknowledgedByLabel } from '@shared/lib/panicAlerts'
import { SkeletonTableRows } from '@shared/components/Skeleton'
import { panicSignalIcon } from '@shared/theme/categoryIcons'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'
import { isOutsideBoundary } from '@shared/lib/panicGeofence'
import { MapPinOff } from '@shared/icons'
import SearchField from '@shared/components/SearchField'
import { formatDateTime, formatTime } from '@shared/lib/dates'
import { relativeTime } from '@shared/lib/notifications'
import DataTable from '@shared/components/DataTable'

/*
 * A dot on Live, and only on Live.
 *
 * The label is a node rather than a string so the one filter that describes
 * something HAPPENING carries a live indicator inside the capsule, the way the
 * on-duty badge and the route badge already do. "Resolved" and "All" describe
 * states of the record, not of the world, so they stay plain — a dot on every
 * option would say nothing.
 *
 * `motion-safe:` on the ping only. The solid dot underneath is always painted,
 * so with reduced motion the indicator is still there; it simply stops
 * pulsing, rather than disappearing along with the animation. This is the same
 * pairing RouteSummaryBadge and GuardStatusWidget use.
 *
 * No halo, no glow: a coloured blur around a 6px dot inside a 28px capsule is
 * the decorative kind of emphasis this console does not use. The ping IS the
 * emphasis.
 */
const LiveLabel = () => (
  <span className="inline-flex items-center gap-1.5">
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full rounded-full bg-danger/60 motion-safe:animate-ping" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger" />
    </span>
    Live
  </span>
)

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'live', label: <LiveLabel />, title: 'Alerts still open' },
  { value: 'resolved', label: 'Resolved' },
]

function stamp(date) {
  if (!date) return '—'
  const d = new Date(date)
  return formatDateTime(d)
}

/** "10.76466, 122.51609", or '' without a usable fix. */
function coordinatesOf(alert) {
  return typeof alert.lat === 'number' && typeof alert.lng === 'number'
    ? `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`
    : ''
}

/**
 * ── COLUMN WIDTHS ARE SHARES, NOT LEFTOVERS (2026-10-19) ───────────────────
 * Resident was the only column without a width, so on a wide screen it took
 * every spare pixel and Received sat a thousand pixels away from the name it
 * belongs to. The table is now `table-fixed` with every column given a share,
 * and the space Resident was wasting holds the alert's GPS fix instead.
 */
const COLS = {
  withActions: ['11%', '26%', '16%', '17%', '24%', '6%'],
  withoutActions: ['12%', '28%', '17%', '18%', '25%'],
}

/** Human-quotable alert id, matching how tickets are shortened elsewhere. */
function alertId(id) {
  return `SOS-${String(id ?? '').slice(-6).toUpperCase()}`
}


/**
 * The emergency log — every SOS ever raised, newest first.
 *
 * ── WHY A RECORD AND NOT A QUEUE ──────────────────────────────────────────
 * The dispatch map answers "where do I go now" and deliberately drops an alert
 * the moment it is resolved. This answers the questions asked afterwards: how
 * many did we get, how fast did anyone move, was that one ever closed. So it
 * keeps resolved rows, and its default view is All rather than Live — a log
 * that hides its history is a queue with extra steps.
 *
 * ── REAL TIME, BY CONSTRUCTION ────────────────────────────────────────────
 * There is no refresh control on this table and nothing to poll. `alerts`
 * arrives from `usePanicAlerts`, which is a Firestore `onSnapshot`
 * subscription — a resident pressing SOS, or an officer dispatching, mutates
 * the document and every open console re-renders from the same push. The
 * component is a pure function of that array, so appending a new emergency and
 * moving one to Dispatched are the same code path.
 *
 * @param {(alert: object) => void} [props.onDispatch] Marks the alert as
 *   responded to. Server-side this also pushes to the resident's phone — see
 *   onPanicAlertDispatched in functions/index.js.
 * @param {(alert: object) => void} [props.onResolve] Closes the alert.
 */
export default function PanicAlertsTable({
  alerts = [],
  loading = false,
  error = null,
  onDispatch,
  onResolve,
  // Seeds the search box. The admin Hazard Map's "Open SOS log" links here as
  // `?alert=SOS-XXXXXX`, so the log opens on the alert that was clicked.
  initialQuery = '',
}) {
  const geofenceAlert = useSystemSettings((state) => state.values.sos.geofenceAlert)

  const hasActions = Boolean(onDispatch || onResolve)
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState('all')

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    return alerts.filter((alert) => {
      const signal = panicSignal(alert.status)
      if (filter === 'live' && !signal.live) return false
      if (filter === 'resolved' && signal.live) return false
      if (!term) return true
      return [alert.residentName, alert.address, alertId(alert.id), signal.label]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [alerts, query, filter])

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline p-4">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by resident, address, or alert ID"
          className="min-w-[16rem] flex-1"
        />
        {/* The shared segmented control — now literally the shared component
            rather than a fourth hand-written copy of its markup. */}
        <SegmentedControl
          ariaLabel="Alert status"
          className="shrink-0"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <DataTable
        minWidth="56rem"
        scrollClassName="pb-6"
        tableClassName="table-fixed"
        colgroup={
          <colgroup>
            {(hasActions ? COLS.withActions : COLS.withoutActions).map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
        }
        columns={[
          { header: 'Alert' },
          { header: 'Resident' },
          { header: 'Received' },
          { header: 'Live GPS' },
          { header: 'Signal' },
          { hidden: !hasActions },
        ]}
      >
            {error ? (
              <tr>
                <td colSpan={hasActions ? 6 : 5} className="px-4 py-14 text-center">
                  {/* Surfaced, never swallowed. A denied listener resolves to an
                      empty array with loading:false — indistinguishable from
                      "no emergencies have happened", which is the worst possible
                      reading of an emergency log. */}
                  <p className="text-sm font-medium text-danger">Could not load panic alerts.</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {error.code ? `Firestore error: ${error.code}` : error.message}
                  </p>
                </td>
              </tr>
            ) : loading ? (
              /* Per-column bars, not one `colSpan` bar across the row. The
                 single-bar version could not reserve the four fixed column
                 widths above it, so every cell boundary moved the instant the
                 real rows arrived — the table visibly re-gridded itself, which
                 is the exact shift a skeleton is for. */
              <SkeletonTableRows
                rows={4}
                columns={[
                  { width: 'w-20' },
                  { identity: true },
                  { width: 'w-28', variant: 'muted' },
                  { width: 'w-28', variant: 'muted' },
                  { width: 'w-24' },
                  ...(hasActions ? [{ empty: true, className: 'w-14' }] : []),
                ]}
              />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={hasActions ? 6 : 5} className="px-4 py-16 text-center">
                  <Siren size="lg" className="mx-auto mb-2 text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    {alerts.length === 0
                      ? 'No panic alerts have been raised.'
                      : 'No alerts match this view.'}
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((alert) => {
                const signal = panicSignal(alert.status)
                // Each action is offered only where it is a real transition:
                // an alert already dispatched has nothing to dispatch, and a
                // resolved one has nothing left at all.
                const actions = [
                  onDispatch && alert.status === 'active'
                    ? { label: 'Dispatch', icon: Send, onSelect: () => onDispatch(alert) }
                    : null,
                  onResolve && signal.live
                    ? { label: 'Resolve', icon: CheckCircle2, onSelect: () => onResolve(alert) }
                    : null,
                ].filter(Boolean)
                return (
                  <tr key={alert.id} className="border-t border-divider">
                    <td className="px-4 py-3.5 align-top">
                      <p className="font-mono text-xs font-medium text-text-secondary">{alertId(alert.id)}</p>
                      {/* Every SOS is critical by definition — a resident held a
                          panic button. There is no priority to compute, so the
                          badge states the fact rather than a derived grade. */}
                      <StatusBadge tone="danger" icon={Siren} className="mt-1">
                        Urgent
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3.5 align-top">
                      <p className="truncate font-medium text-text-primary">{alert.residentName}</p>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
                        <MapPin size="sm" className="shrink-0" />
                        <span className="truncate">{alert.address}</span>
                      </p>
                      {/* The number, as a real tel: link. "Call resident" was
                          removed from the map popup, and one-tap dialling is not
                          something to lose from an emergency console — so it
                          lands here, where the rest of the record already is. */}
                      {alert.residentPhone ? (
                        <a
                          href={`tel:${alert.residentPhone}`}
                          className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-brand-400 transition hover:text-brand-300"
                        >
                          <Phone size="sm" className="shrink-0" />
                          {alert.residentPhone}
                        </a>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 align-top">
                      <p className="font-mono text-xs tabular-nums text-text-secondary">{stamp(alert.createdAt)}</p>
                      {alert.createdAt ? (
                        <p className="mt-1 text-2xs text-text-muted">{relativeTime(alert.createdAt)}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 align-top">
                      {coordinatesOf(alert) ? (
                        <p className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-brand-500">
                          <Crosshair size="sm" className="shrink-0 text-text-muted" aria-hidden="true" />
                          <span className="select-all">{coordinatesOf(alert)}</span>
                        </p>
                      ) : (
                        <p className="text-xs text-text-muted">No GPS fix</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 align-top">
                      <StatusBadge tone={signal.tone} icon={panicSignalIcon(alert.status)}>
                        {signal.label}
                      </StatusBadge>
                      {/* Only `outside` earns a badge. `unknown` is common —
                          indoors, a basement, location switched off — and a
                          flag that appears on a third of the rows stops being
                          read within a week. The admin detail view states it
                          for the cases that need chasing. */}
                      {geofenceAlert && isOutsideBoundary(alert) ? (
                        <p className="mt-1">
                          <StatusBadge tone="warning" icon={MapPinOff}>
                            Outside subdivision
                          </StatusBadge>
                        </p>
                      ) : null}
                      {alert.acknowledgedByName ? (
                        <p className="mt-1 truncate text-2xs text-text-muted">
                          by {acknowledgedByLabel(alert.acknowledgedByName)}
                          {alert.acknowledgedAt ? (
                            <span className="font-mono"> · {formatTime(alert.acknowledgedAt)}</span>
                          ) : null}
                        </p>
                      ) : null}
                    </td>
                    {hasActions ? (
                      <td className="px-4 py-3.5 align-top text-right">
                        {/* ── ••• RATHER THAN A ROW OF BUTTONS ───────────────
                            Both actions change an emergency's state, and neither
                            is undoable from here. Behind one deliberate press
                            they cannot be fired while scanning the table.

                            A row with nothing left to do renders NO trigger.
                            OverflowMenu draws its button unconditionally, so an
                            already-resolved alert would otherwise carry a ••• 
                            that opens an empty panel — a control that answers a
                            press with nothing reads as broken. */}
                        {actions.length > 0 ? (
                          <OverflowMenu
                            ariaLabel={`Actions for ${alertId(alert.id)}`}
                            items={actions}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
      </DataTable>
    </Card>
  )
}
