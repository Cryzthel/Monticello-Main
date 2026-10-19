import { useLocation, useNavigate } from 'react-router-dom'
import { Siren, ChevronRight } from '@shared/icons'
import { useLivePanicAlerts } from '@/components/PanicAlertProvider'
import { ROUTES } from '@/config/portal'

/**
 * The SOS indicator for the pages that have no map.
 *
 * ── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
 * It is not the old floating banner coming back. That was a full-width pulsing
 * plate pinned across the TOP of every page, which covered the duty row and
 * the notification bell during the exact minutes an officer needed them, and
 * said "14 panic alerts" without saying anything about the fourteen.
 *
 * This is deliberately smaller and deliberately somewhere else. Four surfaces
 * in this portal render no map — Incident tickets, File a report, Incident
 * history and Response metrics — and on those the alarm was left as sound plus
 * the notification bell when the rail replaced the banner. Sound is the
 * load-bearing half and it now holds until the alert is resolved, but a guard
 * typing a report in a noisy guardhouse, or one who has muted the siren to
 * take a radio call, deserves something on screen as well.
 *
 * ── WHY THE BOTTOM CORNER ──────────────────────────────────────────────────
 * The top of the viewport is spoken for on every page: the header carries the
 * duty timer, Clock out, the theme switch and the bell, and the SOS banner's
 * original sin was sitting on top of them. The bottom-right corner is empty on
 * all four of these surfaces — they are tables and forms, which end well above
 * it — so this can be unmissable without covering a single control.
 *
 * It takes no part in the dispatch map's layout: that page has the rail, so
 * this renders nothing there. One visual per surface, never two saying the
 * same thing in different words.
 */
export default function PanicAlertBeacon() {
  const { alerts } = useLivePanicAlerts()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (!alerts.length) return null

  /**
   * Silent on the two surfaces that already show the alerts in full: the
   * dispatch map, where `SidebarSOSAlertsFeed` is a column of them, and the SOS page
   * itself, whose entire content is the list. A floating badge pointing at a
   * list you are already reading is noise with a shadow on it.
   */
  if (pathname === ROUTES.dashboard || pathname === ROUTES.sos) return null

  const unattended = alerts.filter((alert) => alert.status === 'active').length

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[var(--z-sos)] max-w-[calc(100vw-2rem)]">
      <button
        type="button"
        onClick={() => navigate(ROUTES.dashboard)}
        /* `min-h-[44px]` and generous padding: this is pressed with a thumb,
           often in a hurry, and it is the one control on these pages that
           leads somewhere time-critical. */
        className="sos-banner pointer-events-auto flex min-h-[44px] items-center gap-2.5 rounded-full py-2.5 pl-3 pr-4 text-left shadow-2xl ring-1 ring-inset ring-white/25"
      >
        {/* ── ONE PULSE, ON THE GLYPH ONLY ──────────────────────────────
            The plate itself is static. A whole badge that flashes is readable
            for two seconds and tiring for the rest of a shift, and this one
            may be on screen for twenty minutes. Everything carrying MEANING —
            the plate colour, the glyph, the count — is static, so the global
            reduced-motion rule loses the ring and no information. */}
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20">
          {unattended ? (
            <span className="absolute inline-flex h-full w-full rounded-full bg-white/30 animate-ping" />
          ) : null}
          <Siren size="sm" className="relative" />
        </span>

        <span className="min-w-0">
          <span className="block truncate text-label font-semibold leading-tight">
            {alerts.length === 1 ? 'Panic alert' : `${alerts.length} panic alerts`}
          </span>
          {/* opacity-90 measures 5.45:1 on this plate — see the floor
              documented on the shared `.sos-banner` style. */}
          <span className="mt-0.5 block truncate text-caption leading-none opacity-90">
            {unattended ? `${unattended} unattended · open dispatch` : 'Open dispatch'}
          </span>
        </span>

        <ChevronRight size="sm" className="shrink-0 opacity-80" />
      </button>
    </div>
  )
}
