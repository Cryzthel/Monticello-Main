import { createContext, useContext, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { collection, query, where } from 'firebase/firestore'
import { Siren, ChevronRight } from 'lucide-react'
import { useAuth } from '@shared/auth/AuthContext'
import { useLiveCollection } from '@shared/hooks/useLiveCollection'
import { db } from '@shared/lib/firebase'
import { mapPanicAlertDoc } from '@shared/lib/panicAlerts'
import { ROUTES } from '@/config/portal'
import { usePanicSiren } from '@/hooks/usePanicSiren'

/**
 * The portal-wide panic alert channel: one subscription, one siren, one banner.
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
 * decision left open. The banner is deliberately NOT drawn on the map surface.
 *
 * ── IT MOVES A LISTENER RATHER THAN ADDING ONE ─────────────────────────────
 * DashboardPage used to open this exact query itself. Mounting a second
 * `onSnapshot` on the same query here would be precisely what usePanicAlerts
 * warns against: a duplicate listener, a duplicate read bill, and a second
 * source of truth that can disagree with the map about which alerts exist.
 * The subscription therefore LIVES here and the page consumes it through
 * `useLivePanicAlerts`, so the banner, the siren and the map nodes are all
 * reading one array by construction.
 *
 * ── WHY THE LIVE FILTER, NOT `usePanicAlerts` ──────────────────────────────
 * `@shared/hooks/usePanicAlerts` is deliberately unfiltered because it backs
 * the SOS *record* page. An alarm must not ring for history, so this keeps the
 * map's `status in ('active','acknowledged')` filter — the set of emergencies
 * that still need somebody.
 */
const PanicAlertContext = createContext(null)

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
  usePanicSiren(alerts, { ready: !loading })

  const value = useMemo(() => ({ alerts, loading }), [alerts, loading])

  return (
    <PanicAlertContext.Provider value={value}>
      {children}
      <GlobalPanicBanner alerts={alerts} />
    </PanicAlertContext.Provider>
  )
}

/**
 * The always-on-top SOS indicator.
 *
 * ── FIXED, NOT MOUNTED IN THE SHELL ────────────────────────────────────────
 * DashboardLayout renders page content inside a scrolling `<main>`. Anything
 * mounted through AppShell therefore scrolls away with the page, which is the
 * one thing an alert described as "persistent regardless of tab" must not do.
 * `fixed` takes it out of that column entirely.
 *
 * ── A CAPSULE, NOT A FULL-WIDTH BAR ────────────────────────────────────────
 * A bar across the top would cover the sidebar's brand row and the header's
 * search and notification controls — during the exact minutes a guard most
 * needs them. Centred with a bounded width, the alarm is unmissable and every
 * control around it stays reachable.
 *
 * ── EXPORTED ON PURPOSE ────────────────────────────────────────────────────
 * Nothing imports this today; the provider renders it directly. It is exported
 * because it is the seam that makes the banner verifiable — it takes `alerts`
 * and nothing else, so a throwaway harness can mount it with fixtures and
 * check every state without Firebase, auth or a signed-in session. That is how
 * the states below were confirmed. Please do not make it private again to
 * silence an "unused export"; that trades a testable component for a tidier
 * lint run.
 */
export function GlobalPanicBanner({ alerts }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (!alerts.length) return null

  // Suppressed on the SOS page itself, on the same principle the map applies:
  // a surface whose entire content is the list of live alerts does not need a
  // floating badge telling it they exist.
  if (pathname === ROUTES.sos) return null

  const newest = alerts[0]
  const count = alerts.length

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-3 z-[var(--z-sos)] w-[min(92vw,34rem)] -translate-x-1/2"
      role="alert"
      aria-live="assertive"
    >
      <button
        type="button"
        onClick={() => navigate(ROUTES.sos)}
        className="sos-banner pointer-events-auto flex w-full items-center gap-3 rounded-full py-2.5 pl-3 pr-4 text-left ring-1 ring-inset ring-white/25"
      >
        {/* The ring is the only animated part, and `animate-ping` is covered by
            the global prefers-reduced-motion rule. Everything that carries
            MEANING — the plate, the siren glyph, the count, the name — is
            static, so a reduced-motion guard loses the pulse and no
            information. */}
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20">
          <span className="absolute inline-flex h-full w-full rounded-full bg-white/30 animate-ping" />
          <Siren className="relative h-4 w-4" />
        </span>

        {/* ── THE OPACITY FLOOR, MEASURED ────────────────────────────────
            White on this plate is 6.47:1 at full strength, and every step of
            opacity composites the label toward the red underneath it. Against
            the 4.5:1 that small text owes:

              opacity-100  6.47:1   the headline
              opacity-90   5.45:1   the resident line
              opacity-80   4.59:1   the chevron

            opacity-80 is the FLOOR, not a safe default — it clears AA by 0.09.
            Anything dimmer fails, so do not reach for opacity-70 here to calm
            the hierarchy down; change the weight or the size instead. */}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            {/* Sentence case, and no second label. This read
                `PANIC ALERT` in uppercase tracked bold with `SOS` set beside
                it — a kicker carrying no information next to a synonym of
                itself, on the one surface that has to be read in under a
                second. index.css states that an `uppercase` utility in this
                codebase is a regression. */}
            <span className="text-label font-semibold">
              {count > 1 ? `${count} panic alerts` : 'Panic alert'}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-caption opacity-90">
            {newest?.residentName ? `${newest.residentName} — ` : ''}
            tap to open dispatch
          </span>
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 opacity-80" />
      </button>
    </div>
  )
}
