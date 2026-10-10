import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bike,
  Clock,
  FlaskConical,
  Footprints,
  Loader2,
  MapPin,
  MoveRight,
  Navigation,
  ShieldAlert,
  TriangleAlert,
  Volume2,
  X,
} from '@shared/icons'
import SegmentedControl from '@shared/components/SegmentedControl'
import { staffLabel } from '@shared/lib/identity'
import { ROUTE_TONE_COLORS } from '@shared/theme/dispatchColors'
import RouteSteps from '@/components/RouteSteps'
import { StageBadge } from '@/components/dispatch/parts'
import { useMetricsClock } from '@/hooks/useMetricsClock'
import {
  ROUTE_PROFILES,
  arrivalAt,
  formatClockTime,
  formatDistance,
  formatDuration,
  routeProfile,
} from '@/lib/directions'

const PROFILE_OPTIONS = Object.values(ROUTE_PROFILES).map((option) => ({
  value: option.key,
  label: option.label,
}))

/**
 * The icon for how the unit is travelling.
 *
 * Keyed on the profile's `transport`, not its routing graph, so the glyph can
 * say "two wheels" while the route still follows `mapbox/driving` — the road
 * network a patrol actually uses. See the note on ROUTE_PROFILES.
 */
const TRANSPORT_ICONS = { bike: Bike, foot: Footprints }

/**
 * The two heights the sheet rests at below `sm`, as a fraction of the map.
 *
 * ── WHY TWO AND NOT A FREE RESIZE ──────────────────────────────────────────
 * A sheet that stops wherever the finger left it reads as broken rather than
 * flexible: the officer has to aim, and every session ends up at a slightly
 * different height for no reason. Detents mean the drag is forgiving — let go
 * anywhere and it lands somewhere deliberate.
 *
 * 35% is the brief's figure and it is the right one: enough for the handle,
 * the summary row and the actions, which is the whole of what a driver needs,
 * while leaving two thirds of a phone screen as map. 80% is the inspection
 * position, where the maneuver list is worth reading — still short of full,
 * because a sheet that covers everything has stopped being a sheet and the
 * map behind it is the reason anybody opened this console.
 */
const SHEET_DETENTS = { peek: 0.35, full: 0.8 }

/** Past this much of a drag, the release lands on the other detent. */
const SNAP_FRACTION = 0.25

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
 * not to be read as type on a white card, and borrowing one here imported
 * that constraint for no gain: the "Live" capsule already says what the colour
 * was saying, and a figure that changes hue invites the reader to hunt for a
 * meaning that is not there.
 */
function Telemetry({ icon: Icon, label, value, strong = false }) {
  return (
    <div className="min-w-0 px-3 py-2 sm:py-2.5">
      <p
        className={`truncate tabular-nums font-semibold leading-tight text-text-primary ${
          strong ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 flex items-center gap-1 truncate text-2xs font-medium leading-none text-text-muted sm:mt-1">
        <Icon size="sm" aria-hidden="true" className="shrink-0" />
        {label}
      </p>
    </div>
  )
}

/**
 * Drag-to-resize for the mobile sheet.
 *
 * ── WHY THIS IS HAND-ROLLED AND SMALL ──────────────────────────────────────
 * It is forty lines of pointer events against a dependency, and the
 * dependency would bring a whole sheet component with its own scrim, focus
 * trap and mount animation — none of which apply to a panel that lives inside
 * a map and must never take focus from it.
 *
 * ── IT FOLLOWS THE FINGER, WHICH IS THE ONLY PART THAT MATTERS ─────────────
 * A handle that toggles on tap and ignores the drag is the version everybody
 * ships first, and it feels like a button wearing a handle's clothes. The
 * height tracks the pointer in real time, there is no transition WHILE
 * dragging (a transition during a drag is the single most common way to make
 * a gesture feel laggy — the element is always chasing the finger), and the
 * transition comes back for the snap so the release has somewhere to land.
 *
 * `setPointerCapture` so a fast drag that leaves the handle still steers it,
 * and `touch-action: none` so the browser does not claim the gesture as a
 * page scroll before the first move event arrives.
 */
function useSheetDrag({ expanded, onSettle }) {
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState(0)
  const startRef = useRef(0)
  /**
   * Set when a pointer gesture was a real DRAG, so the click the browser
   * synthesises after it does not toggle the sheet straight back.
   *
   * ── WHY THE TAP IS HANDLED BY `onClick` AND NOT BY `onPointerUp` ────────
   * It was in `onPointerUp`, treating "pointer released having barely moved"
   * as a tap, which is correct for a finger and leaves the sheet
   * UNREACHABLE FROM A KEYBOARD. Enter and Space on a focused button fire a
   * click and no pointer events at all, so the handle looked like a control
   * and did nothing — caught by driving it programmatically, which is the
   * same event path assistive tech uses.
   *
   * So the two are split along what they are actually for: `click` is
   * activation, from any input device, and the pointer handlers exist only
   * to make the gesture continuous. A drag suppresses the click that follows
   * it; everything else activates.
   */
  const draggedRef = useRef(false)

  const onPointerDown = useCallback((event) => {
    if (event.button != null && event.button !== 0) return
    startRef.current = event.clientY
    draggedRef.current = false
    setDragging(true)
    setOffset(0)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (event) => {
      if (!dragging) return
      // Up is positive: dragging up makes the sheet taller.
      setOffset(startRef.current - event.clientY)
    },
    [dragging],
  )

  const onPointerUp = useCallback(
    (event) => {
      if (!dragging) return
      setDragging(false)
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      const travelled = startRef.current - event.clientY
      const threshold = window.innerHeight * (SHEET_DETENTS.full - SHEET_DETENTS.peek) * SNAP_FRACTION
      setOffset(0)
      // Under 4px is a tap with a shaky finger, not a drag. It is left to the
      // click that follows, so the keyboard and the finger go down one path.
      if (Math.abs(travelled) < 4) return
      draggedRef.current = true
      // Past a quarter of the distance between detents, the release lands on
      // the other one; short of that it returns to where it started, which is
      // what makes an accidental brush harmless.
      if (travelled > threshold) onSettle(true)
      else if (travelled < -threshold) onSettle(false)
    },
    [dragging, onSettle],
  )

  const onClick = useCallback(() => {
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    onSettle(!expanded)
  }, [expanded, onSettle])

  return {
    dragging,
    offset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClick },
  }
}

/**
 * The dispatch route panel: a bottom sheet on a phone, a floating card on a
 * console.
 *
 * ── WHAT A UNIT IN MOTION NEEDS, IN ORDER ──────────────────────────────────
 *   1. SUMMARY        ETA, distance left, wall-clock arrival
 *   2. DESTINATION    where the unit is going, who is going, what stage
 *   3. TIMELINE       every maneuver, as a vertical sequence (RouteSteps)
 *   4. ACTIONS        what the officer can do about any of it
 *
 * The next TURN is not on this list any more: it is the guidance banner, and
 * it lives at the top of the map on every screen (see GuidanceBanner).
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
  onChangeProfile,
  simulated = false,
  navigating = false,
  onToggleNavigation,
  voiceSupported = true,
  onRepeat,
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
  const [expanded, setExpanded] = useState(false)
  const { dragging, offset, handlers } = useSheetDrag({ expanded, onSettle: setExpanded })

  // A new call is a new sheet. Leaving it expanded would hand the next
  // officer a panel covering most of their map for reasons belonging to the
  // last one.
  const incidentId = route?.incidentId ?? null
  useEffect(() => {
    setExpanded(false)
  }, [incidentId])

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

  const problem =
    route.phase === 'no-origin'
      ? `${unitName} is not sharing a position — no GPS fix, or location sharing is off.`
      : route.phase === 'error'
        ? route.error
        : null

  const fromLabel = route.originSource === 'guardhouse' ? `${unitName} · from the guardhouse` : unitName

  /**
   * ── THE SHEET'S HEIGHT ─────────────────────────────────────────────────
   * A `maxHeight` in `vh` rather than a `height`, so a short route with three
   * maneuvers is a short sheet and only a long one reaches the detent. The
   * drag offset is added live and clamped, so pulling past the top resists
   * instead of flying off.
   *
   * ── IT TRAVELS AS A CSS VARIABLE, NOT AS AN INLINE `maxHeight` ──────────
   * Because it has to STOP applying above `sm`, and no utility class can beat
   * an inline style — `sm:max-h-none` would lose to it at every width, and
   * the console would inherit a phone's sheet height. A custom property is
   * set inline (it is a continuously varying number during a drag, so it has
   * to be) while the thing that READS it is an ordinary class, which means
   * the breakpoint override is an ordinary cascade again.
   */
  const detent = expanded ? SHEET_DETENTS.full : SHEET_DETENTS.peek
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight
  const sheetMaxH = Math.min(
    viewportH * SHEET_DETENTS.full,
    Math.max(viewportH * 0.2, viewportH * detent + offset),
  )

  return (
    <div
      className={[
        // `w-full` with no cap below `sm` — a bottom sheet IS the width of
        // the screen. `sm:max-w-md` brings back the 448px card, which is the
        // width the action bar was measured against: Repeat and Exit
        // navigation come to 387px of button inside it, and the three-cell
        // telemetry grid needs every pixel of the rest.
        'pointer-events-auto flex w-full flex-col overflow-hidden border border-hairline bg-base-900 shadow-2xl sm:max-w-md',
        // ── THE SHEET, AND THE CARD IT BECOMES ────────────────────────────
        // Below `sm` it is anchored to the bottom edge of the map: square
        // bottom corners, because a rounded corner against a screen edge
        // reads as a rendering gap, and the top corners carry the radius
        // that says "this slides".
        'rounded-t-3xl sm:rounded-xl',
        'max-h-[var(--sheet-h)] sm:max-h-none',
        // No transition WHILE dragging. A transition during a drag is the
        // single most common way to make a gesture feel laggy — the element
        // is always chasing the finger instead of being held by it. It comes
        // back for the release, so the snap has somewhere to land.
        dragging
          ? ''
          : 'transition-[max-height] duration-300 ease-[var(--ease-out-strong)] motion-reduce:transition-none',
      ].join(' ')}
      style={{ '--sheet-h': `${sheetMaxH}px` }}
    >
      {/* ── THE DRAG HANDLE ──────────────────────────────────────────────
          Phone only. On a console there is nothing to drag — the panel is a
          card in the corner of a large map and its height is already the
          height of its contents.

          `py-2.5` around a 4px bar gives a 36px target, which is the smallest
          thing on this sheet anybody is asked to hit and is still above the
          44px row it sits in. `touch-none` is load-bearing: without it the
          browser claims the first few pixels of vertical movement as a page
          scroll and the drag starts late and jumps. */}
      <button
        type="button"
        aria-label={expanded ? 'Collapse route details' : 'Expand route details'}
        aria-expanded={expanded}
        className="flex shrink-0 touch-none items-center justify-center py-2.5 sm:hidden"
        {...handlers}
      >
        <span
          aria-hidden="true"
          className="h-1 w-10 rounded-full bg-tint/25 transition-colors duration-150"
        />
      </button>

      {/* Everything below the handle scrolls as one, so a dragged-up sheet
          shows more of the SAME document rather than revealing a second
          scroller the officer has to find. */}
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {/* A second, unmissable statement on the panel itself. The pill in the
            destination row is the one that must be right; this is the one that
            explains it. */}
        {simulated ? (
          <p className="flex shrink-0 items-center gap-2 border-b border-hairline bg-warning/15 px-3 py-2 text-caption font-medium text-warning">
            <FlaskConical size="sm" aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1">
              Simulated movement — this unit is not really here. Nothing is being recorded.
            </span>
          </p>
        ) : null}

        {/* ── OFF ROUTE, AND ONLY WHEN IT IS TRUE ──────────────────────────
            `offRoute` arrives from `useOffRoute`, which requires the
            condition to HOLD for five seconds. It used to be the raw
            per-fix distance test, which made this banner blink on and off at
            an officer driving correctly down the plotted road — a phone's
            fix walks 20-30 m between readings in a built-up subdivision,
            which is the same magnitude as the threshold itself. */}
        {offRoute ? (
          <p className="flex shrink-0 items-center gap-2 border-b border-hairline bg-warning/10 px-3 py-2 text-caption text-warning">
            <TriangleAlert size="sm" aria-hidden="true" className="shrink-0" />
            {/* Stated, and re-plotted: the route is re-requested from the
                unit's live position, capped so a fix no road can reach does
                not spend the quota forever. See useDispatchRoute. */}
            <span className="min-w-0 flex-1">
              {unitName} is off the plotted route — re-plotting from their position.
            </span>
          </p>
        ) : null}

        {/* ── 1. SUMMARY ───────────────────────────────────────────────────
            ONE ROW ON A PHONE, three cells on a console.

            The three-cell grid is right at 448px and wrong at 375: the
            dividers, the per-cell padding and three stacked value/label pairs
            came to 88px of sheet to carry three short figures, on a surface
            whose entire budget is 35% of the screen. Below `sm` they run
            inline with middots instead — the same three numbers, one line,
            and the destination joins them so the officer reads "11 min ·
            3.8 km · Lot 12" as the sentence it is.

            The arrival clock is the one that gives way on the narrowest
            screens: it is the figure for telling a resident on the phone,
            which is a dispatcher's job, and a dispatcher is on the console
            where all three still show. */}
        {result ? (
          <>
            <div
              className="flex shrink-0 items-baseline gap-2 border-b border-hairline px-4 py-2.5 sm:hidden"
              aria-live="polite"
            >
              <span className="whitespace-nowrap text-lg font-semibold leading-none tabular-nums text-text-primary">
                {formatDuration(durationS)}
              </span>
              <span className="whitespace-nowrap text-sm font-medium tabular-nums text-text-secondary">
                · {formatDistance(distanceM)}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-sm font-medium text-text-primary">
                {targetLabel || 'the call'}
              </span>
            </div>

            <div
              className="hidden shrink-0 grid-cols-3 divide-x divide-hairline border-b border-hairline sm:grid"
              aria-live="polite"
            >
              <Telemetry
                icon={Navigation}
                label={live ? 'ETA' : 'Est. time'}
                value={formatDuration(durationS)}
                strong
              />
              <Telemetry icon={TransportIcon} label="Remaining" value={formatDistance(distanceM)} />
              <Telemetry icon={Clock} label="Arrival" value={formatClockTime(arrival)} />
            </div>
          </>
        ) : (
          <div className="flex min-w-0 shrink-0 items-center gap-3 border-b border-hairline px-3 py-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={failed ? undefined : { backgroundColor: `${color}26`, color }}
            >
              <StateIcon
                size="sm"
                className={`${pending ? 'animate-spin' : ''} ${failed ? 'text-warning' : ''}`}
              />
            </span>
            <div className="min-w-0 flex-1" aria-live="polite">
              <p className="truncate text-label font-semibold leading-tight text-text-primary">
                {route.phase === 'no-origin'
                  ? 'No position'
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
            Hidden below `sm` while the sheet is at its peek height, because
            the target is already in the summary line above and the rest of
            this row — who is going, which stage — is what an officer expands
            the sheet to read. On a console it is always there.

            ── THE PILL SAYS "RESPONDING", NOT "EN ROUTE" ──────────────────
            An earlier brief asked for En Route / Dispatched. This renders the
            console's own `StageBadge` instead, which says Dispatched /
            Responding / On-site, because that vocabulary is not cosmetic: it
            is the `dispatchStage` enum the rules enforce, the words the
            drawer prints, and the words the status log records. */}
        <div
          className={`min-w-0 shrink-0 items-start gap-2.5 px-3 py-2.5 ${
            expanded ? 'flex' : 'hidden'
          } sm:flex`}
        >
          <span
            className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: `${color}26`, color }}
          >
            <MapPin size="sm" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-label font-semibold leading-tight text-text-primary">
              {targetLabel || 'the call'}
            </p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption leading-snug text-text-secondary">
              <span className="min-w-0 truncate">{fromLabel}</span>
              {targetDetail ? (
                <>
                  <MoveRight size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
                  <span className="max-w-[55%] shrink-0 truncate">{targetDetail}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {stage ? <StageBadge stage={stage} /> : null}
            {/* ── THE BADGE REPLACES "LIVE", IT DOES NOT SIT BESIDE IT ─────
                While the simulator is running these figures come from a
                clock, not from a device. The pill that would otherwise assert
                the opposite is therefore the pill that has to change: an
                amber "Simulated" in the same slot, with no pulse, because the
                pulse is this panel's way of saying a real unit is moving. */}
            {simulated ? (
              <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-pill-warning px-2 text-2xs font-semibold text-pill-warning-fg">
                <FlaskConical size="sm" aria-hidden="true" />
                Simulated
              </span>
            ) : !failed && !pending ? (
              <span
                className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-2xs font-medium ${
                  live ? 'bg-pill-success text-pill-success-fg' : 'bg-pill-neutral text-pill-neutral-fg'
                }`}
              >
                {live ? (
                  <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-success/60 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                  </span>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" aria-hidden="true" />
                )}
                {live ? 'Live' : 'Preview'}
              </span>
            ) : null}
          </div>
        </div>

        {/* ── 3. THE MANEUVER TIMELINE ─────────────────────────────────────
            Below `sm` it only exists once the sheet is expanded: at the peek
            height there is no room for it, and a collapsible inside a
            collapsible is two gestures to reach one list. On a console it
            opens by default while nobody is driving and starts collapsed once
            a session does — a dispatcher inspecting a plotted route wants the
            whole sequence, an officer driving has the banner and needs the
            MAP. */}
        <div className={`${expanded ? 'block' : 'hidden'} sm:block`}>
          <RouteSteps steps={result?.steps} activeIndex={progress?.step?.index ?? -1} defaultOpen={!navigating} />
        </div>
      </div>

      {/* ── 4. THE ACTION BAR ────────────────────────────────────────────
          OUTSIDE the scroller and `shrink-0`, so the controls stay on screen
          at every sheet height and at every route length. A thirty-maneuver
          route must not push Exit navigation below the fold on a phone. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline p-3">
        {navigating ? (
          <>
            {/* ── REPEAT, WHERE MUTE USED TO BE ───────────────────────────
                Mute is gone by protocol: spoken guidance stays on for the
                whole of a navigation session, so a control whose only job was
                to switch it off had nothing left to do.

                Removing it and leaving a gap would have been the wrong read
                of why anyone pressed it. An officer reaching for Mute
                mid-drive is almost never saying "I want silence" — they are
                saying "that prompt was no use to me", and overwhelmingly
                because they missed it: a door slammed, a radio talked over
                it, they were parking. The useful answer is the instruction
                AGAIN, not less of it. */}
            <button
              type="button"
              onClick={onRepeat}
              disabled={!voiceSupported || !onRepeat}
              className="btn btn-action btn-outline flex-1 sm:flex-none"
              title={
                voiceSupported
                  ? 'Say the current instruction again'
                  : 'This browser has no speech synthesis. The written steps are unaffected.'
              }
            >
              <Volume2 size="sm" aria-hidden="true" />
              Repeat
            </button>

            {/* ── A WASH, NOT A SOLID RED ─────────────────────────────────
                The shared stylesheet defines `.btn-danger` as a danger-tinted
                wash with danger-coloured type and states, in so many words,
                that a danger button is "never white on a solid danger fill" —
                a rule that exists because the two consoles reserve solid red
                for the SOS plate alone. It is still the loudest control in
                this bar: it is the only coloured one.

                `flex-1` below `sm` so the pair fills the sheet's width as two
                equal targets — at 375px a right-aligned pair leaves a dead
                strip between them that is neither a gap nor a button. */}
            <button
              type="button"
              onClick={onToggleNavigation}
              aria-pressed
              className="btn btn-action btn-danger flex-1 sm:ml-auto sm:flex-none"
            >
              <X size="sm" aria-hidden="true" />
              Exit navigation
            </button>
          </>
        ) : (
          <>
            {/* START NAVIGATION, which is one action over two that already
                existed. Following the camera and speaking the turns were
                separate toggles in the controls drawer, and both are still
                there for a dispatcher who wants one without the other. But an
                officer about to drive wants both, at the moment the route
                appears, without opening a collapsed panel to find them.

                Pressing it is also what transforms the map marker — the
                standby ring around the unit becomes a heading arrow (see
                `navigationArrowImage` in IncidentMap). That is the only
                visible confirmation an officer gets that the session started,
                so the two must stay wired to this one control. */}
            {result && onToggleNavigation ? (
              <button
                type="button"
                onClick={onToggleNavigation}
                className="btn btn-action btn-brand flex-1 sm:flex-none"
              >
                <Navigation size="sm" aria-hidden="true" />
                Start navigation
              </button>
            ) : null}

            <SegmentedControl
              ariaLabel="Routing profile"
              className="shrink-0 sm:ml-auto"
              options={PROFILE_OPTIONS}
              value={profile}
              onChange={onChangeProfile}
            />
          </>
        )}
      </div>
    </div>
  )
}
