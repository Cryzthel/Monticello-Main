/**
 * The app's waiting mark, on the web.
 *
 * ── WHY THIS IS A PORT AND NOT A DESIGN ─────────────────────────────────────
 * The resident phone app already has this mark: `LeafLoader` in
 * lib/core/widgets/leaf_loader.dart. A resident raising an SOS and an officer
 * opening the console it lands on should wait on the same thing, so the
 * geometry, the gradient and the two durations here are that widget's values
 * rather than new ones:
 *
 *   PATH       `M12 0 Q24 4.32 12 24 Q0 4.32 12 0 Z` is `buildLeafPath` at
 *              24x24 — pointed at both ends, widest at the middle. The control
 *              points sit at `h * 0.18`, which is what makes the shoulders
 *              full rather than lens-shaped. A quadratic never reaches its
 *              control point, so the leaf occupies the middle HALF of its box:
 *              a 48px box draws a leaf about 24px across and 48 tall.
 *   GRADIENT   top to bottom, full colour into the same colour at 55% alpha.
 *   MOTION     a 1100ms linear turn with the breathing scale layered on top
 *              (see `leafSpin` / `leafBreathe` in index.css).
 *
 * COLOUR: NEUTRAL (2026-10-17, user's request). It was the brand emerald, and
 * a full-screen green spinner on every load and refresh read as a green flash
 * before each page — the loading state should be quiet, like the skeletons
 * that follow it. It follows `--color-text-muted` (slate-500 light, zinc-400
 * dark), the same neutral those skeletons sit in. Still a token rather than a
 * hex, so it moves with the theme.
 */

/** The bare leaf silhouette. Decorative — callers own the announcement. */
export function LeafMark({ size = 16, className = '' }) {
  return (
    <span
      className={`inline-block shrink-0 motion-safe:animate-[leafSpin_1100ms_linear_infinite] ${className}`}
      style={{ width: size, height: size }}
    >
      <span className="block h-full w-full motion-safe:animate-[leafBreathe_1100ms_ease-in-out_infinite]">
        <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden="true" focusable="false">
          <defs>
            {/* Unique per size so two marks on one page cannot collide on the id. */}
            <linearGradient id={`leaf-${size}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-text-muted)" />
              <stop offset="100%" stopColor="var(--color-text-muted)" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          <path d="M12 0 Q24 4.32 12 24 Q0 4.32 12 0 Z" fill={`url(#leaf-${size})`} />
        </svg>
      </span>
    </span>
  )
}

/**
 * The whole-viewport wait, for the window where the session is being resolved
 * and there is nothing else to show yet.
 *
 * ── THE MARK, AND NOTHING ELSE ──────────────────────────────────────────────
 * Both consoles used to render `null` here — a white screen on every hard
 * refresh, indistinguishable from a page that failed to load. The pass before
 * this one replaced that with a leaf riding a progress track under the words
 * "Checking session…". Both are gone now, by decision: a session check is over
 * in a few hundred milliseconds, and a track plus a sentence is a lot of
 * furniture to put up and tear down in that time. What is left is the mark the
 * phone app waits on, centred, and nothing competing with it.
 *
 * THE LABEL IS STILL THERE, it is just not drawn. `sr-only` keeps it in the
 * accessibility tree so `role="status"` has something to announce — a screen
 * reader landing on a silent live region learns nothing, and a spinning shape
 * is not a message. Removing the text from the SCREEN is the ask; removing it
 * from the announcement would be a different and worse change.
 *
 * Under `prefers-reduced-motion` the leaf holds still rather than disappearing,
 * so the screen is never blank — which is the state this whole component
 * exists to stop happening.
 */
export default function SessionLoader({ label = 'Checking session' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-screen items-center justify-center bg-base-950"
    >
      <LeafMark size={48} />
      <span className="sr-only">{label}</span>
    </div>
  )
}
