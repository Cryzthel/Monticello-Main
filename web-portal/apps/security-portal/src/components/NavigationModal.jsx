import { Flag, Minimize2, Pause, Play, Volume2, VolumeX, X } from '@shared/icons'
import ManeuverGlyph from '@/components/ManeuverGlyph'
import { formatDistance, formatDuration } from '@/lib/directions'
import { formatTime } from '@shared/lib/dates'

/**
 * THE START NAVIGATION OVERLAY — the turn-by-turn view a session opens into
 * (2026-10-19, by request), docked in the map's sheet slot so the map, the
 * route and the moving marker stay visible above it:
 *
 *   ┌ NAVIGATING TO  Phase 1 · Block 4 · Lot 12      (● Live)  [–] ┐
 *   │ [↱]  50 m                                                      │
 *   │      Turn right onto Phase 1 Main Boulevard                    │
 *   │      Then: Turn left onto Acacia Street                        │
 *   │ ▓▓▓▓▓▓▓▓░░░░░░  620 m left · 3 min · arrive 10:42 AM           │
 *   │ [🔊 Voice on]  [▶ Simulate drive]            [✕ Exit]          │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Every figure comes from `progress` (lib/routeProgress), computed from the
 * officer's real fix — or, while "Simulate drive" is on, from the pretend
 * unit in useRouteSimulation, which is then labelled "Simulated" in amber
 * here and in the top banner. A dark HUD plate in both themes, like the turn
 * banner it replaces while open.
 */
export default function NavigationModal({
  route,
  progress,
  offRoute = false,
  targetLabel,
  targetDetail,
  simulating,
  onToggleSimulation,
  voiceOn,
  voiceSupported,
  onToggleVoice,
  onMinimize,
  onExit,
}) {
  const plotted = route?.route ?? null
  const steps = plotted?.steps ?? []
  const step = progress?.step ?? null
  const upcoming = step?.upcoming ?? steps[0] ?? null
  const then = step ? steps[step.index + 2] ?? null : steps[1] ?? null
  const isLast = step?.isLast ?? steps.length <= 1
  const countdownM = step ? step.distanceToManeuver : steps[0]?.distance ?? null
  const remainingM = progress?.remainingM ?? plotted?.distance ?? null
  const remainingS = progress?.remainingDurationS ?? plotted?.duration ?? null
  const fraction = Math.min(1, Math.max(0, progress?.fraction ?? 0))
  const arrival = Number.isFinite(remainingS) ? formatTime(new Date(Date.now() + remainingS * 1000)) : null
  const arrived = isLast && Number.isFinite(remainingM) && remainingM <= 30

  return (
    <section
      aria-label="Turn-by-turn navigation"
      className="pointer-events-auto w-full overflow-hidden rounded-t-2xl border border-slate-800/80 bg-slate-900/90 text-white shadow-2xl backdrop-blur-md sm:max-w-md sm:rounded-2xl"
    >
      {/* ── DESTINATION ── */}
      <header className="flex items-start gap-3 border-b border-slate-800/80 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400">Navigating to</p>
          <p className="truncate text-sm font-semibold text-white">{targetLabel}</p>
          {targetDetail ? <p className="truncate text-xs text-slate-400">{targetDetail}</p> : null}
        </div>
        {simulating ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-inset ring-amber-400/30">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
            Simulated
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-400/30">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
            Live
          </span>
        )}
        <button
          type="button"
          onClick={onMinimize}
          aria-label="Minimise directions"
          title="Minimise directions"
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
        >
          <Minimize2 size="sm" />
        </button>
      </header>

      {/* ── THE NEXT MANEUVER: the countdown is the largest thing, read at speed ── */}
      <div className="flex items-start gap-4 px-4 py-4" aria-live="polite">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-400/25">
          {arrived ? <Flag size="lg" aria-hidden="true" /> : <ManeuverGlyph size="lg" icon={upcoming?.icon} />}
        </span>
        <div className="min-w-0 flex-1">
          {arrived ? (
            <p className="text-2xl font-bold leading-tight text-emerald-400">You have arrived</p>
          ) : offRoute ? (
            <>
              <p className="text-lg font-bold leading-tight text-amber-300">Off route</p>
              <p className="mt-1 text-sm text-white/75">Head back to the highlighted line — the route re-plots from where you are.</p>
            </>
          ) : (
            <>
              {!isLast && Number.isFinite(countdownM) ? (
                <p className="text-4xl font-bold leading-none tracking-tight tabular-nums text-white">
                  {formatDistance(countdownM)}
                </p>
              ) : null}
              <p className="mt-1.5 line-clamp-2 text-base font-semibold leading-snug text-white">
                {upcoming?.instruction ?? 'Head to the destination'}
                {!isLast && Number.isFinite(countdownM) ? (
                  <span className="font-normal text-slate-400"> in {formatDistance(countdownM)}</span>
                ) : null}
              </p>
              {then ? (
                <p className="mt-1 truncate text-xs text-slate-400">
                  Then: <span className="text-white/75">{then.instruction}</span>
                </p>
              ) : null}
              {!progress ? (
                <p className="mt-1 text-xs text-amber-300">Waiting for your position — figures are the route&apos;s own.</p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* ── HOW FAR, HOW LONG ── */}
      <div className="px-4 pb-3">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-label="Route travelled"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${fraction * 100}%` }} />
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
          <span className="font-semibold tabular-nums text-white/90">{formatDistance(remainingM)} left</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{formatDuration(remainingS)}</span>
          {arrival ? (
            <>
              <span aria-hidden="true">·</span>
              <span>arrive {arrival}</span>
            </>
          ) : null}
        </p>
      </div>

      {/* ── CONTROLS ── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/80 px-4 py-3">
        <button
          type="button"
          onClick={onToggleVoice}
          disabled={!voiceSupported}
          aria-pressed={voiceOn}
          title={voiceSupported ? undefined : 'This browser has no speech synthesis.'}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors disabled:opacity-50 ${
            voiceOn
              ? 'bg-emerald-400/15 text-emerald-400 ring-emerald-400/30 hover:bg-emerald-400/25'
              : 'bg-slate-800 text-white/75 ring-slate-700 hover:bg-slate-700'
          }`}
        >
          {voiceOn ? <Volume2 size="sm" aria-hidden="true" /> : <VolumeX size="sm" aria-hidden="true" />}
          {voiceSupported ? (voiceOn ? 'Voice on' : 'Voice off') : 'No voice'}
        </button>
        <button
          type="button"
          onClick={onToggleSimulation}
          disabled={!plotted}
          aria-pressed={simulating}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors disabled:opacity-50 ${
            simulating
              ? 'bg-amber-400/15 text-amber-300 ring-amber-400/30 hover:bg-amber-400/25'
              : 'bg-slate-800 text-white/75 ring-slate-700 hover:bg-slate-700'
          }`}
        >
          {simulating ? <Pause size="sm" aria-hidden="true" /> : <Play size="sm" aria-hidden="true" />}
          {simulating ? 'Stop simulation' : 'Simulate drive'}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 ring-1 ring-inset ring-red-400/30 transition-colors hover:bg-red-500/25"
        >
          <X size="sm" aria-hidden="true" />
          Exit
        </button>
      </div>
    </section>
  )
}
