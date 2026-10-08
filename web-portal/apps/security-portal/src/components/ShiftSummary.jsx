import { useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { useNow } from '@shared/hooks/useNow'
import { db } from '@shared/lib/firebase'
import { mapIncidentDoc } from '@shared/lib/incidents'
import { shiftActivity } from '@shared/lib/shiftActivity'
import { SHIFT_BY_VALUE, formatElapsed } from '@shared/lib/shiftTypes'

/**
 * What this shift came to, shown at the moment of closing it.
 *
 * ── WHY THE EXIT NEEDS A FIGURE AND NOT JUST A PROMPT ──────────────────────
 * The handover dialog already told officers their activity "is recorded
 * automatically", which is true and was the end of it: the guard was asked to
 * write a summary of a shift whose contents they had to remember unaided. The
 * console knows what they dispatched and resolved — `shiftActivity` derives it
 * from the incident documents themselves — so showing it is the difference
 * between "write something" and "check this, then add what it misses".
 *
 * It is also the last honest moment to notice a report left open. Once the
 * shift row closes, it stops being this officer's.
 *
 * ── SUBSCRIBED ONLY WHILE OPEN ─────────────────────────────────────────────
 * `useIncidentFeed` watches the whole `incidents` collection, and this sits
 * behind a control in the top bar on EVERY page. Subscribing there would mean
 * every guard holding an open socket to every incident for their whole shift
 * to populate a panel they see once, on the way out. `useLiveCollection`
 * treats a null query as "do not subscribe", so the query is only built when
 * the dialog is actually open.
 *
 * ── NUMBERS, DERIVED, NOT COUNTED SEPARATELY ───────────────────────────────
 * No parallel tally is kept. A counter incremented on dispatch would be a
 * second source of truth that can drift from the incidents it describes, and
 * the one that drifts is always the one nobody reads until an audit.
 */
export default function ShiftSummary({ shift, open }) {
  // Null until the dialog opens — see the note above.
  const incidentsQuery = useMemo(() => (open ? query(collection(db, 'incidents')) : null), [open])
  const { data, loading } = useLiveCollection(incidentsQuery)

  // One-second tick so the elapsed figure beside the counts stays truthful
  // while the officer is reading it and writing their handover.
  const now = useNow(1000)

  const incidents = useMemo(() => data.map(mapIncidentDoc), [data])
  const activity = useMemo(() => shiftActivity(shift, incidents), [shift, incidents])

  if (!shift?.timeIn) return null

  const elapsed = formatElapsed(now - shift.timeIn.getTime())
  const shiftLabel = SHIFT_BY_VALUE[shift.shift]?.label ?? 'Shift'
  // 24-hour, zero-padded: a guardhouse roster is written that way and a shift
  // that crosses midnight reads wrong with am/pm.
  const clockInAt = shift.timeIn.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  const counts = [
    { key: 'dispatches', label: 'Dispatched', value: activity.dispatches.length },
    { key: 'resolutions', label: 'Resolved', value: activity.resolutions.length },
    { key: 'handled', label: 'Handled', value: activity.handled.length },
  ]

  return (
    <div className="rounded-xl border border-hairline bg-base-800 p-4">
      <div className="flex items-baseline justify-between gap-3">
        {/* Shift name and the time it started. The start time is the one figure
            the brief asked for that was genuinely absent — duration was already
            here and the counts are below.

            CLOCK-OUT TIME IS DELIBERATELY NOT SHOWN. This panel renders inside
            the clock-out CONFIRMATION, which is to say before the guard has
            clocked out. Printing an end time there would be stating a time that
            has not happened yet, and if they cancel, it never does. The end
            time belongs on the admin timesheet, which reads the finished row. */}
        <p className="text-xs font-medium text-text-secondary">
          {shiftLabel}
          <span className="text-text-muted"> · in at </span>
          <span className="font-mono tabular-nums">{clockInAt}</span>
        </p>
        {/* `tabular-nums` so the seconds column cannot shift the label beside
            it once a second. */}
        <p className="font-mono text-sm font-semibold tabular-nums text-text-primary">{elapsed}</p>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {counts.map((item) => (
          <div key={item.key} className="rounded-lg bg-base-900 px-3 py-2 text-center">
            <dt className="text-2xs font-medium uppercase tracking-wider text-text-muted">
              {item.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-text-primary">
              {loading ? '—' : item.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* The loading line stays; the settled one is gone.
          "Derived from the reports themselves — dispatches and resolutions
          stamped with your name inside this shift window" explained the
          provenance of the figures to a guard who is reading their own hours at
          the end of a shift. It answered a question nobody asks at that moment,
          and it was the longest text in a panel of three numbers.

          The loading case is NOT the same thing and is not decoration: three
          zeroes mean "a quiet shift" or "still counting", and only this line
          says which. Once the count lands the numbers speak for themselves. */}
      {loading ? (
        <p className="mt-2.5 text-2xs leading-relaxed text-text-muted">
          Counting what you handled on this shift…
        </p>
      ) : null}
    </div>
  )
}
