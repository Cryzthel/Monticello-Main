import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@shared/theme/ThemeProvider'

/**
 * Light/dark control, as a 40px circular icon button.
 *
 * ── WHY IT IS NO LONGER A SLIDING SWITCH ──────────────────────────────────
 * This was a 64×36 pill with a travelling knob. It worked, but it made the two
 * top-bar controls two different objects: a wide pill beside the bell's 40px
 * disc, so the pair read as "a setting and a button" rather than as one group.
 * The spec asks for both at `w-10 h-10 rounded-full`, and it is right — a top
 * bar's trailing cluster should be one shape repeated.
 *
 * ── WHAT WAS KEPT FROM THE SWITCH ─────────────────────────────────────────
 * The old implementation's real advantage was accessibility, and none of it is
 * lost here: `role="switch"` plus `aria-checked` still announce this as a
 * two-state control with its current state, which a plain `<button>` would not.
 * A screen reader hears the same thing it heard before; only the pixels changed.
 *
 * ── WHICH ICON SHOWS ──────────────────────────────────────────────────────
 * The DESTINATION, not the current state — in dark mode it shows a sun, because
 * pressing it gives you light. That was the sliding knob's one genuine
 * advantage: a moving knob shows current state without the user having to guess
 * which reading an icon intends. With a single glyph the convention has to be
 * picked and held, and "the icon is what you'll get" is the one every OS uses.
 *
 * Both icons stay mounted and cross-fade, so nothing pops on toggle.
 */
export default function ThemeToggle({ className = '' }) {
  const { isDark, toggle } = useTheme()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggle}
      // The same `icon-btn icon-btn-md` the bell uses, plus the matching
      // resting border — so the two controls are literally the same component
      // shape and cannot drift apart again.
      className={`icon-btn icon-btn-md relative border border-slate-200 bg-base-900 hover:border-slate-300 ${className}`}
    >
      {/* Both glyphs occupy the same centred box and cross-fade. `absolute` on
          each rather than swapping the element keeps the button's content box
          stable, so nothing reflows mid-transition. */}
      <Sun
        className={`absolute h-5 w-5 transition-opacity duration-200 ${
          isDark ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <Moon
        className={`absolute h-5 w-5 transition-opacity duration-200 ${
          isDark ? 'opacity-0' : 'opacity-100'
        }`}
      />
    </button>
  )
}
