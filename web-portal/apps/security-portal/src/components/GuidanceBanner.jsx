import { GUIDANCE_BANNER } from '@shared/theme/dispatchColors'
import { ManeuverGlyph } from '@/components/RouteSteps'
import { formatDistance } from '@/lib/directions'
import { WAYPOINT_RADIUS_M } from '@/lib/routeProgress'

/**
 * The turn-guidance HUD: the next maneuver and the metres to it, on its own
 * dark plate across the top of the map.
 *
 * ── WHY IT IS ITS OWN COMPONENT AND ITS OWN SLOT ───────────────────────────
 * It was a section of the route panel, which was right while that panel lived
 * at the top of the map on every screen. It no longer does: below `sm` the
 * panel is a bottom sheet, and a turn banner is the one thing that must NOT
 * follow it down there. A driver's eyes go up and slightly right, to roughly
 * where a rear-view mirror is; the bottom of the screen is where a thumb
 * rests and where a sheet can be dragged over.
 *
 * So the two separated, and the split is along a line that was already there:
 * the banner and the panel are read by two different people at two different
 * speeds. The officer driving reads the banner and nothing else. The
 * dispatcher reads the panel.
 *
 * ── TOUCH TARGETS, DELIBERATELY ABSENT ─────────────────────────────────────
 * Nothing here is pressable and nothing here should be. It sits directly
 * under where a thumb reaches on a phone propped in a windscreen cradle, and
 * the one thing worse than a driver reading a banner is a driver tapping one.
 */
export default function GuidanceBanner({ maneuver, waypointM = null }) {
  if (!maneuver) return null

  const instruction = maneuver.upcoming?.instruction ?? 'Continue'

  return (
    <div
      // `p-3 sm:p-4` and a smaller glyph tile below `sm`: at 375px the 44px
      // tile plus 16px of padding either side left the instruction 255px,
      // which clipped "Turn right onto Phase 1 Main Road" mid-word. The
      // countdown keeps its size at every width — it is the number read at
      // speed and it is the last thing that should give way.
      className="pointer-events-none w-full max-w-md rounded-2xl p-3 shadow-xl sm:p-4"
      style={{ backgroundColor: GUIDANCE_BANNER.plate, color: GUIDANCE_BANNER.ink }}
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11"
          style={{ backgroundColor: GUIDANCE_BANNER.tile }}
        >
          <ManeuverGlyph size="lg" icon={maneuver.upcoming?.icon} />
        </span>
        <div className="min-w-0 flex-1">
          {/* THE DISTANCE IS THE LARGEST THING ON THE CONSOLE, and the
              instruction sits under it.

              A driver approaching a junction already knows what they are
              about to do; they read this to find out WHEN. So the countdown
              gets the display type and the sentence confirms it. On the last
              step there is no countdown to show, so the instruction takes the
              top line instead of leaving a hole. */}
          {!maneuver.isLast ? (
            <>
              <p className="truncate text-2xl font-semibold leading-none tabular-nums">
                {formatDistance(maneuver.distanceToManeuver)}
              </p>
              {/* `line-clamp-2` rather than `truncate` below `sm`: a
                  subdivision road name is long and a phone is narrow, and an
                  instruction cut off at "Turn right onto Phase 1 Main…" has
                  lost the part that distinguishes it from the next junction.
                  Two lines cost 18px and the banner has them. */}
              <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug sm:truncate">
                {instruction}
              </p>
              {/* ── WHY THE BANNER HAS NOT MOVED ON ────────────────────────
                  The console will not advance to the next instruction until
                  the unit has physically reached this corner (see
                  `gateStepIndex`). That is the right behaviour and it is
                  invisible: an officer who cut through a car park and
                  rejoined past the junction sees a banner apparently stuck on
                  a turn they already made, with nothing saying why.

                  So on the one occasion the two figures disagree — the
                  along-the-route countdown is near zero while the
                  straight-line distance to the corner is not — the banner
                  says what it is waiting for. The rest of the time this line
                  is absent, because the two agree and repeating a figure is
                  worse than omitting it. */}
              {waypointM != null && waypointM > WAYPOINT_RADIUS_M && maneuver.distanceToManeuver < 20 ? (
                <p
                  className="mt-1 truncate text-2xs leading-snug"
                  style={{ color: GUIDANCE_BANNER.inkMuted }}
                >
                  Waiting to reach the junction · {formatDistance(waypointM)} off
                </p>
              ) : null}
            </>
          ) : (
            <p className="line-clamp-2 text-lg font-semibold leading-tight">{instruction}</p>
          )}
        </div>
      </div>
    </div>
  )
}
