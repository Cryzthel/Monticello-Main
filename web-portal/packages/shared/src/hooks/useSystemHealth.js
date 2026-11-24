import { useEffect, useRef, useState } from 'react'
import { collection, getDocsFromServer, limit, onSnapshot, query } from 'firebase/firestore'
import { db } from '@shared/lib/firebase'

/**
 * Whether this console is actually receiving live data, and how fast.
 *
 * -- WHY THIS IS MEASURED RATHER THAN ASSERTED ------------------------------
 * A "system health" panel that renders a green dot from a constant is worse
 * than no panel: it is a claim about the one thing an operator cannot check
 * for themselves, and it is right until the moment it matters. Every value
 * here comes from a real observation of the real backend.
 *
 * Two independent signals, because they fail separately:
 *
 *   1. THE LIVE FEED. A metadata-aware `onSnapshot` on a single document.
 *      Firestore sets `snapshot.metadata.fromCache` when it is serving a local
 *      copy because it has lost its connection to the server, so this reports
 *      exactly the condition the dashboards care about — "the numbers on this
 *      screen have stopped updating" — which is invisible otherwise, since a
 *      stale dashboard looks identical to a quiet one.
 *
 *   2. SERVER RESPONSE TIME. `getDocsFromServer` bypasses the cache entirely,
 *      so timing it measures a genuine round trip to Firestore rather than the
 *      speed of local memory. Run once on mount and then on an interval.
 *
 * -- WHAT THIS COSTS -------------------------------------------------------
 * One document read per probe. The probe is capped at one per minute and is
 * SUSPENDED while the tab is hidden — a console left open on a spare monitor
 * overnight should not bill for a health check nobody is reading. Both the
 * interval and the collection are arguments so a caller that needs a cheaper
 * or busier cadence does not have to fork the hook.
 *
 * `state` is the single value a status indicator should switch on:
 *
 *   'live'      receiving server data, round trip within threshold
 *   'degraded'  connected, but the last round trip was slow
 *   'stale'     Firestore is serving from cache — updates have stopped
 *   'offline'   the browser itself reports no network
 *   'error'     the probe was refused (rules, quota, bad config)
 *   'checking'  first probe still in flight
 */

/** Above this, a round trip is reported as degraded rather than healthy. */
export const SLOW_RESPONSE_MS = 1200

export function useSystemHealth({ path = 'incidents', probeIntervalMs = 60000 } = {}) {
  const [health, setHealth] = useState({
    state: 'checking',
    latencyMs: null,
    lastSyncAt: null,
    fromCache: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    error: null,
  })

  // Held in a ref as well as in state so the probe can read the current
  // connection facts without re-subscribing itself every time one changes.
  const facts = useRef({ fromCache: false, online: true, error: null })

  useEffect(() => {
    let cancelled = false

    function publish(patch) {
      if (cancelled) return
      facts.current = { ...facts.current, ...patch }
      setHealth((prev) => {
        const next = { ...prev, ...patch }
        return { ...next, state: resolveState(next) }
      })
    }

    // ── 1. THE LIVE FEED ──────────────────────────────────────────────────
    // `includeMetadataChanges` is what makes this work at all: without it the
    // SDK suppresses the notification that a result set is now coming from
    // cache, since the DATA has not changed — which is precisely the event
    // this listener exists to catch.
    const probeQuery = query(collection(db, path), limit(1))
    const unsubscribe = onSnapshot(
      probeQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const fromCache = snapshot.metadata.fromCache
        publish({
          fromCache,
          error: null,
          // Only a server-confirmed snapshot advances the sync clock. Stamping
          // it on a cached one would make a disconnected console report that it
          // had just synchronised, which is the exact lie this hook exists to
          // prevent.
          ...(fromCache ? {} : { lastSyncAt: new Date() }),
        })
      },
      (error) => {
        console.error('System health listener failed', error)
        publish({ error: error.code ?? 'unavailable' })
      },
    )

    // ── 2. SERVER RESPONSE TIME ───────────────────────────────────────────
    async function probe() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const started = performance.now()
      try {
        await getDocsFromServer(probeQuery)
        // The probe advances the sync clock as well as the latency reading. It
        // has to: the listener only fires when a document changes, so on a
        // quiet estate `lastSyncAt` would age into the red overnight while the
        // connection was perfectly healthy. A completed server read IS
        // confirmation that the console is in touch with the backend.
        publish({
          latencyMs: Math.round(performance.now() - started),
          lastSyncAt: new Date(),
          error: null,
        })
      } catch (error) {
        // A failed server read is itself the signal. It is not logged as an
        // error because the ordinary cause is a network drop, which the panel
        // is about to report in words.
        publish({ latencyMs: null, error: error.code ?? 'unavailable' })
      }
    }

    probe()
    const timer = setInterval(probe, probeIntervalMs)

    // ── 3. THE BROWSER'S OWN VERDICT ──────────────────────────────────────
    // Cheap, instant, and the only signal available before any request has had
    // time to fail. It is not sufficient on its own — `navigator.onLine` is
    // true on a captive-portal wifi that reaches nothing — which is why it sits
    // alongside the two measurements rather than replacing them.
    function handleOnline() {
      publish({ online: true })
      probe()
    }
    function handleOffline() {
      publish({ online: false })
    }

    // Coming back to a tab that was hidden has to re-probe, not wait for the
    // next tick. The probe suspends itself while hidden, so an operator
    // returning to a console parked on another tab for an hour would otherwise
    // read a latency measured an hour ago — and could sit in front of a panel
    // reporting "Slow" from a reading that has since recovered, for up to
    // `probeIntervalMs`. The reading has to be as fresh as the attention on it.
    function handleVisibility() {
      if (document.visibilityState === 'visible') probe()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
      unsubscribe()
    }
  }, [path, probeIntervalMs])

  return health
}

// Ordered worst-first: an offline browser makes every other reading
// meaningless, and a permission failure makes a fast round trip irrelevant.
function resolveState({ online, error, fromCache, latencyMs }) {
  if (!online) return 'offline'
  if (error) return 'error'
  if (fromCache) return 'stale'
  if (latencyMs == null) return 'checking'
  return latencyMs > SLOW_RESPONSE_MS ? 'degraded' : 'live'
}

/**
 * The health object as an operator reads it: a label, a supporting phrase and
 * the tone a status dot should take.
 *
 * Kept beside the measurement rather than in the component so the Overview's
 * summary strip and the System Metrics page's fuller one cannot describe the
 * same reading with two different words.
 */
export function describeHealth(health) {
  switch (health.state) {
    case 'live':
      return { label: 'Connected', tone: 'ok', detail: 'Live updates' }
    case 'degraded':
      return { label: 'Slow', tone: 'warn', detail: 'Above 1.2s' }
    case 'stale':
      return { label: 'Reconnecting', tone: 'bad', detail: 'Serving cached data' }
    case 'offline':
      return { label: 'Offline', tone: 'bad', detail: 'No network' }
    case 'error':
      return { label: 'Unavailable', tone: 'bad', detail: health.error ?? 'Read refused' }
    default:
      return { label: 'Checking…', tone: 'idle', detail: 'Contacting server' }
  }
}

/** Round-trip time as a value + threshold pair for the response indicator. */
export function describeResponse(health) {
  if (health.latencyMs == null) {
    return { value: '—', tone: 'idle', detail: 'No reading' }
  }
  return {
    value: `${health.latencyMs} ms`,
    tone: health.latencyMs > SLOW_RESPONSE_MS ? 'warn' : 'ok',
    detail: `target under ${SLOW_RESPONSE_MS / 1000}s`,
  }
}
