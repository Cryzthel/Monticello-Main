import {
  Bike,
  Clock,
  FlaskConical,
  Footprints,
  Loader2,
  Maximize2,
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
import { GUIDANCE_BANNER, ROUTE_TONE_COLORS } from '@shared/theme/dispatchColors'
import RouteSteps, { ManeuverGlyph } from '@/components/RouteSteps'
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
import { isOffRoute } from '@/lib/routeProgress'

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
 * One figure in the telemetry header: the number, then what it is.
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
 * that constraint for no gain: the "Live" capsule two rows down already says
 * what the colour was saying, and a figure that changes hue invites the reader
 * to hunt for a meaning that is not there.
 */
function Telemetry({ icon: Icon, label, value, strong = false }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <p
        className={`truncate tabular-nums font-semibold leading-tight text-text-primary ${
          strong ? 'text-xl' : 'text-base'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 flex items-center gap-1 truncate text-2xs font-medium leading-none text-text-muted">
        <Icon size="sm" aria-hidden="true" className="shrink-0" />
        {label}
      </p>
    </div>
  )
}

/**
 * The dispatch navigation panel, floated top-centre over the Live Dispatch map.
 *
 * ── A SUMMARY BADGE THAT GREW INTO AN INSPECTION SHEET ──────────────────────
 * This started as one row — "2 min · 680 m" and a transport glyph — and
 * accreted a turn banner, a simulation notice, an off-route notice, a profile
 * toggle and a steps list, each squeezed into the same single-row card. The
 * result read as a sentence with four clauses bolted on: everything was
 * present and nothing was findable, because every element had the same visual
 * weight as every other.
 *
 * It is now four stacked sections with a clear rank, read top to bottom in the
 * order a response actually needs them:
 *
 *   0. THE GUIDANCE BANNER    the next turn and the metres to it, on its own
 *                             dark plate ABOVE the panel. Only while a session
 *                             is running — it is the one thing read at speed,
 *                             so it gets the loudest surface on the console
 *                             and nothing shares it.
 *   1. SUMMARY TELEMETRY      ETA, distance left, and the wall-clock arrival
 *                             time, as three equal figures.
 *   2. THE DESTINATION        where the unit is going, who is going, and what
 *                             stage the call is at.
 *   3. THE MANEUVER TIMELINE  every step, as a vertical sequence (RouteSteps).
 *   4. THE ACTION BAR         what the officer can do about any of it.
 *
 * ── THE FIGURES ARE LIVE, AND ONLY WHEN THEY CAN BE ─────────────────────────
 * `progress` is computed from the unit's own telemetry fix (see
 * `routeProgress`). It is null whenever there is no usable fix, and every
 * live figure then falls back to the route's original numbers rather than to
 * a guess. Nothing here advances because time passed — with ONE deliberate
 * exception, the arrival clock, which is a function of now by definition and
 * owns a ticking clock for exactly that reason (see `arrivalAt`).
 *
 * ── "LIVE" IS A CAPSULE, NOT COLOURED TEXT ──────────────────────────────────
 * It used to be a bold green word leading the context line, which put the most
 * important state in this card — is a unit actually moving towards this call —
 * in the smallest type on it, inside the line that truncates first. The pulse
 * is `motion-safe`: this sits over a map an operator watches for a whole
 * shift, and a dot that never stops moving is a reason to look away from it.
 *
 * ── AN OFFICER'S EMAIL IS NOT THEIR NAME ────────────────────────────────────
 * The unit label goes through `staffLabel`. Accounts here are provisioned by
 * email and `staff_accounts.name` often holds the address, so this card would
 * otherwise print a personal contact detail over a map anyone at the
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
  voice = false,
  voiceSupported = true,
  onToggleVoice,
  onOverview,
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

  const problem =
    route.phase === 'no-origin'
      ? `${unitName} is not sharing a position — no GPS fix, or location sharing is off.`
      : route.phase === 'error'
        ? route.error
        : null

  const fromLabel = route.originSource === 'guardhouse' ? `${unitName} · from the guardhouse` : unitName

  // The banner only appears once there is a real fix ON the route. A unit that
  // has wandered off it gets the off-route notice instead, because an
  // instruction computed from a position that is not on the line is a
  // confident wrong turn.
  const offRoute = isOffRoute(progress)
  const maneuver = progress && !offRoute && progress.step ? progress.step : null

  return (
    <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
      {/* ── 0. THE GUIDANCE BANNER ────────────────────────────────────────
          A SEPARATE CARD, not a section of the panel below it. That is the
          one structural decision in this file worth defending: the banner
          and the panel are read by two different people at two different
          speeds. The officer driving reads the banner and nothing else; the
          dispatcher reads the panel. Giving the banner its own plate, its own
          corner radius and its own colour is what lets the first reader find
          it without reading anything around it.

          It appears only while a SESSION is running. A dispatcher inspecting
          a plotted route has the same instruction waiting in the timeline
          below, and a near-black banner over the map for a call nobody is
          driving to is a mode indicator asserting a mode that is off. */}
      {navigating && maneuver ? (
        <div
          className="flex items-center gap-3 rounded-2xl p-4 shadow-xl"
          style={{ backgroundColor: GUIDANCE_BANNER.plate, color: GUIDANCE_BANNER.ink }}
          aria-live="polite"
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: GUIDANCE_BANNER.tile }}
          >
            <ManeuverGlyph size="lg" icon={maneuver.upcoming?.icon} />
          </span>
          <div className="min-w-0 flex-1">
            {/* THE DISTANCE IS THE LARGEST THING ON THE CONSOLE, and the
                instruction sits under it — the opposite of the old in-panel
                row, which led with the sentence.

                A driver approaching a junction already knows what they are
                about to do; they read this to find out WHEN. So the countdown
                gets the display type and the sentence confirms it. On the last
                step there is no countdown to show, so the instruction takes
                the top line instead of leaving a hole. */}
            {!maneuver.isLast ? (
              <>
                <p className="truncate text-2xl font-semibold leading-none tabular-nums">
                  {formatDistance(maneuver.distanceToManeuver)}
                </p>
                <p className="mt-1.5 truncate text-sm font-medium leading-snug">
                  {maneuver.upcoming?.instruction ?? 'Continue'}
                </p>
              </>
            ) : (
              <p className="truncate text-lg font-semibold leading-tight">
                {maneuver.upcoming?.instruction ?? 'Continue'}
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col overflow-hidden rounded-xl border border-hairline bg-base-900 shadow-overlay">
        {/* A second, unmissable statement on the panel itself. The pill in the
            destination row is the one that must be right; this is the one that
            explains it. */}
        {simulated ? (
          <p className="flex items-center gap-2 border-b border-hairline bg-warning/15 px-3 py-2 text-caption font-medium text-warning">
            <FlaskConical size="sm" aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1">
              Simulated movement — this unit is not really here. Nothing is being recorded.
            </span>
          </p>
        ) : null}

        {offRoute ? (
          <p className="flex items-center gap-2 border-b border-hairline bg-warning/10 px-3 py-2 text-caption text-warning">
            <TriangleAlert size="sm" aria-hidden="true" className="shrink-0" />
            {/* Stated, not silently re-routed. Re-requesting Directions on every
                stray fix would burn the quota on GPS drift, and a guard taking a
                service road on purpose does not need the console to argue. */}
            <span className="min-w-0 flex-1">
              {unitName} is off the plotted route. The figures below still measure the original path.
            </span>
          </p>
        ) : null}

        {/* ── 1. SUMMARY TELEMETRY ───────────────────────────────────────
            Three figures, equal width, divided — so the eye lands on a row of
            numbers rather than on a sentence it has to parse.

            THE ARRIVAL CLOCK IS THE NEW ONE and it is not a restatement of
            the ETA. "6 min" is what a dispatcher needs to judge the response;
            "2:44 PM" is what they say out loud to the resident on the phone,
            and doing that subtraction in your head while watching a map is a
            thing a console should have already done.

            While routing or after a failure there are no figures, so the row
            is replaced outright rather than filled with em-dashes: three
            placeholder cells look like data that has gone wrong, where one
            sentence says what is actually happening. */}
        {result ? (
          <div
            className="grid grid-cols-3 divide-x divide-hairline border-b border-hairline"
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
        ) : (
          <div className="flex min-w-0 items-center gap-3 border-b border-hairline px-3 py-2.5">
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

        {/* ── 2. THE DESTINATION ─────────────────────────────────────────
            Where, who, and what stage — the three things that are NOT
            numbers, kept out of the figure row so neither has to compete.

            ── THE PILL SAYS "RESPONDING", NOT "EN ROUTE" ──────────────────
            The brief asked for En Route / Dispatched. This renders the
            console's own `StageBadge` instead, which says Dispatched /
            Responding / On-site, because that vocabulary is not cosmetic: it
            is the `dispatchStage` enum the rules enforce, the words the
            drawer two inches to the right prints, and the words the status
            log records. A pill reading "En Route" beside a stage chip reading
            "Responding" would be two names for one state on one screen, and
            the officer would reasonably wonder which one the system believes. */}
        <div className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
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
            {/* unit ➔ what kind of call. `MoveRight` rather than a typed arrow
                so it keeps the icon stroke weight and is hidden from a screen
                reader, which reads the two labels either side as the sentence
                they are.

                The ORIGIN is the one that gives way: both were `truncate` with
                equal claim on the row, so a long unit name cost the officer
                the end of the detail. */}
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
            {/* ── THE BADGE REPLACES "LIVE", IT DOES NOT SIT BESIDE IT ──────
                While the simulator is running these figures come from a clock,
                not from a device. The pill that would otherwise assert the
                opposite is therefore the pill that has to change: an amber
                "Simulated" in the same slot, with no pulse, because the pulse
                is this panel's way of saying a real unit is moving.

                Placing a separate notice elsewhere and leaving a green "Live"
                here was the obvious alternative and is exactly the failure
                worth avoiding — the eye takes the strongest signal, and a
                green pulsing dot beats a grey sentence every time. */}
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

        {/* ── 3. THE MANEUVER TIMELINE ───────────────────────────────────
            Open by default while nobody is driving, collapsed once a session
            starts. Those are two different readers again: a dispatcher
            inspecting a plotted route wants the whole sequence, and an
            officer driving has the banner above and needs the MAP — a list
            covering the thing it describes is the one thing this panel must
            not do at speed. Either way the officer's own press wins
            afterwards; this only sets where it starts. */}
        <RouteSteps steps={result?.steps} activeIndex={maneuver?.index ?? -1} defaultOpen={!navigating} />

        {/* ── 4. THE ACTION BAR ──────────────────────────────────────────
            Two bars, one slot. Before a session there is one thing to do and
            one setting to choose; during one there are three controls and no
            settings, because changing the routing graph mid-drive would
            re-plot the line under a moving officer.

            `flex-wrap`, measured rather than assumed: Unmute + Overview +
            Exit navigation comes to about 420px of buttons inside a 424px
            panel. It fits, with four pixels to spare — which is not a margin,
            it is luck. Wrapping costs one line in the case where a locale or
            a font makes a label wider, and never overlaps. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-3">
          {navigating ? (
            <>
              {/* ── ONE ICON, TWO STATES ────────────────────────────────
                  The brief asks for Volume2 / VolumeX. The icon registry is
                  GENERATED from one Phosphor set, deliberately matched to the
                  mobile app's, and it has no muted-speaker glyph — the same
                  constraint VoiceControl ran into and solved the same way.
                  Hand-adding one would put a glyph in the registry that
                  `build-icons.mjs` does not know about and the next
                  regeneration would silently drop it. So the state is carried
                  by the label and the button's tone. */}
              <button
                type="button"
                onClick={onToggleVoice}
                disabled={!voiceSupported}
                aria-pressed={voice}
                className={`btn btn-form ${voice ? 'btn-outline' : 'btn-success'}`}
                title={
                  voiceSupported
                    ? undefined
                    : 'This browser has no speech synthesis. The written steps are unaffected.'
                }
              >
                <Volume2 size="sm" aria-hidden="true" />
                {voice ? 'Mute' : 'Unmute'}
              </button>

              <button type="button" onClick={onOverview} className="btn btn-form btn-outline">
                <Maximize2 size="sm" aria-hidden="true" />
                Overview
              </button>

              {/* ── A WASH, NOT A SOLID RED ─────────────────────────────
                  The brief asks for a high-visibility red button. This is
                  `.btn-danger`, which the shared stylesheet defines as a
                  danger-tinted wash with danger-coloured type and states, in
                  so many words, that a danger button is "never white on a
                  solid danger fill" — a rule that exists because the two
                  consoles reserve solid red for the SOS plate alone
                  (--color-sos-plate), and a second solid red on screen makes
                  the one that means "somebody pressed panic" ordinary.

                  It is still the loudest control in this bar: it is the only
                  coloured one, and `ml-auto` sets it apart from the pair it
                  is not a peer of. */}
              <button
                type="button"
                onClick={onToggleNavigation}
                aria-pressed
                className="btn btn-form btn-danger ml-auto"
              >
                <X size="sm" aria-hidden="true" />
                Exit navigation
              </button>
            </>
          ) : (
            <>
              {/* START NAVIGATION, which is one action over two that already
                  existed.

                  Following the camera and speaking the turns were separate
                  toggles in the controls drawer, and both are still there for
                  a dispatcher who wants one without the other. But an officer
                  about to drive wants both, at the moment the route appears,
                  without opening a collapsed panel to find them — so this
                  turns on the pair.

                  It is on the ROUTE panel rather than on a marker popup
                  because this is the element that exists exactly when there is
                  something to navigate: no route, no panel, no button to press
                  by mistake.

                  Pressing it is also what transforms the map marker — the
                  standby ring around the unit becomes a heading arrow (see
                  `navigationArrowImage` in IncidentMap). That is the only
                  visible confirmation an officer gets that the session started,
                  so the two must stay wired to this one control. */}
              {result && onToggleNavigation ? (
                <button type="button" onClick={onToggleNavigation} className="btn btn-form btn-brand">
                  <Navigation size="sm" aria-hidden="true" />
                  Start navigation
                </button>
              ) : null}

              <SegmentedControl
                ariaLabel="Routing profile"
                className="ml-auto shrink-0"
                options={PROFILE_OPTIONS}
                value={profile}
                onChange={onChangeProfile}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
