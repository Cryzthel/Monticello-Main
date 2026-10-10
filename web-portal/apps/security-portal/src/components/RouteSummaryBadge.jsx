import {
  Bike,
  Crosshair,
  FlaskConical,
  Footprints,
  Loader2,
  MoveRight,
  Navigation,
  ShieldAlert,
  TriangleAlert,
  X,
} from '@shared/icons'
import { staffLabel } from '@shared/lib/identity'
import { ROUTE_TONE_COLORS } from '@shared/theme/dispatchColors'
import { StageBadge } from '@/components/dispatch/parts'
import { useMetricsClock } from '@/hooks/useMetricsClock'
import {
  arrivalAt,
  formatClockTime,
  formatDistance,
  formatDuration,
  routeProfile,
} from '@/lib/directions'

/**
 * The icon for how the unit is travelling.
 *
 * Keyed on the profile's `transport`, not its routing graph, so the glyph can
 * say "two wheels" while the route still follows `mapbox/driving` — the road
 * network a patrol actually uses. See the note on ROUTE_PROFILES.
 *
 * ── IT IS NOW THE WHOLE OF WHAT SAYS "RIDE" OR "WALK" ──────────────────────
 * The panel used to carry a Ride / Walk segmented control beside it, which
 * read as a caption for this glyph and was in fact the routing-profile
 * switch. The switch moved to the map controls drawer (see
 * RouteProfileControl); the glyph stayed, and grew, because a 32px vector is
 * a faster read of "two wheels" than the word was.
 */
const TRANSPORT_ICONS = { bike: Bike, foot: Footprints }

/**
 * One figure in the telemetry row: the number, then what it is.
 *
 * ── THE NUMBER COMES FIRST, AND THAT IS THE WHOLE POINT ────────────────────
 * This panel is read in glances measured in fractions of a second, by somebody
 * who already knows there are three figures here and roughly where each one
 * sits. Label-above-value is the right order for a form, where the reader does
 * not yet know what the field is; it is the wrong order here, because it puts
 * 10px of grey text at the top of the panel and the thing worth reading
 * underneath it.
 *
 * `tabular-nums` on every one of them. These figures count DOWN as the unit
 * moves, and proportional digits make a number that is only changing its tens
 * place look like the whole panel twitching.
 *
 * ── SIZE CARRIES THE HIERARCHY, NOT COLOUR ─────────────────────────────────
 * The ETA was briefly tinted with the route's own tone, which looked right on
 * the dark console and measured 3.56:1 on the light one — technically a pass
 * for 20px semibold, and far too close to the floor for the biggest number on
 * an emergency console. The map's tones are chosen to survive satellite tiles,
 * not to be read as type on a white card.
 */
function Telemetry({ label, value, strong = false }) {
  return (
    <div className="min-w-0 flex-1">
      <p
        className={`truncate tabular-nums font-semibold leading-none text-text-primary ${
          strong ? 'text-xl' : 'text-base'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-2xs font-medium leading-none text-text-muted">{label}</p>
    </div>
  )
}

/**
 * The dispatch route panel: a bottom sheet on a phone, a floating card on a
 * console.
 *
 * ── THREE THINGS, AFTER A PASS THAT REMOVED FOUR ───────────────────────────
 *   1. TELEMETRY     the transport glyph, ETA, distance left, arrival clock
 *   2. DESTINATION   where the unit is going, who is going, what stage
 *   3. ACTIONS       recentre, and start or exit the session
 *
 * What came out, and why each was genuinely a duplicate rather than merely
 * small:
 *
 *   THE MANEUVER LIST. The guidance banner renders the active instruction in
 *   display type across the top of the map; the list rendered the same
 *   sentence again, in 11px, eighty pixels below it. One of the two had to
 *   go and it was not going to be the one a driver can read at speed.
 *
 *   THE RIDE / WALK CONTROL. Read as a caption for the transport glyph
 *   beside it. It was not a caption — it is the routing profile — so it
 *   moved to the controls drawer rather than being deleted (see
 *   RouteProfileControl).
 *
 *   THE REPEAT BUTTON. Replaced by the thing it was a manual version of:
 *   the voice guidance now re-speaks the current instruction for as long as
 *   the unit has not reached the corner, so pressing a button to ask for
 *   what is already coming was a control with nothing left to do.
 *
 *   THE TARGET, TWICE. The destination appeared in the mobile summary line
 *   AND in the destination row immediately under it.
 *
 * ── THE FIGURES ARE LIVE, AND ONLY WHEN THEY CAN BE ────────────────────────
 * `progress` is computed from the unit's own telemetry fix (see
 * `routeProgress`). It is null whenever there is no usable fix, and every
 * live figure then falls back to the route's original numbers rather than to
 * a guess. Nothing here advances because time passed — with ONE deliberate
 * exception, the arrival clock, which is a function of now by definition and
 * owns a ticking clock for exactly that reason (see `arrivalAt`).
 *
 * ── AN OFFICER'S EMAIL IS NOT THEIR NAME ───────────────────────────────────
 * The unit label goes through `staffLabel`. Accounts here are provisioned by
 * email and `staff_accounts.name` often holds the address, so this panel
 * would otherwise print a personal contact detail over a map anyone at the
 * guardhouse desk can read over a shoulder.
 */
export default function RouteSummaryBadge({
  route,
  progress,
  profile,
  targetLabel,
  targetDetail,
  stage,
  simulated = false,
  navigating = false,
  onToggleNavigation,
  onRecenter,
  offRoute = false,
}) {
  /**
   * The clock the arrival time is measured against.
   *
   * Owned HERE rather than on the page, deliberately. A 15-second tick in
   * DashboardPage would re-render IncidentMap, re-run the route GeoJSON memo
   * and re-enter the unit tween four times a minute, to move one label by a
   * digit. This is a leaf, so the tick costs exactly what it changes.
   *
   * Called before the early return below, because a hook has to be.
   */
  const now = useMetricsClock()

  if (!route || route.phase === 'idle') return null

  const unitName = staffLabel(route.unit?.name, 'Unit')
  const failed = route.phase === 'error' || route.phase === 'no-origin'
  const pending = route.phase === 'routing'
  const result = route.phase === 'ready' ? route.route : null
  const live = route.tone === 'live'

  const TransportIcon = TRANSPORT_ICONS[routeProfile(profile).transport] ?? Navigation
  let StateIcon = TransportIcon
  if (pending) StateIcon = Loader2
  else if (failed) StateIcon = ShieldAlert

  const color = ROUTE_TONE_COLORS[route.tone] ?? ROUTE_TONE_COLORS.preview

  // Live where a fix allows it, the route's own figures otherwise.
  const distanceM = progress ? progress.remainingM : result?.distance
  const durationS = progress ? progress.remainingDurationS : result?.duration
  const arrival = arrivalAt(durationS, now)

  /**
   * ── FOUR DIFFERENT FAULTS, FOUR DIFFERENT SENTENCES ──────────────────────
   * This was one string for all of them: "not sharing a position — no GPS
   * fix, or location sharing is off". It was reported as a bug by an officer
   * whose location WAS granted and working, and they were right to report
   * it — the console was blaming the one thing that was fine.
   */
  const [reason, missingGuardhouse] = String(route.noOriginReason ?? '').split(':')
  const NO_ORIGIN_TEXT = {
    'self-no-fix':
      'This device has not produced a GPS fix yet. Allow location for this site, check location is switched on for the whole machine, and the route plots itself as soon as a position arrives.',
    'unit-off-duty': `${unitName} is not clocked in, so the console has no position to route from. Reassign the call, or route from the guardhouse.`,
    'unit-no-fix': `${unitName} is clocked in but not reporting a position — no GPS fix on their device, or location sharing is off.`,
  }
  const problem =
    route.phase === 'no-origin'
      ? [
          NO_ORIGIN_TEXT[reason] ?? `No position to route from for ${unitName}.`,
          missingGuardhouse
            ? 'No guardhouse coordinate is configured either (VITE_GUARDHOUSE_LNGLAT), so there is no fallback to fall back to.'
            : null,
        ]
          .filter(Boolean)
          .join(' ')
      : route.phase === 'error'
        ? route.error
        : null

  const fromLabel = route.originSource === 'guardhouse' ? `${unitName} · from the guardhouse` : unitName

  /**
   * A MAX height, not a height: a short route is a short sheet, and only a
   * long one reaches the cap and starts scrolling.
   *
   * Expressed as a `vh` utility rather than an inline style, now that it is
   * a constant. The inline version existed because the number varied during
   * a drag, and it brought a problem with it — an inline `maxHeight` cannot
   * be overridden by `sm:max-h-none`, so the console inherited the phone's
   * cap and needed a CSS variable to work around its own specificity. With
   * the drag gone the plain class is correct again and the breakpoint
   * override is an ordinary cascade.
   */

  return (
    <div
      className={[
        // `w-full` with no cap below `sm` — a bottom sheet IS the width of
        // the screen. `sm:max-w-md` brings back the 448px card.
        'pointer-events-auto flex w-full flex-col overflow-hidden border border-hairline bg-base-900 shadow-2xl sm:max-w-md',
        // Square bottom corners below `sm`: a rounded corner against a screen
        // edge reads as a rendering gap, and the top corners carry the radius
        // that says "this slides".
        'rounded-t-3xl sm:rounded-2xl',
        // ── A CAP, NOT A DETENT, AND THE HANDLE IS GONE WITH THEM ──────
        // The sheet used to rest at 35% and drag up to 55% to reveal the
        // maneuver list. That list moved out — the guidance banner renders
        // the active instruction and a second copy eighty pixels below was
        // the same sentence twice — and what was left measured 232px at
        // 390x844, comfortably under this cap.
        //
        // So the drag resolved to nothing: both detents showed identical
        // content and the handle expanded the card into empty space. A
        // control that visibly does nothing is worse than no control, so the
        // handle, the detents, the pointer-capture drag and its keyboard
        // path came out together — about ninety lines, none of which can now
        // be wrong.
        //
        // The cap stays, with the scroller under it, because the content is
        // not fixed: an off-route notice, a simulation banner and a long
        // no-origin explanation each add a row, and at that point the officer
        // scrolls inside a sheet that is still a third of their map.
        //
        // A literal rather than a constant: Tailwind reads class strings at
        // build time and cannot see a JS value, so a constant here would be
        // documentation pretending to be a source of truth.
        'max-h-[35vh] sm:max-h-none',
      ].join(' ')}
    >
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {/* A second, unmissable statement on the panel itself. The pill in the
            destination row is the one that must be right; this is the one
            that explains it. */}
        {simulated ? (
          <p className="flex shrink-0 items-center gap-2 border-b border-hairline bg-warning/15 px-4 py-2 text-caption font-medium text-warning">
            <FlaskConical size="sm" aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1">
              Simulated movement — this unit is not really here. Nothing is being recorded.
            </span>
          </p>
        ) : null}

        {/* ── OFF ROUTE, AND ONLY WHEN IT IS TRUE ──────────────────────────
            `offRoute` arrives from `useOffRoute`, which requires the
            condition to HOLD for five seconds. It used to be the raw per-fix
            distance test, which made this banner blink on and off at an
            officer driving correctly down the plotted road. */}
        {offRoute ? (
          <p className="flex shrink-0 items-center gap-2 border-b border-hairline bg-warning/10 px-4 py-2 text-caption text-warning">
            <TriangleAlert size="sm" aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1">
              {unitName} is off the plotted route — re-plotting from their position.
            </span>
          </p>
        ) : null}

        {/* ── 1. PRIMARY TELEMETRY ─────────────────────────────────────────
            ONE ROW, at every width, and the only row with figures in it.

            The glyph leads at 32px because it is the thing that replaced two
            words of UI: it says ride or walk on its own, which is what let
            the segmented control move off this card. It is tinted with the
            route's own tone so the panel and the line on the map read as one
            object — the tone is doing colour work on a 32px vector here, not
            carrying text, which is the distinction that kept it off the ETA.

            `items-center` and `leading-none` throughout: three figures of
            different type sizes on one baseline grid is the whole reason this
            row reads as a single statement rather than three cells. */}
        {result ? (
          <div className="flex shrink-0 items-center gap-4 px-4 py-3" aria-live="polite">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: `${color}26`, color }}
            >
              <TransportIcon size="lg" aria-hidden="true" />
            </span>
            <Telemetry label={live ? 'ETA' : 'Est. time'} value={formatDuration(durationS)} strong />
            <Telemetry label="Remaining" value={formatDistance(distanceM)} />
            <Telemetry label="Arrival" value={formatClockTime(arrival)} />
          </div>
        ) : (
          <div className="flex min-w-0 shrink-0 items-center gap-3 px-4 py-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={failed ? undefined : { backgroundColor: `${color}26`, color }}
            >
              <StateIcon
                size="md"
                className={`${pending ? 'animate-spin' : ''} ${failed ? 'text-warning' : ''}`}
              />
            </span>
            <div className="min-w-0 flex-1" aria-live="polite">
              <p className="truncate text-label font-semibold leading-tight text-text-primary">
                {route.phase === 'no-origin'
                  ? reason === 'unit-off-duty'
                    ? 'Unit off duty'
                    : 'No position'
                  : route.phase === 'error'
                    ? 'No route'
                    : 'Plotting the route…'}
              </p>
              {problem ? (
                <p className="mt-0.5 text-caption leading-snug text-warning">{problem}</p>
              ) : null}
            </div>
          </div>
        )}

        {/* ── 2. THE DESTINATION ───────────────────────────────────────────
            Where, who, and what stage — the three things that are NOT
            numbers, kept out of the figure row so neither has to compete.

            It no longer repeats the target in a summary line above: the
            destination appeared twice on a phone, once in the single-line
            summary and again here, which is a third of the peek height spent
            saying "Lot 12" to somebody who had just read "Lot 12".

            ── THE PILL SAYS "RESPONDING", NOT "EN ROUTE" ──────────────────
            An earlier brief asked for En Route / Dispatched. This renders the
            console's own `StageBadge`, which says Dispatched / Responding /
            On-site, because that vocabulary is not cosmetic: it is the
            `dispatchStage` enum the rules enforce, the words the drawer
            prints, and the words the status log records. */}
        <div className="flex min-w-0 shrink-0 items-center gap-3 border-t border-hairline px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-label font-semibold leading-tight text-text-primary">
              {targetLabel || 'the call'}
            </p>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-caption leading-none text-text-secondary">
              <span className="min-w-0 truncate">{fromLabel}</span>
              {targetDetail ? (
                <>
                  <MoveRight size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
                  <span className="max-w-[55%] shrink-0 truncate">{targetDetail}</span>
                </>
              ) : null}
            </p>
          </div>

          {/* ── ONE PILL, NOT TWO ────────────────────────────────────────
              The stage badge and a Live / Preview capsule used to stack here.
              They are the same fact twice: `tone === 'live'` IS
              `dispatchStage === 'responding'`, which the stage badge already
              names — the capsule was the route layer's word for it leaking
              into a row that had the dispatch word. Simulated is different
              and genuinely overrides, so it keeps the slot when it applies. */}
          {simulated ? (
            <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-pill-warning px-3 text-2xs font-semibold text-pill-warning-fg">
              <FlaskConical size="sm" aria-hidden="true" />
              Simulated
            </span>
          ) : stage ? (
            <StageBadge stage={stage} />
          ) : null}
        </div>
      </div>

      {/* ── 3. THE ACTION BAR ────────────────────────────────────────────
          OUTSIDE the scroller and `shrink-0`, so the controls stay on screen
          at every sheet height. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-hairline p-4">
        {/* ── RECENTRE, WHICH IS NOT THE OVERVIEW BUTTON COMING BACK ──────
            Overview framed the WHOLE route and was removed for cluttering a
            screen during a live response. This does the opposite thing: it
            puts the camera back on the unit.

            It earns its place where Overview did not because the camera can
            genuinely be somewhere else. A dispatcher panning to check a gate
            clears follow mode outright; during a session the camera recovers
            by itself, but only on the NEXT FIX, and at this console's
            fifteen-second telemetry cadence that is long enough to want a
            button rather than a wait. */}
        {onRecenter ? (
          <button
            type="button"
            onClick={onRecenter}
            className="btn btn-action btn-outline flex-1 sm:flex-none"
          >
            <Crosshair size="sm" aria-hidden="true" />
            Recentre
          </button>
        ) : null}

        {navigating ? (
          /* ── A WASH, NOT A SOLID RED ─────────────────────────────────
             The shared stylesheet defines `.btn-danger` as a danger-tinted
             wash and states, in so many words, that a danger button is
             "never white on a solid danger fill" — the two consoles reserve
             solid red for the SOS plate alone. It is still the loudest
             control in this bar: it is the only coloured one. */
          <button
            type="button"
            onClick={onToggleNavigation}
            aria-pressed
            className="btn btn-action btn-danger flex-1 sm:ml-auto sm:flex-none"
          >
            <X size="sm" aria-hidden="true" />
            Exit navigation
          </button>
        ) : result && onToggleNavigation ? (
          /* Pressing this is also what transforms the map marker — the
             standby ring around the unit becomes a heading arrow (see
             `navigationArrowImage` in IncidentMap). That is the only visible
             confirmation an officer gets that the session started, so the two
             must stay wired to this one control. */
          <button
            type="button"
            onClick={onToggleNavigation}
            className="btn btn-action btn-brand flex-1 sm:ml-auto sm:flex-none"
          >
            <Navigation size="sm" aria-hidden="true" />
            Start navigation
          </button>
        ) : null}
      </div>
    </div>
  )
}
