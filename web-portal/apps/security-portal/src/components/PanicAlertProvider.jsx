import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { useAuth } from '@shared/auth/AuthContext'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { mapPanicAlertDoc } from '@shared/lib/panicAlerts'
import { usePanicSiren } from '@/hooks/usePanicSiren'
import { isMuted, setMuted as setDeviceMuted_, subscribeAlertSound } from '@shared/lib/alertSound'
import PanicAlertBeacon from '@/components/PanicAlertBeacon'

/**
 * The portal-wide panic alert channel: one subscription, one siren.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 * Both halves of the SOS signal used to live on the Dispatch Map and nowhere
 * else. `usePanicSiren` was called in DashboardPage, and the alert's only
 * visual was the circle the map draws. That is coherent *while the guard is
 * looking at the map* — see the note in IncidentMap about deliberately having
 * no banner, no pill and no floating card, because the map already says it.
 *
 * It stops being coherent the moment the guard is anywhere else. Four of this
 * portal's surfaces — Incident tickets, File a report, Incident history and
 * Response metrics — render no map and, until this provider, mounted no siren.
 * A resident could press SOS while a guard was three keystrokes into a report
 * and nothing whatsoever would happen on their screen.
 *
 * So this does not reverse the map's decision; it covers the case that
 * decision left open. The visual half now lives in `SidebarSOSAlertsFeed`, a column
 * beside the dispatch map; the floating banner that used to sit over every
 * page is gone.
 *
 * ── IT MOVES A LISTENER RATHER THAN ADDING ONE ─────────────────────────────
 * DashboardPage used to open this exact query itself. Mounting a second
 * `onSnapshot` on the same query here would be precisely what usePanicAlerts
 * warns against: a duplicate listener, a duplicate read bill, and a second
 * source of truth that can disagree with the map about which alerts exist.
 * The subscription therefore LIVES here and the page consumes it through
 * `useLivePanicAlerts`, so the rail, the siren and the map nodes are all
 * reading one array by construction.
 *
 * ── WHY THE LIVE FILTER, NOT `usePanicAlerts` ──────────────────────────────
 * `@shared/hooks/usePanicAlerts` is deliberately unfiltered because it backs
 * the SOS *record* page. An alarm must not ring for history, so this keeps the
 * map's `status in ('active','acknowledged')` filter — the set of emergencies
 * that still need somebody.
 */
// Exported as a test seam, like `AuthContext`: a harness can hand the feed
// fixture alerts without a Firestore session.
export const PanicAlertContext = createContext(null)

/**
 * The live panic alerts, shared.
 *
 * Returns `{ alerts, loading }`. Throws rather than returning a silent empty
 * array when the provider is missing: a screen that believes there are no
 * emergencies because it was mounted outside the provider is the exact failure
 * this component exists to prevent, and it must not be quiet.
 */
export function useLivePanicAlerts() {
  const value = useContext(PanicAlertContext)
  if (!value) {
    throw new Error('useLivePanicAlerts must be used inside <PanicAlertProvider>')
  }
  return value
}

export default function PanicAlertProvider({ children }) {
  const { isAuthenticated } = useAuth()

  // ── THE QUERY IS GATED ON AUTH, AND BEING "INSIDE AuthProvider" IS NOT ────
  // Sitting under AuthProvider does NOT keep this closed on the login screen.
  // AuthProvider renders `{children}` unconditionally, and the `/login` route
  // is registered OUTSIDE RequireAuth, so this component mounts for a
  // signed-out visitor. firestore.rules gates `panic_alerts` reads behind
  // isStaff(), so an ungated subscription here is a guaranteed
  // permission-denied on the login form — an error thrown by the alarm system
  // at the one moment nobody is watching it.
  //
  // `useLiveCollection` treats a null query as "do not subscribe", which is
  // also why this is a null rather than an `enabled` flag. The null path keeps
  // `loading` true, so `ready` stays false and the siren stays UNPRIMED while
  // signed out — then primes silently on the first real snapshot after
  // sign-in, exactly as panicSirenStep requires.
  const panicQuery = useMemo(
    () =>
      isAuthenticated
        ? query(collection(db, 'panic_alerts'), where('status', 'in', ['active', 'acknowledged']))
        : null,
    [isAuthenticated],
  )
  const { data: raw, loading } = useLiveCollection(panicQuery)

  const alerts = useMemo(
    () =>
      raw
        .map(mapPanicAlertDoc)
        .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0)),
    [raw],
  )

  // The siren, now mounted once for the whole portal instead of once on the
  // map. `ready` is still load-bearing: without it the hook primes from the
  // empty array `useLiveCollection` starts with and then hears the first real
  // snapshot as a burst of new alerts — see panicSirenStep.
  /**
   * The operator's own silence, held HERE rather than on the dispatch page.
   *
   * The siren is mounted portal-wide, so a mute owned by the page rendering
   * the button would silence nothing the moment the guard navigated away — and
   * would switch itself back on when that page unmounted. One piece of state,
   * beside the one alarm it governs.
   *
   * Deliberately NOT persisted. A mute is for the thirty seconds of a radio
   * call, not for a shift; an alarm still silenced after a reload because
   * somebody muted it yesterday is the failure this subsystem exists to
   * prevent. Every reload starts audible, and the reset below means every
   * empty queue does too.
   */
  const [sessionMuted, setSessionMuted] = useState(false)
  useEffect(() => {
    if (!alerts.length) setSessionMuted(false)
  }, [alerts.length])

  /**
   * ── THERE ARE TWO MUTES, AND THE CONSOLE WAS ONLY SHOWING ONE ───────────
   *
   * `alertSound` carries a DEVICE-WIDE mute, set from the Settings page and
   * persisted to localStorage; `playAlert` returns early when it is on. The
   * rail's own mute is the one above — per session, cleared when the queue
   * empties, deliberately not persisted so no shift ever starts silent.
   *
   * They were independent, and the gap between them was visible: a guard who
   * had muted the device in Settings got a rail button reading "Mute",
   * implying sound was playing, while the loop spun on a timer producing
   * nothing. The control described a state the hardware was not in.
   *
   * So the badge reports EITHER — if anything is silencing the siren, the
   * console says it is silenced — and unmuting clears both. A press labelled
   * "Unmute" that leaves the device muted is a dead control, and a dead
   * control on an alarm is worse than no control.
   */
  const [deviceMuted, setDeviceMuted] = useState(() => isMuted())
  useEffect(() => subscribeAlertSound(({ muted: next }) => setDeviceMuted(next)), [])

  const muted = sessionMuted || deviceMuted
  const setMuted = useCallback((next) => {
    setSessionMuted(next)
    // Unmuting has to reach the device mute too, or the press does nothing.
    // Muting deliberately does NOT: silencing one emergency must not quietly
    // persist across reloads and shifts.
    if (!next && isMuted()) setDeviceMuted_(false)
  }, [])

  usePanicSiren(alerts, { ready: !loading, muted })

  const value = useMemo(
    () => ({ alerts, loading, muted, setMuted }),
    [alerts, loading, muted, setMuted],
  )

  /**
   * NO FLOATING BANNER ANY MORE. `GlobalPanicBanner` was a pulsing red capsule
   * pinned over the top of the viewport; it is replaced by `SidebarSOSAlertsFeed`, a
   * column beside the map — see that file for why a list beats a count, and
   * why taking space from the map beats covering it.
   *
   * Those four surfaces with no map — tickets, file a report, history,
   * metrics — keep an on-screen alarm through `PanicAlertBeacon`, a compact
   * badge in the BOTTOM corner. Same information, a tenth of the footprint,
   * and nowhere near the header controls the old banner sat on top of.
   */
  return (
    <PanicAlertContext.Provider value={value}>
      {children}
      {/* The on-screen half for the surfaces with no map. It renders nothing
          on the dispatch map (the rail is there) and nothing on the SOS page
          (that page IS the list) — see PanicAlertBeacon. */}
      <PanicAlertBeacon />
    </PanicAlertContext.Provider>
  )
}
