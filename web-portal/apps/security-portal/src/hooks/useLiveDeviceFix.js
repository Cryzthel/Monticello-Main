import { useEffect, useState } from 'react'
import { getLastFix, subscribeLastFix } from '@/lib/guardTelemetry'

/**
 * This device's own GPS, at up to one update per `minMs` — for the officer's
 * console while it has a call of its own (2026-10-19).
 *
 * ── WHY NOT `selfFix` ──────────────────────────────────────────────────────
 * The telemetry provider publishes on the SEND cadence (4 s minimum in active
 * mode, longer when the admin interval is set higher), on purpose: it sits
 * above the router and a state change there re-renders the whole console.
 * But the navigating officer's own marker, the step countdown and the
 * arrival geofence all read that value, so they advanced in 4-second jumps
 * while the GPS was reporting every second — the "map lag".
 *
 * This reads the raw stream (`subscribeLastFix`) and re-renders only the
 * page that asked, throttled with a trailing update so the last fix of a
 * burst is never dropped. Nothing is written: publishing keeps its cadence.
 * Disabled, it holds no listener and returns null.
 */
export function useLiveDeviceFix(enabled, minMs = 1000) {
  const [fix, setFix] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setFix(null)
      return undefined
    }
    setFix(getLastFix())
    let lastAt = 0
    let timer = null
    let pending = null
    const flush = () => {
      timer = null
      lastAt = Date.now()
      setFix(pending)
    }
    const stop = subscribeLastFix((next) => {
      pending = next
      const wait = minMs - (Date.now() - lastAt)
      if (wait <= 0) flush()
      else if (!timer) timer = setTimeout(flush, wait)
    })
    return () => {
      stop()
      clearTimeout(timer)
    }
  }, [enabled, minMs])

  return enabled ? fix : null
}
