import { Bell } from '@shared/icons'

/**
 * THE DISPATCH MAP'S TOP LABEL — shown only when there is something new to
 * act on (a report that just arrived), with one action button.
 *
 *   ┌ [🔔]  New fire report · Phase 1 · Block 2 · Lot 1            [View] ┐
 *
 * It used to be the voice-guidance strip too ("In 130 m, turn left…" with a
 * Voice on/off toggle and a Simulated chip). Those were removed 2026-10-19 by
 * request: navigation lives in the HUD and the spoken prompts. A dark glass
 * plate in both themes, like the other map overlays.
 */
export default function DispatchStatusBanner({ message, action = null }) {
  return (
    <div
      className="pointer-events-none flex w-full max-w-xl items-center gap-2.5 rounded-full border border-white/10 bg-slate-900/80 py-1.5 pl-2 pr-1.5 text-white shadow-lg backdrop-blur-md animate-[riseIn_220ms_var(--ease-spring)] motion-reduce:animate-none"
      role="status"
      aria-live="polite"
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300"
        aria-hidden="true"
      >
        <Bell size="sm" />
      </span>
      <p className="min-w-0 flex-1 truncate text-xs font-semibold text-red-300">{message}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="pointer-events-auto shrink-0 rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200 ring-1 ring-inset ring-red-400/40 transition-[background-color,transform] duration-150 ease-out hover:bg-red-500/30 active:scale-[0.97]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
