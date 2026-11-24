import { forwardRef } from 'react'
import { ICON_VIEW_BOX, DEFAULT_ICON_SIZE, resolveIconSize } from './tokens'

/*
 * The factory behind every export in ./index.js.
 *
 * ── WHY A REGISTRY AND NOT 146 INLINE <svg> BLOCKS ────────────────────────
 *
 * @phosphor-icons/core ships .svg FILES, not components, so there is no
 * library component to call — something has to turn a path string into an
 * element. Doing that at each call site would put a viewBox, a fill rule and
 * a size on every icon in the codebase and invite all three to drift.
 *
 * The registry binds each glyph once and exports it under the name the
 * codebase already calls it by. `<ShieldAlert size="sm" />` keeps reading as a
 * shield rather than as a generic icon component told to be one, the maps in
 * theme/categoryIcons.js go on storing components, and the grid, the size
 * scale and the a11y default are decided here — in one file — for both
 * portals. The left-hand names have now survived three icon-set migrations
 * unchanged, which is the whole point of them.
 */
export function createIcon(displayName, d) {
  const Icon = forwardRef(function HouseIcon(
    {
      size = DEFAULT_ICON_SIZE,
      className = '',
      /*
       * Swallowed, not forwarded.
       *
       * Call sites written against the old stroked set still pass this. On a
       * filled path it does nothing, and letting it through would put a
       * `stroke-width` attribute in the DOM that looks load-bearing and is
       * not. Accepting it keeps those call sites working; dropping it here
       * keeps the lie out of the markup. See tokens.js for why there is no
       * stroke any more.
       */
      strokeWidth: _ignoredStrokeWidth,
      ...rest
    },
    ref,
  ) {
    /*
     * Decorative by default.
     *
     * Nearly every icon here sits beside its own label — the sidebar item, the
     * status pill, the button — and a screen reader announcing "graphic" after
     * reading "Resolved" is noise. The old set exposed these as unlabelled
     * graphics and the call sites that cared passed aria-hidden by hand, so
     * the default was "announced, meaninglessly" and the exceptions were
     * silent.
     *
     * Inverted here: hidden unless the call site gives the icon a name, which
     * is the only case where it is carrying meaning on its own — an icon-only
     * button, a status glyph with no text. Passing `aria-label` (or an
     * explicit `aria-hidden={false}`) opts back in, because `rest` spreads
     * after.
     */
    const labelled = rest['aria-label'] != null || rest['aria-labelledby'] != null
    const px = resolveIconSize(size)

    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={px}
        height={px}
        viewBox={ICON_VIEW_BOX}
        /*
         * `currentColor`, so an icon takes the ink of whatever it sits in —
         * the same contract the stroked set had, moved from `stroke` to
         * `fill`. The source SVGs carry no fill attribute at all, which would
         * otherwise paint them black on every surface including the dark
         * theme.
         */
        fill="currentColor"
        /*
         * `shrink-0` on every icon, always.
         *
         * An SVG is a flex item like any other, and a flex item with a long
         * label next to it is squashed before the text wraps. That is the
         * sidebar's collapsed rail, the status pill with a two-word status and
         * the toast with a sentence in it — three places where the glyph went
         * oval and nobody filed it. Call sites used to pass this one by one and
         * roughly half of them did.
         *
         * `block` kills the other half of the problem: an inline SVG sits on
         * the text baseline and reserves descender space under itself, which
         * is the ~2px of phantom padding that made centred icons in buttons
         * look low. Flex containers neutralise it; the many icons NOT in one
         * were riding high by a pixel or two.
         */
        className={`block shrink-0 ${className}`.trim()}
        aria-hidden={labelled ? undefined : true}
        {...rest}
      >
        <path d={d} />
      </svg>
    )
  })

  Icon.displayName = displayName

  /*
   * The raw path data, hung off the component.
   *
   * For the one consumer that cannot render React: IncidentMap fills the
   * route's transport glyph onto a <canvas> for a Mapbox symbol layer, which
   * needs a raster, not an element. Reading `Bike.glyph` means the marker on
   * the map and the icon on the card beside it are one drawing rather than two
   * copies kept in step by hand.
   *
   * A single `d` string now, where the stroked set hung an array of element
   * tuples here. Every Material Symbol in this registry is exactly one path —
   * scripts/build-icons.mjs asserts it — so there is nothing to flatten.
   */
  Icon.glyph = d

  return Icon
}
