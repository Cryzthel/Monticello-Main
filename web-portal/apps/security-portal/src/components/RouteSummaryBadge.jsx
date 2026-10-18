import { Loader2, MoveRight, Navigation, ShieldAlert, TriangleAlert, X } from '@shared/icons'
import { staffLabel } from '@shared/lib/identity'
import { ROUTE_TONE_COLORS } from '@shared/theme/dispatchColors'
import { StageBadge } from '@/components/dispatch/parts'
import { useMetricsClock } from '@/hooks/useMetricsClock'
import { arrivalAt, formatClockTime, formatDistance, formatDuration } from '@/lib/directions'

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
  targetLabel,
  targetDetail,
  stage,
  navigating = false,
  onToggleNavigation,
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

  // "You" when the route starts from THIS console's officer. Their display
  // name is often just the sign-in email, which `staffLabel` rightly refuses
  // to print, and the generic fallback then read "Unit → Noise" — naming
  // nobody, on the one card where the reader is the person routed.
  const unitName =
    route.originSource === 'self' ? 'You' : staffLabel(route.unit?.name, 'Unit')
  const failed = route.phase === 'error' || route.phase === 'no-origin'
  const pending = route.phase === 'routing'
  const result = route.phase === 'ready' ? route.route : null
  const live = route.tone === 'live'

  let StateIcon = Navigation
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
  /**
   * ── SHORTER, AND IT NO LONGER RECITES THE FIX ───────────────────────────
   * The self case used to spell out the whole remedy here — allow location for
   * this site, check it is on for the machine, and the route plots itself. All
   * true, and all of it in the wrong place: this is a paragraph inside a route
   * panel on a 375px phone, with no button on it, while the thing that can
   * actually grant the permission is one press on the banner and the toast
   * (see LocationAccessToast). Instructions with no control beside them read
   * as the console explaining why it cannot help.
   *
   * So it states the fact and points at the control. The toast is raised by
   * the same condition, so by the time an officer reads this line the button
   * it refers to is on screen.
   */
  const NO_ORIGIN_TEXT = {
    'self-no-fix':
      'This device has no GPS position yet, so there is nothing to measure a route from. Use Allow location above — the route plots itself the moment a position arrives.',
    'unit-off-duty': `${unitName} is not clocked in, so the console has no position to route from. Reassign the call, or route from the guardhouse.`,
    'unit-no-fix': `${unitName} is clocked in but not reporting a position — no GPS fix on their device, or location sharing is off.`,
  }
  const problem =
    route.phase === 'no-origin'
      ? [
          NO_ORIGIN_TEXT[reason] ?? `No position to route from for ${unitName}.`,
          /**
           * ── AN ENV VAR NAME IS NOT A SENTENCE FOR A GUARD ─────────────
           * This read "No guardhouse coordinate is configured either
           * (VITE_GUARDHOUSE_LNGLAT), so there is no fallback to fall back
           * to." Every word of that is for whoever deploys this console, and
           * the person reading it is a security officer at a gate who cannot
           * set an environment variable and should not be shown one. The
           * console already warns the operator who CAN fix it, on the
           * console, through `readGuardhouse`.
           *
           * What the officer needs from this clause is the consequence: there
           * is no second-best origin, so this will not resolve itself without
           * their position.
           */
          missingGuardhouse
            ? 'There is no guardhouse fallback set up on this console either, so a position from your device is the only way to plot this route.'
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
        {/* The simulation banner that led this scroller is gone with the
            simulator itself. Nothing on this console can now make the map
            show a position that is not real, so there is no longer a state
            for a banner to warn about. */}
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
          /* ── THREE FIGURES, AND NOTHING ELSE ───────────────────────────
             The row led with a 32px transport glyph — a bicycle or a pair of
             feet — which has gone. It was saying which routing profile is in
             use, and WHO the route belongs to is already unmistakable on the
             canvas: the officer's own marker is the only thing on the map
             carrying a standby pulse ring, and it becomes a navigation
             emblem the moment a session starts. A second, smaller statement
             of the same thing inside the card was costing 64px of a sheet
             whose whole budget is a third of a phone screen.

             The profile itself is still switchable, in the map controls
             drawer where the other mode toggles live (RouteProfileControl).

             `justify-between` rather than the old `gap-4`: with the glyph
             gone the three figures own the full width, and even spacing
             reads as a row of equals, which is what they are. */
          <div
            className="flex shrink-0 items-center justify-between gap-3 px-4 py-3.5"
            aria-live="polite"
          >
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
              into a row that had the dispatch word. A "Simulated" pill used
              to override this slot; it went with the simulator. */}
          {stage ? <StageBadge stage={stage} /> : null}
        </div>
      </div>

      {/* ── 3. THE ACTION BAR ────────────────────────────────────────────
          OUTSIDE the scroller and `shrink-0`, so the controls stay on screen
          at every sheet height. */}
      {/* ── ONE ACTION ───────────────────────────────────────────────────
          Recentre was here and has gone. It was defensible — during a
          session the camera recovers only on the next fix, which at a
          fifteen-second cadence is a wait — and it was still a second
          button competing with the one that matters, on a bar an officer
          reaches for while driving. The camera does come back on its own,
          and the map's own locate control is a tap away for anyone who
          cannot wait; neither of those was true of Start navigation. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-hairline p-4">
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
            className="btn btn-action btn-danger w-full"
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
            className="btn btn-action btn-brand w-full"
          >
            <Navigation size="sm" aria-hidden="true" />
            Start navigation
          </button>
        ) : null}
      </div>
    </div>
  )
}
