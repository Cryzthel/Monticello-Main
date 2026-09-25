import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, query, where } from 'firebase/firestore'
import { useAuth } from '@shared/auth/AuthContext'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { deriveDispatchStage, isActiveStage } from '@shared/lib/dispatchStage'
import { useDutyStatus } from '@/hooks/useDutyStatus'
import { loadGuardPrefs, subscribeGuardPrefs } from '@/lib/guardPrefs'
import { distanceMeters } from '@/lib/directions'
import {
  TELEMETRY_CADENCE,
  describeDevice,
  publishTelemetry,
  readBattery,
  rememberFix,
} from '@/lib/guardTelemetry'
import { getSettings } from '@shared/lib/systemSettingsStore'

/** Every call a unit is committed to. Shared with DispatchWatchdog. */
export function activeCallsQuery() {
  return query(
    collection(db, 'incidents'),
    where('dispatchStage', 'in', ['dispatched', 'responding', 'on_site', 'investigating']),
  )
}

/** Stages that switch this device to high-precision GPS. See lib/guardTelemetry.js. */
const HIGH_PRECISION_STAGES = new Set(['responding', 'on_site', 'investigating'])

/**
 * Publishes this officer's position and battery while they are on duty.
 * Mounted once, above the routes, so it keeps running whichever page is open.
 *
 * The officer's active call is read from the incidents booked to them. That
 * lets the device go high-precision the moment they press Acknowledge &
 * Respond and drop back the moment the call is resolved, whether this console
 * or a supervisor's made the change.
 *
 * Returns `{ mode, sharing, locationError, activeIncidentId }`: what this
 * device is doing right now.
 */
export function useGuardTelemetry() {
  const { user, isAuthenticated } = useAuth()
  const uid = isAuthenticated ? user?.uid : null
  const { onDuty, loading: dutyLoading } = useDutyStatus()
  const [shareIdle, setShareIdle] = useState(() => loadGuardPrefs().shareIdleLocation)
  const [locationError, setLocationError] = useState(null)
  const [badgeNumber, setBadgeNumber] = useState('')

  useEffect(() => subscribeGuardPrefs((prefs) => setShareIdle(prefs.shareIdleLocation)), [])

  // The badge lives on the officer's own staff account, which only they and
  // admins may read. Copied onto the telemetry document so the dispatcher's
  // picker can show it without reading anyone's account.
  useEffect(() => {
    if (!uid) return undefined
    let cancelled = false
    getDoc(doc(db, 'staff_accounts', uid))
      .then((snap) => {
        if (!cancelled) setBadgeNumber(String(snap.data()?.badgeNumber ?? ''))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [uid])

  // Every open call, filtered to this officer here rather than in the query.
  // One `in` on one field needs no composite index, the open set is a handful
  // of documents, and it is the same query DispatchWatchdog runs, so the SDK
  // serves both from one listener.
  const openCallsQuery = useMemo(() => (uid ? activeCallsQuery() : null), [uid])
  const { data: openCalls } = useLiveCollection(openCallsQuery)
  const active =
    openCalls.find(
      (incident) => incident.assignedGuardUid === uid && isActiveStage(deriveDispatchStage(incident)),
    ) ?? null
  const activeStage = active ? deriveDispatchStage(active) : null
  const activeIncidentId = active?.id ?? null

  const mode = !uid || !onDuty ? 'off' : HIGH_PRECISION_STAGES.has(activeStage) ? 'active' : 'idle'
  // Idle sharing is the officer's choice. Sharing during a call is not.
  const sharing = mode === 'active' || (mode === 'idle' && shareIdle)

  const identity = useMemo(
    () => ({ name: user?.displayName || user?.email || 'Security officer', badgeNumber }),
    [user?.displayName, user?.email, badgeNumber],
  )

  const lastSentRef = useRef({ at: 0, fix: null })
  const batteryRef = useRef(null)
  const stateRef = useRef({})
  stateRef.current = { uid, mode, sharing, activeIncidentId, identity, locationError }

  // Battery, where the browser reports it. Re-read on every change event so a
  // phone dropping to 15% during a response is visible to the dispatcher.
  useEffect(() => {
    if (!uid) return undefined
    let battery = null
    let cancelled = false
    const refresh = async () => {
      batteryRef.current = await readBattery()
    }
    refresh()
    globalThis.navigator
      ?.getBattery?.()
      .then((b) => {
        if (cancelled) return
        battery = b
        b.addEventListener('levelchange', refresh)
        b.addEventListener('chargingchange', refresh)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      battery?.removeEventListener('levelchange', refresh)
      battery?.removeEventListener('chargingchange', refresh)
    }
  }, [uid])

  // Off duty: say so once, with no position. Guarded so a guard who has never
  // clocked in on this device does not write a document on every sign-in.
  const announcedOffRef = useRef(false)
  useEffect(() => {
    if (!uid || dutyLoading) return
    if (mode !== 'off') {
      announcedOffRef.current = false
      return
    }
    if (announcedOffRef.current) return
    announcedOffRef.current = true
    getDoc(doc(db, 'guard_telemetry', uid))
      .then((snap) => {
        if (snap.exists() && (snap.data().onDuty || snap.data().position)) {
          return publishTelemetry(uid, { ...identity, onDuty: false, mode: 'off', position: null, battery: null })
        }
        return null
      })
      .catch((err) => console.warn('Could not clear unit telemetry', err))
  }, [uid, mode, dutyLoading, identity])

  // On duty: stream the position at the cadence the mode allows.
  useEffect(() => {
    if (!uid || mode === 'off') return undefined
    // The configured interval is the FLOOR between position sends while a
    // unit is active — the mode the dispatch map is actually watching. Idle
    // keeps its own slower cadence on purpose: a parked console pinging every
    // five seconds spends a battery to tell the map nothing changed.
    const base = TELEMETRY_CADENCE[mode]
    const configuredMs = getSettings().guardhouse.telemetryIntervalSeconds * 1000
    const cadence = mode === 'active' ? { ...base, minMs: configuredMs } : base

    const send = (fix) => {
      const state = stateRef.current
      lastSentRef.current = { at: Date.now(), fix }
      publishTelemetry(state.uid, {
        ...state.identity,
        onDuty: true,
        mode: state.mode,
        activeIncidentId: state.activeIncidentId,
        position: state.sharing && fix ? fix : null,
        battery: batteryRef.current,
        device: { ...describeDevice(), locationError: state.locationError },
      }).catch((err) => console.warn('Unit telemetry write failed', err))
    }

    // Idle with sharing off: a heartbeat with no position, so the dispatcher
    // still sees the officer on duty, with their battery.
    if (!sharing) {
      send(null)
      const heartbeat = setInterval(() => send(null), cadence.heartbeatMs)
      return () => clearInterval(heartbeat)
    }

    const geolocation = globalThis.navigator?.geolocation
    if (!geolocation) {
      setLocationError('no-geolocation')
      send(null)
      return undefined
    }

    const onPosition = (position) => {
      setLocationError(null)
      const fix = rememberFix(position)
      const last = lastSentRef.current
      const elapsed = Date.now() - last.at
      const moved = last.fix ? distanceMeters([last.fix.lng, last.fix.lat], [fix.lng, fix.lat]) : Infinity
      if (elapsed >= cadence.heartbeatMs || (elapsed >= cadence.minMs && moved >= cadence.moveM)) send(fix)
    }
    const onError = (err) => {
      const code = err?.code === 1 ? 'location-denied' : 'no-fix'
      setLocationError(code)
      if (Date.now() - lastSentRef.current.at >= cadence.minMs) send(null)
    }

    // The first write of a mode goes out at once, so switching to active is
    // visible on the dispatcher's map within a second, not a heartbeat later.
    lastSentRef.current = { at: 0, fix: lastSentRef.current.fix }
    const watchId = geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: mode === 'active',
      maximumAge: mode === 'active' ? 0 : 30_000,
      timeout: 30_000,
    })
    // watchPosition only fires on movement on some devices. The heartbeat
    // keeps a stationary officer (standing at the scene) from reading as stale.
    const heartbeat = setInterval(() => {
      if (Date.now() - lastSentRef.current.at >= cadence.heartbeatMs) send(lastSentRef.current.fix)
    }, cadence.heartbeatMs / 2)

    return () => {
      geolocation.clearWatch(watchId)
      clearInterval(heartbeat)
    }
  }, [uid, mode, sharing])

  return { mode, sharing, locationError, activeIncidentId }
}
