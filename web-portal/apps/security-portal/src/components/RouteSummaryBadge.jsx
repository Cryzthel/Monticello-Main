import {
  Bike,
  FlaskConical,
  Footprints,
  Loader2,
  MoveRight,
  Navigation,
  ShieldAlert,
  TriangleAlert,
} from '@shared/icons'
import SegmentedControl from '@shared/components/SegmentedControl'
import { staffLabel } from '@shared/lib/identity'
import { ROUTE_TONE_COLORS } from '@shared/theme/dispatchColors'
import RouteSteps, { ManeuverGlyph } from '@/components/RouteSteps'
import { ROUTE_PROFILES, formatDistance, formatDuration, routeProfile } from '@/lib/directions'
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
 * The dispatch navigation card, floated top-centre over the Live Dispatch map.
 *
 * ── WHAT A UNIT IN MOTION NEEDS, IN ORDER ───────────────────────────────────
 * Once a unit is moving this stops being a summary and becomes navigation, so
 * it is ordered the way a driver reads it rather than the way the data arrives:
 *
 *   1. THE NEXT TURN         "Turn right" · 100 m, in the largest type here
 *   2. how long and how far  "2 min · 680 m", live, counting down
 *   3. who and where         the unit, and the address it is going to
 *   4. the rest of the route collapsed underneath (see RouteSteps)
 *
 * Before the unit has a fix on the line there is no next turn to show, so the
 * card falls back to leading with the summary figures — which is what it was
 * before, and the right shape for a preview nobody is driving yet.
 *
 * ── THE FIGURES ARE LIVE, AND ONLY WHEN THEY CAN BE ─────────────────────────
 * `progress` is computed from the unit's own telemetry fix (see
 * `routeProgress`). It is null whenever there is no usable fix, and every
 * live figure then falls back to the route's original numbers rather than to
 * a guess. Nothing here advances because time passed.
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
export default function RouteSummaryBadge({ route, progress, profile, targetLabel, onChangeProfile, simulated = false }) {
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

  let headline = 'Plotting the route…'
  if (route.phase === 'no-origin') headline = 'No position'
  else if (route.phase === 'error') headline = 'No route'
  else if (result) headline = `${formatDuration(durationS)} · ${formatDistance(distanceM)}`

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
    <div className="pointer-events-auto flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-hairline bg-base-900 shadow-lg">
      {/* ── NEXT TURN ─────────────────────────────────────────────────────
          The one thing a moving unit needs, given the whole top of the card.
          `text-base` against the `text-label` below it is the hierarchy doing
          the work: at a glance the instruction is the card, and the ETA is
          supporting detail rather than the other way round. */}
      {maneuver ? (
        <div className="flex items-center gap-3 border-b border-hairline bg-base-800 px-3 py-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: `${color}26`, color }}
          >
            <ManeuverGlyph size="md" icon={maneuver.upcoming?.icon} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold leading-tight text-text-primary">
              {maneuver.upcoming?.instruction ?? 'Continue'}
            </p>
            {!maneuver.isLast ? (
              <p className="mt-0.5 text-caption leading-snug text-text-secondary">
                in <span className="tabular-nums">{formatDistance(maneuver.distanceToManeuver)}</span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* A second, unmissable statement on the card itself. The pill above
          is the one that must be right; this is the one that explains it. */}
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

      <div className="flex min-w-0 items-center gap-3 p-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={failed ? undefined : { backgroundColor: `${color}26`, color }}
        >
          <StateIcon
            size="sm"
            className={`${pending ? 'animate-spin' : ''} ${failed ? 'text-warning' : ''}`}
          />
        </span>

        {/* The live region is the text alone, so the profile toggle is not
            re-announced every time a moving unit's route refreshes. */}
        <div className="min-w-0 flex-1" aria-live="polite">
          {/* `flex-wrap`: "Simulated" is a wider pill than "Live", and at the
              card's 448px it pushed the row into the profile toggle beside it
              — measured, at the real width, not a hypothetical narrow one.
              Wrapping costs one line in the rare case and never overlaps; the
              figures keep `whitespace-nowrap` so they are never what breaks. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="whitespace-nowrap text-label font-semibold leading-tight tabular-nums text-text-primary">
              {headline}
            </p>

            {/* ── THE BADGE REPLACES "LIVE", IT DOES NOT SIT BESIDE IT ──────
                While the simulator is running these figures come from a clock,
                not from a device. The pill that would otherwise assert the
                opposite is therefore the pill that has to change: an amber
                "Simulated" in the same slot, with no pulse, because the pulse
                is this card's way of saying a real unit is moving.

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

          {problem ? (
            <p className="mt-0.5 text-caption leading-snug text-warning">{problem}</p>
          ) : (
            /* unit ➔ address. `MoveRight` rather than a typed arrow so it keeps
               the icon stroke weight and is hidden from a screen reader, which
               reads the two labels either side as the sentence they are. */
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption leading-snug text-text-secondary">
              {/* The ORIGIN is the one that gives way.
                  Both were `truncate` with equal claim on the row, so the two
                  shared the shortfall and a long unit name cost the officer the
                  end of the address. Where they are going is the reason to read
                  this line, so the destination holds its width and the name
                  clips — capped at 65% so a long address cannot push the name
                  out entirely.

                  `min-w-0 truncate`, NOT `flex-1`: growing the name pushed the
                  arrow and the address out to the right edge whenever the name
                  was short, so the two halves of one phrase sat at opposite
                  ends of the card with a hole between them. */}
              <span className="min-w-0 truncate">{fromLabel}</span>
              <MoveRight size="sm" aria-hidden="true" className="shrink-0 text-text-muted" />
              <span className="max-w-[65%] shrink-0 truncate font-medium text-text-primary">
                {targetLabel || 'the call'}
              </span>
            </p>
          )}
        </div>

        <SegmentedControl
          ariaLabel="Routing profile"
          className="shrink-0"
          options={PROFILE_OPTIONS}
          value={profile}
          onChange={onChangeProfile}
        />
      </div>

      <RouteSteps steps={result?.steps} activeIndex={maneuver?.index ?? -1} />
    </div>
  )
}
