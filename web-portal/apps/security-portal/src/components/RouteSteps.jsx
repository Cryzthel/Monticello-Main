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

export default function RouteSteps({ steps, activeIndex = -1, defaultOpen = false }) {
  /**
   * `defaultOpen` sets where this STARTS, and nothing more.
   *
   * It is initial state rather than a controlled `open` prop on purpose: the
   * panel decides a sensible default for the situation the route appeared in
   * (see RouteSummaryBadge), and from then on the only thing that moves this
   * is the operator pressing the header. A controlled prop would have let a
   * navigation session starting slam the list shut under somebody who had just
   * opened it to check the back gate.
   */
  const [open, setOpen] = useState(defaultOpen)
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
            const last = index === steps.length - 1
            return (
              <li
                key={`${index}-${step.instruction}`}
                aria-current={current ? 'step' : undefined}
                className={`relative flex items-start gap-2.5 px-3 py-2 ${
                  current ? 'bg-brand-500/8' : ''
                }`}
              >
                {/* ── THE NODE, AND THE VECTOR TO THE NEXT ONE ───────────
                    The row borders are gone: a connecting line down the node
                    column already says these are one ordered sequence, and a
                    full-width rule across every row said it a second time
                    while chopping the list into unrelated cells. One channel
                    for one fact — the same rule the route layers follow about
                    dashes.

                    Completed steps keep their row but lose their emphasis, and
                    swap the turn arrow for a tick. Removing them outright would
                    be worse: a dispatcher checking whether a unit went the way
                    they expected needs the part already driven to still be
                    there. */}
                {/* ── THE VECTOR TO THE NEXT NODE ────────────────────────
                    ABSOLUTE, not a flex child of the node column, and that is
                    the whole trick. The obvious build is a `flex-1` segment
                    stacked under the glyph in a stretched column — it renders
                    nothing. The column's height is the ROW's height, the row's
                    height is the 20px glyph (an instruction is one 16px line),
                    so the segment is handed zero and the list comes back
                    looking exactly as it did before, which is how this cost a
                    cycle to find rather than being obvious in the diff.

                    Taken out of flow it can be measured against the row
                    instead of against the leftovers: from just under the glyph
                    to 8px PAST the row's bottom edge, which is the next row's
                    top padding — so consecutive segments meet and the line is
                    continuous rather than a stack of dashes. Dashed already
                    means "not a road" on this console (see route-connector),
                    and a broken connector here would borrow that meaning.

                    `left`: the row's `px-3` plus half the 20px node = 22px, so
                    the line runs down the glyph's own centre. Those three
                    numbers have to move together.

                    The opacities are measured against the LIGHT panel, which
                    is the harder of the two — a 1px line on white at /35 came
                    back at 2.4:1 and all but vanished, where /50 reads 4.0:1.
                    Dark was never the problem and both tones are comfortable
                    there. Travelled segments stay deliberately recessive, on
                    the same terms as the travelled part of the route on the
                    map, so the list and the map recede together.

                    A wrapped instruction makes the row taller and the segment
                    grows with it, which is the other thing the flex build got
                    wrong in the opposite direction. */}
                {!last ? (
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute left-[1.375rem] top-7 -bottom-2 w-px -translate-x-1/2 ${
                      done ? 'bg-text-muted/30' : current ? 'bg-brand-500/50' : 'bg-text-muted/50'
                    }`}
                  />
                ) : null}

                <span
                  aria-hidden="true"
                  className={`relative mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
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
