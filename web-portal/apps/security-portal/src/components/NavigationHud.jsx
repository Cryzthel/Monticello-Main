import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Navigation,
  RotateCcw,
  RotateCw,
  Volume2,
  X,
} from '@shared/icons'
import { arrivalAt, formatClockTime, formatDistance, formatDuration } from '@/lib/directions'
import { useMetricsClock } from '@/hooks/useMetricsClock'

/**
 * THE NAVIGATION HUD — the one card on the map while a session runs.
 *
 *   ┌ [↰]  In 120 m                                    [✕ Exit] ┐
 *   │      Turn left onto Acacia Street                         │
 *   ├───────────────────────────────────────────────────────────┤
 *   │  ETA 10:42 PM     1.2 km left     4 min          🔊        │
 *   │  ● Phase 1 · Block 2 · Lot 1     10.76012, 122.50034      │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Route telemetry, by request (2026-10-19): the current step, ETA, distance
 * left and the destination with its coordinates — nothing else. The same
 * step is spoken aloud by useVoiceGuidance; the speaker glyph only says that
 * voice is on (there is deliberately no mute — see DashboardPage).
 *
 * Every figure comes from `progress` (lib/routeProgress), computed from the
 * officer's REAL fix — nothing advances because time passed. With no fix yet
 * the figures fall back to the plotted route's own, and the dot turns amber.
 *
 * A dark glass plate in both themes, like the other map overlays. Text is
 * `white/…`, never light slates: those are remapped to dark tones in the dark
 * theme.
 */

/** Glyph per maneuver key (see MANEUVER_ICONS in lib/directions). */
const GLYPHS = {
  depart: Navigation,
  arrive: Flag,
  left: CornerUpLeft,
  right: CornerUpRight,
  'sharp-left': ArrowLeft,
  'sharp-right': ArrowRight,
  'slight-left': ArrowUpLeft,
  'slight-right': ArrowUpRight,
  straight: ArrowUp,
  uturn: RotateCcw,
  roundabout: RotateCw,
}

/** The step to show: live from progress, else the route's first maneuver. */
function currentStep(progress, plotted) {
  if (progress?.step) {
    return { instruction: progress.step.upcoming?.instruction, icon: progress.step.upcoming?.icon, distanceM: progress.step.distanceToManeuver }
  }
  const steps = plotted?.steps ?? []
  const next = steps[1] ?? steps[0]
  if (!next) return null
  return { instruction: next.instruction, icon: next.icon, distanceM: steps[1] ? steps[0]?.distance : null }
}

export default function NavigationHud({ route, progress, offRoute = false, targetLabel, destination = null, voice = true, onExit }) {
  const now = useMetricsClock(15_000)
  const plotted = route?.route ?? null
  const remainingM = progress?.remainingM ?? plotted?.distance ?? null
  const remainingS = progress?.remainingDurationS ?? plotted?.duration ?? null
  const isLast = progress?.step?.isLast ?? (plotted?.steps?.length ?? 0) <= 1
  const arrived = isLast && Number.isFinite(remainingM) && remainingM <= 30
  const live = Boolean(progress) && !offRoute
  const step = currentStep(progress, plotted)
  const Glyph = arrived ? Flag : GLYPHS[step?.icon] ?? ArrowUp
  const eta = arrivalAt(remainingS, now)
  const [lng, lat] = Array.isArray(destination) ? destination : [null, null]

  return (
    <section
      aria-label="Navigation"
      className="pointer-events-auto w-full overflow-hidden rounded-t-2xl border border-white/10 bg-zinc-950/90 text-white shadow-2xl backdrop-blur-2xl animate-[riseIn_220ms_var(--ease-spring)] motion-reduce:animate-none sm:max-w-md sm:rounded-2xl"
    >
      {/* THE STEP — what to do next, and how far away it is. */}
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <span
          aria-hidden="true"
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
            arrived ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'
          }`}
        >
          <Glyph size={22} />
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          {arrived ? (
            <p className="text-lg font-semibold leading-tight text-emerald-300">You have arrived</p>
          ) : (
            <>
              <p className="text-lg font-semibold leading-tight tabular-nums">
                {Number.isFinite(step?.distanceM) ? `In ${formatDistance(step.distanceM)}` : 'Head to the call'}
              </p>
              <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-white/75">
                {step?.instruction ?? 'Follow the highlighted route.'}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 ring-1 ring-inset ring-red-400/30 transition-[background-color,transform] duration-150 ease-out hover:bg-red-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 active:scale-[0.97]"
        >
          <X size="sm" aria-hidden="true" />
          Exit
        </button>
      </div>

      {/* THE SUMMARY — ETA, distance left, time left, destination. */}
      <div className="border-t border-white/10 bg-white/[0.03] px-4 py-2.5">
        <dl className="flex items-baseline gap-4 text-xs tabular-nums">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-white/50">ETA</dt>
            <dd className="font-semibold text-white/90">{eta ? formatClockTime(eta) : '—'}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dd className="font-semibold text-white/90">{formatDistance(remainingM)}</dd>
            <dt className="text-white/50">left</dt>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dd className="font-semibold text-white/90">{formatDuration(remainingS)}</dd>
          </div>
          {voice ? (
            <Volume2 size={14} className="ml-auto self-center text-white/45" aria-label="Voice guidance on" />
          ) : null}
        </dl>
        <p className="mt-1.5 flex min-w-0 items-center gap-2 text-xs">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${
              live ? 'animate-pulse bg-emerald-400 motion-reduce:animate-none' : 'bg-amber-300'
            }`}
          />
          <span className="min-w-0 truncate font-medium text-white/85">
            {offRoute ? <span className="text-amber-300">Off route · </span> : null}
            {!progress ? <span className="text-amber-300">Waiting for GPS · </span> : null}
            {targetLabel}
          </span>
          {Number.isFinite(lat) && Number.isFinite(lng) ? (
            <span className="ml-auto shrink-0 font-mono text-[11px] text-white/45">
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </span>
          ) : null}
        </p>
      </div>
    </section>
  )
}
