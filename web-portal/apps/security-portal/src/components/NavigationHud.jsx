import { X } from '@shared/icons'
import { formatDistance, formatDuration } from '@/lib/directions'

/**
 * THE NAVIGATION HUD — the one card on the map while a session runs
 * (2026-10-19, by request; replaced the turn-by-turn NavigationModal, its
 * Voice and Simulate drive toggles, and the top turn banner):
 *
 *   ┌ ● Phase 1 · Block 2 · Lot 1                      [✕ Exit navigation] ┐
 *   │   580 m left · 1 min                                                  │
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 * Every figure comes from `progress` (lib/routeProgress), computed from the
 * officer's REAL fix — nothing here advances because time passed. With no fix
 * yet the figures fall back to the plotted route's own, and the dot turns
 * amber to say so. Spoken turn prompts still run for the session
 * (useVoiceGuidance); the card is what a glance needs, not a second
 * instruction panel.
 *
 * A dark glass plate in both themes, like the other map overlays. Text is
 * `white/…`, never light slates: those are remapped to dark tones in the dark
 * theme.
 */
export default function NavigationHud({ route, progress, offRoute = false, targetLabel, onExit }) {
  const plotted = route?.route ?? null
  const remainingM = progress?.remainingM ?? plotted?.distance ?? null
  const remainingS = progress?.remainingDurationS ?? plotted?.duration ?? null
  const isLast = progress?.step?.isLast ?? (plotted?.steps?.length ?? 0) <= 1
  const arrived = isLast && Number.isFinite(remainingM) && remainingM <= 30
  const live = Boolean(progress) && !offRoute

  const status = arrived ? (
    <span className="font-semibold text-emerald-400">You have arrived</span>
  ) : (
    <>
      {offRoute ? <span className="font-semibold text-amber-300">Off route · </span> : null}
      {!progress ? <span className="text-amber-300">Waiting for GPS · </span> : null}
      <span className="font-semibold text-white/90">{formatDistance(remainingM)} left</span>
      <span aria-hidden="true"> · </span>
      <span>{formatDuration(remainingS)}</span>
    </>
  )

  return (
    <section
      aria-label="Navigation"
      className="pointer-events-auto flex w-full items-center gap-3 rounded-t-2xl border border-white/10 bg-slate-900/85 py-3 pl-4 pr-3 text-white shadow-2xl backdrop-blur-md animate-[riseIn_220ms_var(--ease-spring)] motion-reduce:animate-none sm:max-w-sm sm:rounded-2xl"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${
              live ? 'animate-pulse bg-emerald-400 motion-reduce:animate-none' : 'bg-amber-300'
            }`}
          />
          <span className="truncate text-sm font-semibold">{targetLabel}</span>
        </p>
        <p className="mt-0.5 truncate pl-4 text-xs tabular-nums text-white/60" aria-live="polite">
          {status}
        </p>
      </div>
      <button
        type="button"
        onClick={onExit}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 ring-1 ring-inset ring-red-400/30 transition-[background-color,transform] duration-150 ease-out hover:bg-red-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 active:scale-[0.97]"
      >
        <X size="sm" aria-hidden="true" />
        Exit navigation
      </button>
    </section>
  )
}
