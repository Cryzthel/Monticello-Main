import { useEffect, useMemo, useRef, useState } from 'react'
import { subscribeWithRetry } from '@shared/lib/liveSubscribe'
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
  deviceId,
  publishTelemetry,
  getLastFix,
  onLocationGranted,
  readBattery,
  rememberFix,
} from '@/lib/guardTelemetry'
import { getSettings } from '@shared/lib/systemSettingsStore'
import { isUsableFix } from '@shared/lib/geolocation'
import { shouldDeferPublish } from '@/lib/bestFix'

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
 * Consecutive geolocation failures before the officer is told there is no fix.
 *
 * Two, not one. The watch carries a 30-second timeout, so this is a full
 * minute of trying — long enough that the condition is real, short enough to
 * reach somebody who has walked indoors and needs to know they have gone
 * invisible to dispatch.
 */
const ERROR_GRACE = 2

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
  /**
   * The last position THIS DEVICE saw, published to the rest of the console.
   *
   * ── WHY THE OFFICER'S OWN CONSOLE SHOULD NOT ASK FIRESTORE WHERE IT IS ──
   * The dispatch route used to take its origin only from `guard_telemetry`,
   * which meant the officer's own browser — which has the fix in hand —
   * learned its position by writing it to a server and reading it back. That
   * round trip has a lot of ways to not complete, and every one of them
   * surfaced to the officer as the same sentence about GPS being off: the
   * write is throttled, it needs an open shift document, it needs `onDuty`
   * true on the telemetry doc, the reader drops a fix older than fifteen
   * minutes, and the whole path needs rules to allow both ends. None of that
   * is wrong for a DISPATCHER watching somebody else. All of it is pointless
   * latency and failure surface for the officer who is standing there.
   *
   * So the fix is now also handed straight out. It never leaves the device by
   * this path — it is the same value already being published, offered locally
   * so the console can route from itself the moment it has a position.
   *
   * Updated on the SEND cadence rather than on every callback: an active
   * watch fires several times a second, and this provider sits above the
   * router, so setting state per callback would re-render the whole console
   * to move a number nothing reads that often.
   */
  const [fix, setFix] = useState(null)

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
      (incident) =>
        // A deleted call is not one this officer is still on, so it must not
        // hold the GPS in high-precision mode.
        !incident.deletedAt &&
        incident.assignedGuardUid === uid &&
        isActiveStage(deriveDispatchStage(incident)),
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

  /**
   * ── WHAT THE OFFICER'S OTHER DEVICE IS PUBLISHING ─────────────────────────
   * The officer's own telemetry document, live, so this device can see when
   * their PHONE is already publishing a better position and stop overwriting
   * it with a laptop's Wi-Fi estimate (see shouldDeferPublish). `deferring` is
   * surfaced so the dispatch map can say where the position is coming from.
   */
  const remoteRef = useRef(null)
  const [deferring, setDeferring] = useState(false)
  useEffect(() => {
    if (!uid) return undefined
    return subscribeWithRetry(
      doc(db, 'guard_telemetry', uid),
      (snap) => {
        const data = snap.data()
        const position = data?.position ?? null
        const capturedAt = position?.capturedAt?.toMillis?.() ?? position?.capturedAt
        remoteRef.current = data
          ? {
              position: position ? { ...position, capturedAt } : null,
              deviceId: data.device?.deviceId ?? null,
              mobile: Boolean(data.device?.mobile),
            }
          : null
      },
      // A read failure only means this device cannot see the other one: it
      // then publishes as it always did, which is the safe direction.
      () => {
        remoteRef.current = null
      },
    )
  }, [uid])
  /**
   * Has this device ever produced a fix in this session?
   *
   * Session-scoped on purpose, and never reset by an error. It is the answer
   * to "did the officer allow this", and that question has been settled the
   * moment one position arrives — a reload asks it again, which is right,
   * because a reload is also when the permission could genuinely have changed.
   */
  const grantedRef = useRef(false)
  /** Consecutive geolocation failures with no fix in between. */
  const errorsRef = useRef(0)
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

  /**
   * Bumped to restart the watch below once location is granted.
   *
   * A `watchPosition` that has failed with PERMISSION_DENIED never recovers,
   * even after the officer allows location, so the console used to sit at
   * "no fix" — and the route, and Start navigation with it, never came —
   * until a reload. Restarted when the Permissions API reports the grant, or
   * when the Allow-location button gets a position.
   */
  const [watchEpoch, setWatchEpoch] = useState(0)
  useEffect(() => {
    if (!uid || mode === 'off') return undefined
    const restart = () => {
      const last = getLastFix()
      if (last) setFix(last)
      if (!grantedRef.current || stateRef.current.locationError) setWatchEpoch((n) => n + 1)
    }
    const stopListening = onLocationGranted(restart)
    let status = null
    let cancelled = false
    const onChange = () => {
      if (status?.state === 'granted') restart()
    }
    globalThis.navigator?.permissions
      ?.query({ name: 'geolocation' })
      .then((result) => {
        if (cancelled) return
        status = result
        result.addEventListener('change', onChange)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      stopListening()
      status?.removeEventListener('change', onChange)
    }
  }, [uid, mode])

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
      // Local first, and regardless of whether the write below lands.
      if (fix) setFix(fix)
      // Another of this officer's devices (their phone) is publishing a
      // better, fresh fix: writing ours would replace it in the shared
      // document. Stand aside until that fix goes stale.
      const defer = shouldDeferPublish(remoteRef.current, fix, deviceId())
      setDeferring(defer)
      if (defer) return
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

    // Idle with sharing off still WATCHES — `send` publishes no position while
    // `sharing` is false, so the dispatcher sees only that the officer is on
    // duty. The fix stays on this device, where the console needs it: without
    // it a call dispatched to this officer had no origin to route from, and
    // Start navigation stayed disabled until they pressed Accept & go.

    const geolocation = globalThis.navigator?.geolocation
    if (!geolocation) {
      setLocationError('no-geolocation')
      send(null)
      return undefined
    }

    const onPosition = (position) => {
      // A fix proves the permission was granted. Latched for the session so a
      // later error can never be reported as a denial — see `onError`.
      grantedRef.current = true

      /**
       * ── A READING THAT IS NOT A POSITION IS NOT A POSITION ───────────────
       *
       * The browser hands us the accuracy radius it achieved, and nothing used
       * to read it on this path: whatever arrived was recorded, published, and
       * drawn on the dispatch map as a dot. A laptop answering from its IP
       * address reports thousands of metres, so the officer appeared at their
       * ISP's exchange — confidently, with no mark to say otherwise, because
       * the `approximate` flag this would have raised is no longer rendered
       * anywhere.
       *
       * Raising `enableHighAccuracy` above stops most of those being produced.
       * This is the second half, and it is the half that holds when the first
       * cannot: a laptop with Wi-Fi switched off, a desktop with no radio at
       * all, a VPN moving the IP to another country. High accuracy is a
       * REQUEST, and the provider is free to answer it badly.
       *
       * Discarded, not downgraded. It does not touch `rememberFix`, so
       * `getLastFix()` — which the navigation camera centres on — never holds
       * one of these either. The officer is then in the console's existing
       * "no GPS fix yet" state, which says what is wrong and what to do about
       * it, rather than in a wrong place that nothing can detect.
       *
       * `errorsRef` is deliberately NOT reset and the error notice is
       * deliberately NOT cleared before this check: a stream of coarse
       * readings is the device failing to locate itself, and treating each one
       * as a success would hold the console at "locating…" forever while
       * telling the officer everything was fine.
       */
      if (!isUsableFix(position.coords)) {
        if (errorsRef.current < ERROR_GRACE) errorsRef.current += 1
        else setLocationError('no-fix')
        return
      }

      setLocationError(null)
      errorsRef.current = 0
      const fix = rememberFix(position)
      const last = lastSentRef.current
      const elapsed = Date.now() - last.at
      const moved = last.fix ? distanceMeters([last.fix.lng, last.fix.lat], [fix.lng, fix.lat]) : Infinity
      if (elapsed >= cadence.heartbeatMs || (elapsed >= cadence.minMs && moved >= cadence.moveM)) send(fix)
    }
    /**
     * ── A SINGLE ERROR IS NOT A VERDICT ──────────────────────────────────
     *
     * This used to set `locationError` on the first callback and publish it,
     * which put two false statements on screen.
     *
     * "LOCATION IS BLOCKED" AFTER THE OFFICER ALLOWED IT. `watchPosition`
     * reports PERMISSION_DENIED (code 1) in more situations than the name
     * suggests — iOS raises it when the device's system Location Services
     * switch is off even though the SITE is allowed, and both Chrome and
     * Safari can emit one during the prompt race on a reload. Once a fix has
     * arrived, this browser has granted the permission, and no later error
     * can retract that. So after the first successful position a code 1 is
     * reported as "no fix", which is what it actually is.
     *
     * "NO GPS FIX" FOR A SINGLE TIMEOUT. The watch is armed with a 30-second
     * timeout and a phone that walks under a carport trips it routinely. One
     * timeout is weather; the banner it raised cleared itself on the next
     * reading, having told an officer mid-shift that dispatch could not see
     * them. Two consecutive failures with no fix in between is a condition.
     *
     * The device document still carries whatever is being reported, so a
     * dispatcher's unit list and the officer's own banner never disagree.
     */
    const onError = (err) => {
      errorsRef.current += 1
      const denied = err?.code === 1 && !grantedRef.current
      /**
       * ── A TIMEOUT BEFORE THE FIRST FIX IS NOT A FAILURE ─────────────────
       *
       * `TIMEOUT` (code 3) says the browser did not answer within the budget,
       * which at a 10s budget is the ordinary shape of a COLD high-accuracy
       * lock: a GPS chip waking with no almanac, or a laptop enumerating
       * access points, routinely needs longer. `watchPosition` keeps running
       * after one — the watch is not cancelled — so the honest reading of an
       * early timeout is "still acquiring", not "no GPS fix".
       *
       * Without this, two of them inside twenty seconds would put "no GPS
       * fix" in front of every officer on every load, on hardware that was
       * about to succeed. That is the failure mode that made the 30s budget
       * look necessary; handling the error properly is what lets the budget
       * be the 10s the brief asks for.
       *
       * It is scoped to BEFORE the first fix only. Once `grantedRef` is
       * latched, this device has proved it can locate itself, and a timeout
       * then means a stream that was working has stopped — which is exactly
       * the thing an officer needs telling about.
       *
       * Nobody is left in the dark while this stays quiet: `useLocationAccess`
       * runs its own grace timer and says "no GPS fix yet" once a device has
       * had long enough, whether or not an error was ever raised.
       */
      const acquiring = err?.code === 3 && !grantedRef.current
      if (denied) {
        setLocationError('location-denied')
      } else if (!acquiring && errorsRef.current >= ERROR_GRACE) {
        setLocationError('no-fix')
      }
      if (Date.now() - lastSentRef.current.at >= cadence.minMs) send(null)
    }

    // The first write of a mode goes out at once, so switching to active is
    // visible on the dispatcher's map within a second, not a heartbeat later.
    lastSentRef.current = { at: 0, fix: lastSentRef.current.fix }
    /**
     * ── HIGH ACCURACY ALWAYS, AND THIS IS THE DESKTOP BUG ───────────────────
     *
     * These options were `enableHighAccuracy: mode === 'active'` and
     * `maximumAge: mode === 'active' ? 0 : 30_000` — so an officer on duty
     * with no committed call was being located in LOW-accuracy mode, and that
     * flag does not mean "slightly less precise". It changes which provider
     * the browser asks.
     *
     * With it false, Chrome skips the Wi-Fi scan and answers from the network
     * location service, which on a laptop means the IP address: a position
     * accurate to the exchange, the city, or the ISP's head office. That is
     * the reported symptom exactly — a laptop placing an officer streets or
     * kilometres from where a phone puts them, with both devices convinced
     * they are right. The phone was in the same low-accuracy mode but has
     * cell and Wi-Fi triangulation to fall back on, so it landed close enough
     * to look correct and hid the cause.
     *
     * With it true, the same laptop scans visible access points and reports
     * tens of metres. The two devices stop disagreeing because they are
     * finally being asked the same question.
     *
     * `maximumAge: 0` for the same reason one layer down: a cached fix is
     * whatever the last caller asked for, and accepting a 30-second-old one
     * meant inheriting a coarse reading taken before this watch started — or
     * one taken by another tab entirely.
     *
     * ── THE 10s BUDGET, AND WHAT HAD TO CHANGE TO MAKE IT SAFE ─────────────
     * On a `watchPosition`, `timeout` is the budget for EACH position, and a
     * cold high-accuracy lock routinely takes 20 seconds or more. This was
     * 30s for that reason, and the reason was really about the ERROR PATH:
     * at 10s the budget expires during a normal cold start, `onError` fires
     * twice, and "no GPS fix" lands on the officer's screen while the
     * hardware was still working.
     *
     * A longer budget papered over that rather than fixing it. The timeout is
     * now the brief's 10s and `onError` distinguishes an early `TIMEOUT` from
     * a real failure instead — see the note there. The shorter budget is
     * genuinely better once the error path is honest: the watch retries
     * sooner, so a device that is one scan away from a lock gets that scan at
     * 10s rather than at 30.
     *
     * The cost is battery: a continuous high-accuracy watch keeps the radio
     * warm. That is the correct trade on a console whose job is saying where
     * its officers are, and the battery level is already published to the
     * dispatcher, so the price is visible rather than hidden.
     */
    const watchId = geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
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
  }, [uid, mode, sharing, watchEpoch])

  return { mode, sharing, locationError, activeIncidentId, fix, deferring }
}
