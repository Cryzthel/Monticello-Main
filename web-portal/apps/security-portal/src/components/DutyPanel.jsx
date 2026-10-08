import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, LogIn, Loader2, Map, MapPin, MapPinOff, ShieldCheck } from '@shared/icons'
import SegmentedControl from '@shared/components/SegmentedControl'
import { useNow } from '@shared/hooks/useNow'
import { shiftActivity } from '@shared/lib/shiftActivity'
import { SHIFTS, SHIFT_BY_VALUE, formatElapsed, shiftForTime } from '@shared/lib/shiftTypes'
import ClockOutButton from '@/components/ClockOutButton'
import { formatAccuracy } from '@/lib/shiftFix'
import { useDutyStatus } from '@/hooks/useDutyStatus'
import { ROUTES } from '@/config/portal'

/**
 * Where the shift was opened, stated plainly.
 *
 * A VERIFIED badge and an UNAVAILABLE one, never a silent absence. A panel
 * that simply omits the row when no fix was captured reads as though a
 * position was taken — and the whole point of recording one is that somebody
 * later trusts it. The accuracy radius is shown because "verified" without a
 * number is a claim rather than a measurement: a ±2000 m fix is a cell-tower
 * guess and should not look like a GPS lock.
 */
function LocationBadge({ fix, error }) {
  const verified = Boolean(fix)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        verified ? 'bg-pill-success text-pill-success-fg' : 'bg-pill-warning text-pill-warning-fg'
      }`}
      title={
        verified
          ? `${fix.lat}, ${fix.lng}${fix.source === 'last-known' ? ' (last known position)' : ''}`
          : error || 'No position was recorded for this shift.'
      }
    >
      {verified ? (
        <MapPin size="sm" aria-hidden="true" />
      ) : (
        <MapPinOff size="sm" aria-hidden="true" />
      )}
      {verified ? `GPS verified · ${formatAccuracy(fix)}` : 'Location unavailable'}
    </span>
  )
}

/**
 * The duty panel: one card for the whole timekeeping cycle.
 *
 * ── WHY IT LIVES ON RESPONSE METRICS ───────────────────────────────────────
 * Because this is the only page that renders with `dutyLock={false}`. Every
 * other console page is covered by the lock while an officer is off duty, so
 * a panel on any of them could never show its idle half — the state it most
 * needs to show, since that is the state with a decision in it. The dispatch
 * map was the other candidate and is the wrong one twice over: it is full
 * bleed, so a panel there covers the map it exists to show, and it is locked.
 *
 * ── TWO STATES, ONE CARD ───────────────────────────────────────────────────
 *   off duty   the wall clock, a shift to pick, and the way in
 *   on duty    the shift running, how long it has run, and the ways onward
 *
 * They are one component rather than two because they are one question —
 * "where am I in this shift" — and a card that swaps identity between renders
 * is how a console starts feeling like two consoles.
 *
 * ── THE CLOCK AND THE COUNTER ARE THE SAME TICK ────────────────────────────
 * `useNow(1000)` drives both: off duty it reads the wall clock, on duty it
 * measures from `timeIn`. One interval, and it is the only one on the page
 * finer than the 15s metrics clock — a seconds display that updates every 15
 * seconds is worse than no seconds at all.
 *
 * @param reports  The page's existing incident array. Passed in rather than
 *                 subscribed here: Response Metrics already holds this exact
 *                 list, and a second listener for the same documents would be
 *                 a second answer that can disagree with the first.
 */
export default function DutyPanel({ reports = [] }) {
  const { openShift, busy, error, locationError, toggle } = useDutyStatus()
  const onDuty = Boolean(openShift)

  const [pickedShift, setPickedShift] = useState(() => shiftForTime())

  const now = useNow(1000)

  const activity = useMemo(
    () => (openShift ? shiftActivity(openShift, reports) : null),
    [openShift, reports],
  )

  const current = SHIFT_BY_VALUE[onDuty ? openShift.shift : pickedShift]

  return (
    <section className="rounded-xl border border-hairline bg-base-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary">
            <ShieldCheck size="sm" className="shrink-0 text-brand-400" />
            Duty status
          </h3>
          <p className="mt-1 text-xs text-text-secondary">
            {onDuty
              ? `${current?.label ?? 'Shift'} · ${current?.window ?? ''}`
              : 'Not clocked in. The rest of the console stays locked until you are.'}
          </p>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
            onDuty ? 'bg-pill-success text-pill-success-fg' : 'bg-pill-neutral text-pill-neutral-fg'
          }`}
        >
          {onDuty ? (
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
          ) : (
            <span className="h-2 w-2 rounded-full bg-text-muted" aria-hidden="true" />
          )}
          {onDuty ? 'On duty' : 'Off duty'}
        </span>
      </div>

      {/* ── THE FIGURE ────────────────────────────────────────────────────
          One number, at the size the card is built around. `tabular-nums` is
          what stops the seconds column shoving the label beside it once a
          second; the monospace face is for the digits reading as a readout
          rather than as prose. */}
      <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-1">
        <p
          className="font-mono text-4xl font-semibold leading-none tabular-nums text-text-primary"
          aria-label={onDuty ? 'Time on shift' : 'Current time'}
        >
          {onDuty
            ? formatElapsed(now - openShift.timeIn.getTime())
            : new Date(now).toLocaleTimeString('en-GB', { hour12: false })}
        </p>
        <p className="text-xs text-text-muted">{onDuty ? 'on shift' : 'local time'}</p>
      </div>

      {onDuty ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <LocationBadge fix={openShift.clockInLocation} error={locationError} />
            <span className="text-2xs text-text-muted">captured at clock-in</span>
          </div>

          {activity ? (
            <dl className="mt-5 grid grid-cols-3 gap-2">
              {[
                ['Dispatched', activity.dispatches.length],
                ['Resolved', activity.resolutions.length],
                ['Handled', activity.handled.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-base-800 px-3 py-2 text-center">
                  <dt className="text-2xs font-medium uppercase tracking-wider text-text-muted">
                    {label}
                  </dt>
                  <dd className="mt-0.5 text-lg font-semibold leading-none tabular-nums text-text-primary">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* Quick actions, on duty only. Off duty every one of these lands on
              a page the lock covers, so offering them would be offering a door
              into a locked room. */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link to={ROUTES.report} className="btn btn-compact btn-brand">
              <ClipboardList size="sm" aria-hidden="true" />
              File a report
            </Link>
            <Link to={ROUTES.tickets} className="btn btn-compact btn-outline">
              <ShieldCheck size="sm" aria-hidden="true" />
              Open tickets
            </Link>
            <Link to={ROUTES.dashboard} className="btn btn-compact btn-outline">
              <Map size="sm" aria-hidden="true" />
              Dispatch map
            </Link>
            <ClockOutButton className="btn btn-compact btn-outline ml-auto" />
          </div>
        </>
      ) : (
        <>
          <div className="mt-5">
            <p className="meta-label mb-2">Shift</p>
            <SegmentedControl
              ariaLabel="Shift"
              options={SHIFTS.map((s) => ({
                value: s.value,
                label: s.label.replace(' shift', ''),
                hint: s.window,
              }))}
              value={pickedShift}
              onChange={setPickedShift}
              fullWidth
              disabled={busy}
              idPrefix="duty-panel-shift"
            />
          </div>

          {/* Said BEFORE the button, not after a refusal. An officer whose
              browser will prompt for location deserves to know why it is about
              to, and one who already blocked it deserves to know the shift
              still opens. */}
          <p className="mt-3 inline-flex items-center gap-1.5 text-2xs text-text-muted">
            <MapPin size="sm" aria-hidden="true" className="shrink-0" />
            Your position is recorded with the shift. If location is blocked the shift still
            opens — it is logged without one.
          </p>

          {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}

          <button
            type="button"
            onClick={() => toggle({ shift: pickedShift })}
            disabled={busy}
            className="btn btn-success mt-4 h-11 w-full"
          >
            {busy ? (
              <Loader2 size="sm" className="animate-spin" aria-hidden="true" />
            ) : (
              <LogIn size="sm" aria-hidden="true" />
            )}
            {busy ? 'Clocking in…' : 'Clock in & begin shift'}
          </button>
        </>
      )}
    </section>
  )
}
