import { useId, useState } from 'react'
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Navigation,
  RotateCcw,
  RotateCw,
} from '@shared/icons'
import { formatDistance } from '@/lib/directions'

/**
 * Turn-by-turn directions for the plotted route, collapsed by default.
 *
 * ── WHY COLLAPSED ───────────────────────────────────────────────────────────
 * This panel floats over the dispatch map, and the map is the primary
 * instrument: an officer glances at it to see where the call is, not to read.
 * A list opened by default would cover the thing it describes on a laptop
 * screen, so the card stays compact and the steps are one press away. The
 * press is worth it — inside a gated subdivision the difference between the
 * right and the wrong turn is a locked back gate and four minutes.
 *
 * The step the unit is currently on is what the CARD shows, in full size, at
 * the top. This list is for looking ahead and back.
 *
 * ── THE DISTANCE SITS BESIDE THE INSTRUCTION, NOT INSIDE IT ─────────────────
 * Mapbox gives each step a sentence ("Turn left onto Phase 1 Main Road") and a
 * distance, which is how far you travel AFTER that maneuver, before the next
 * one. Spoken guidance folds them together as "in 50 m, turn left"; a list
 * should not, because the two are different kinds of thing and a reader
 * scanning for their next turn wants the verbs aligned in one column and the
 * figures in another. So: sentence left, distance right, `tabular-nums` so the
 * numbers line up down the column.
 *
 * The final "You have arrived" step carries a distance of 0 and shows none —
 * that row is the list saying it has finished rather than been truncated.
 */

/**
 * Maneuver glyphs.
 *
 * Sharp and ordinary turns share a glyph on purpose. No icon set the portals
 * have used ships a sharp-turn arrow — Lucide did not, Hugeicons did not and
 * Material Symbols does not — and inventing a rotated one would produce a
 * symbol an officer has to learn; the sentence already says "sharp", which is
 * the part that matters.
 */
const GLYPHS = {
  depart: Navigation,
  arrive: Flag,
  left: CornerUpLeft,
  right: CornerUpRight,
  'sharp-left': CornerUpLeft,
  'sharp-right': CornerUpRight,
  'slight-left': ArrowUpLeft,
  'slight-right': ArrowUpRight,
  straight: ArrowUp,
  uturn: RotateCcw,
  roundabout: RotateCw,
}

/** The turn arrow for a maneuver key, defaulting to "carry on". */
export function ManeuverGlyph({ icon, size = 'sm', className = '' }) {
  const Glyph = GLYPHS[icon] ?? ArrowUp
  return <Glyph size={size} className={className} />
}

export default function RouteSteps({ steps, activeIndex = -1 }) {
  const [open, setOpen] = useState(false)
  const listId = useId()

  if (!Array.isArray(steps) || steps.length === 0) return null

  const remaining = activeIndex >= 0 ? steps.length - activeIndex : steps.length

  return (
    <div className="border-t border-hairline">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={listId}
        // A full-width press target rather than a small chevron: this sits on a
        // map an officer may be operating one-handed on a laptop trackpad.
        className="flex w-full items-center gap-2 px-3 py-2 text-caption text-text-secondary transition-colors duration-150 hover:bg-base-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        <ChevronDown
          size="sm"
          className={`transition-transform duration-200 motion-reduce:transition-none ${
            open ? 'rotate-180' : ''
          }`}
        />
        <span className="font-medium text-text-primary">Directions</span>
        {/* Counts down as the unit advances, so the control itself carries a
            little of the progress rather than being a static total. */}
        <span className="tabular-nums text-text-muted">
          {remaining} step{remaining === 1 ? '' : 's'}
          {activeIndex >= 0 ? ' left' : ''}
        </span>
      </button>

      {open ? (
        <ol
          id={listId}
          // Capped and scrollable: a route across the subdivision can be twenty
          // maneuvers, and an overlay that grows to fit them stops being an
          // overlay and becomes the screen.
          className="custom-scrollbar max-h-[min(40vh,15rem)] overflow-y-auto overscroll-contain border-t border-hairline"
        >
          {steps.map((step, index) => {
            const done = activeIndex >= 0 && index < activeIndex
            const current = index === activeIndex
            return (
              <li
                key={`${index}-${step.instruction}`}
                aria-current={current ? 'step' : undefined}
                className={`flex items-start gap-2.5 px-3 py-2 [&+li]:border-t [&+li]:border-divider ${
                  current ? 'bg-brand-500/8' : ''
                }`}
              >
                {/* Completed steps keep their row but lose their emphasis, and
                    swap the turn arrow for a tick. Removing them outright would
                    be worse: a dispatcher checking whether a unit went the way
                    they expected needs the part already driven to still be
                    there. */}
                <span
                  aria-hidden="true"
                  className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    current
                      ? 'bg-brand-500 text-white'
                      : done
                        ? 'bg-base-800 text-text-muted'
                        : 'bg-base-800 text-text-secondary'
                  }`}
                >
                  {done ? <Check size="sm" aria-hidden="true" /> : <ManeuverGlyph icon={step.icon} />}
                </span>
                <span
                  className={`min-w-0 flex-1 text-caption leading-snug ${
                    current
                      ? 'font-medium text-text-primary'
                      : done
                        ? 'text-text-muted line-through decoration-text-muted/40'
                        : 'text-text-primary'
                  }`}
                >
                  {step.instruction}
                </span>
                {step.distance > 0 ? (
                  <span className="shrink-0 tabular-nums text-2xs leading-snug text-text-muted">
                    {formatDistance(step.distance)}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
