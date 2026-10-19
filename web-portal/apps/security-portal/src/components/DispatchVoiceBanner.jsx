import { Volume2, VolumeX } from '@shared/icons'

/**
 * THE DISPATCH MAP'S TOP LABEL — the classic header strip restored
 * (2026-10-19, by request): one line saying what the console is doing and
 * what to do next, with the voice-guidance state beside it so a guard knows,
 * hands-free, whether directions will be spoken.
 *
 *   ┌ [🔊]  In 50 m, turn right onto Phase 1 Main Boulevard   (Voice on) ┐
 *
 * `tone`: 'idle' (a prompt), 'route' (a route is ready), 'nav' (navigating),
 * 'alert' (an SOS is waiting, or a report just arrived). `action` adds one
 * button, e.g. View on a new report. A dark HUD plate in both themes, like the
 * other map overlays.
 */
export default function DispatchVoiceBanner({
  message,
  tone = 'idle',
  voiceOn,
  voiceSupported,
  onToggleVoice,
  simulating = false,
  action = null,
}) {
  const accent =
    tone === 'alert' ? 'text-red-300' : tone === 'nav' || tone === 'route' ? 'text-emerald-400' : 'text-white/75'
  return (
    <div
      className="pointer-events-none flex w-full max-w-xl items-center gap-2.5 rounded-full border border-slate-800/80 bg-slate-900/80 py-1.5 pl-2 pr-1.5 text-white shadow-lg backdrop-blur-md"
      role="status"
      aria-live="polite"
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          voiceOn && voiceSupported ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-800 text-slate-400'
        }`}
        aria-hidden="true"
      >
        {voiceOn && voiceSupported ? <Volume2 size="sm" /> : <VolumeX size="sm" />}
      </span>
      <p className={`min-w-0 flex-1 truncate text-xs font-semibold ${accent}`}>{message}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="pointer-events-auto shrink-0 rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200 ring-1 ring-inset ring-red-400/40 transition-colors hover:bg-red-500/30"
        >
          {action.label}
        </button>
      ) : null}
      {simulating ? (
        <span className="shrink-0 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-inset ring-amber-400/30">
          Simulated
        </span>
      ) : null}
      {voiceSupported ? (
        <button
          type="button"
          onClick={onToggleVoice}
          aria-pressed={voiceOn}
          aria-label={voiceOn ? 'Mute voice directions' : 'Turn on voice directions'}
          className={`pointer-events-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors ${
            voiceOn
              ? 'bg-emerald-400/15 text-emerald-400 ring-emerald-400/30 hover:bg-emerald-400/25'
              : 'bg-slate-800 text-white/75 ring-slate-700 hover:bg-slate-700'
          }`}
        >
          {voiceOn ? 'Voice on' : 'Voice off'}
        </button>
      ) : (
        <span className="shrink-0 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-400">No voice</span>
      )}
    </div>
  )
}
