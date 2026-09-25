import { useEffect, useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { isActiveStage } from '@shared/lib/dispatchStage'
import { mapShiftDoc } from '@shared/lib/shifts'
import { distanceMeters } from '@/lib/directions'
import { GPS_ACCURACY_LIMIT_M } from '@/lib/routeOrigin'

/**
 * How old a position may be before the map stops presenting it as live.
 * An idle device writes at least every 2 min (TELEMETRY_CADENCE), so 3 min
 * without a word means it has lost signal, been closed, or run out of battery.
 * A responding device writes every 20 s at worst, so it is held to 1 min.
 */
const STALE_AFTER_MS = { idle: 180_000, active: 60_000 }

/** Past this, the position is not drawn at all. It says where a guard was, not where they are. */
const HIDE_AFTER_MS = 15 * 60_000

/** Unit state by the stage of the call it is booked to. */
const STAGE_TO_UNIT_STATE = {
  dispatched: 'assigned',
  responding: 'responding',
  on_site: 'on_scene',
  investigating: 'on_scene',
}

export const UNIT_STATE_LABELS = {
  available: 'Available',
  assigned: 'Awaiting acknowledgement',
  responding: 'Responding',
  on_scene: 'On scene',
}

const toMillis = (value) => (value?.toMillis ? value.toMillis() : typeof value === 'number' ? value : null)

/**
 * Every on-duty officer as a unit the dispatcher can see and pick.
 *
 * On duty means an open shift in `guard_shifts`, the same record the duty
 * lock and the admin timesheet use. Telemetry without an open shift is
 * ignored: a device left signed in after clocking out is not a unit.
 *
 * The unit's STATE is worked out from the calls, not read from the device. The
 * incident document is the authority on who is booked to what, and the device
 * can be offline at the moment its call changes stage.
 *
 * `incidents` is the dashboard's live list of open calls (mapped docs).
 * `target` is `[lng, lat]` to measure each unit's distance from, or null.
 */
export function useGuardUnits(incidents, target = null) {
  const shiftsQuery = useMemo(() => query(collection(db, 'guard_shifts'), where('timeOut', '==', null)), [])
  const telemetryQuery = useMemo(() => collection(db, 'guard_telemetry'), [])
  const { data: rawShifts, loading: shiftsLoading } = useLiveCollection(shiftsQuery)
  const { data: telemetry } = useLiveCollection(telemetryQuery)

  // Freshness is measured against the clock, so it has to tick without a
  // Firestore event. 5 s is fine enough for "12 s ago" to be honest.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const units = useMemo(() => {
    const byUid = new Map()
    rawShifts.map(mapShiftDoc).forEach((shift) => {
      if (!shift.guardUid) return
      const known = byUid.get(shift.guardUid)
      if (!known || (shift.timeIn && known.timeIn && shift.timeIn > known.timeIn)) byUid.set(shift.guardUid, shift)
    })
    const telemetryByUid = new Map(telemetry.map((t) => [t.id, t]))
    const assignmentByUid = new Map()
    incidents.forEach((incident) => {
      if (incident.assignedGuardUid && isActiveStage(incident.dispatchStage)) {
        assignmentByUid.set(incident.assignedGuardUid, incident)
      }
    })

    return [...byUid.values()].map((shift) => {
      const t = telemetryByUid.get(shift.guardUid)
      const assignment = assignmentByUid.get(shift.guardUid) ?? null
      const state = assignment ? STAGE_TO_UNIT_STATE[assignment.dispatchStage] : 'available'

      const raw = t?.onDuty ? t.position : null
      const fixAt = toMillis(raw?.capturedAt) ?? toMillis(t?.updatedAt)
      const ageMs = raw && fixAt ? Math.max(0, now - fixAt) : null
      const position = raw && ageMs != null && ageMs < HIDE_AFTER_MS ? raw : null
      const staleAfter = t?.mode === 'active' ? STALE_AFTER_MS.active : STALE_AFTER_MS.idle
      const lastSeenMs = toMillis(t?.updatedAt)

      return {
        uid: shift.guardUid,
        name: t?.name || shift.name,
        badgeNumber: t?.badgeNumber ?? '',
        shiftStartedAt: shift.timeIn,
        state,
        assignment,
        position,
        positionAgeMs: position ? ageMs : null,
        stale: position ? ageMs > staleAfter : false,
        approximate: position ? (position.accuracy ?? Infinity) > GPS_ACCURACY_LIMIT_M : false,
        battery: t?.battery ?? null,
        mode: t?.mode ?? 'off',
        locationError: t?.device?.locationError ?? null,
        reporting: Boolean(t?.onDuty),
        lastSeenAgoMs: lastSeenMs ? Math.max(0, now - lastSeenMs) : null,
        distanceM:
          position && target ? Math.round(distanceMeters([position.lng, position.lat], target)) : null,
      }
    })
  }, [rawShifts, telemetry, incidents, target, now])

  return { units, loading: shiftsLoading }
}

/**
 * Units in the order a dispatcher wants to choose from: available first,
 * nearest first, units with no position after units with one.
 */
export function rankUnits(units) {
  const order = { available: 0, assigned: 1, responding: 2, on_scene: 3 }
  return [...units].sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
      a.name.localeCompare(b.name),
  )
}
