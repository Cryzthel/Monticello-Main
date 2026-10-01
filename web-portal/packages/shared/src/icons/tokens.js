/*
 * Icon design tokens — the numbers every glyph in both portals is drawn with.
 *
 * Pure constants, in a .js file of their own, for the same reason
 * theme/statusStyles.js is: a module that exports both constants and
 * components breaks Fast Refresh. The components that read these live in
 * createIcon.jsx next door.
 */

/*
 * ── THE GRID MATERIAL SYMBOLS ARE DRAWN ON ────────────────────────────────
 *
 * Not `0 0 24 24`. Material Symbols are authored on a 960-unit grid with the
 * origin at the BASELINE, so the box runs from y = -960 up to y = 0 and every
 * path's coordinates are negative. Dropping this on a 24-box viewBox renders
 * an empty square, which is the first thing that goes wrong when someone adds
 * a glyph by hand instead of through scripts/build-icons.mjs.
 *
 * The generator asserts every glyph it emits is on this exact grid, so this
 * constant and glyphs.js cannot drift apart.
 */
export const ICON_VIEW_BOX = '0 -960 960 960'

/*
 * ── NO STROKE WEIGHT, AND WHY THERE ISN'T ONE ─────────────────────────────
 *
 * There used to be an `ICON_STROKE` here, and before that a `strokeWidth` on a
 * provider. Both are gone, because Material Symbols are FILLED shapes, not
 * stroked outlines: a glyph's apparent line thickness is baked into its
 * geometry by the font's `wght` axis at the moment it is exported, not applied
 * at render time. There is no runtime stroke to set.
 *
 * So "one weight for every icon" is decided by WHICH DIRECTORY we read from
 * rather than by a constant here: @material-symbols/svg-400 is wght=400, and
 * the `rounded` directory within it is FILL=0. GRAD=0 and opsz=24 are the
 * export defaults — so `FILL=0, wght=400, GRAD=0, opsz=24`, enforced by the
 * one import path in scripts/build-icons.mjs. Swapping the house weight to 300
 * or 500 is a one-line change there (svg-300 / svg-500), and swapping the
 * style back to `outlined` or on to `sharp` is the same one line.
 *
 * ── WHY ROUNDED, NOT OUTLINED ─────────────────────────────────────────────
 *
 * Material Symbols ships three styles cut from the same skeleton: Outlined
 * (square terminals), Rounded (radiused terminals) and Sharp (mitred). All
 * three are equally "outlined" in the sense that matters — FILL=0, line art,
 * no solid variants. Rounded is the house style because the portal's own
 * geometry is soft: 12px cards, 8px controls, capsule badges and now capsule
 * search fields. Square-cut terminals on a glyph sitting inside a
 * `rounded-full` pill were the one hard corner left in the system.
 *
 * A `strokeWidth` prop passed by an old call site is accepted and ignored by
 * createIcon rather than forwarded, so it cannot reach the DOM as an attribute
 * that does nothing on a filled path.
 */

/*
 * ── THE SIZE SCALE ────────────────────────────────────────────────────────
 *
 * Three steps, and every icon in both portals is on one of them.
 *
 *   sm (16)  inline badges, status pills, table cell meta
 *   md (20)  action buttons, toolbar controls, form affordances
 *   lg (24)  sidebar navigation, page-header marks
 *
 * ── WHY `xs` (14) IS GONE ─────────────────────────────────────────────────
 *
 * The previous scale had a fourth step at 14px for glyphs beside 11-12px
 * uppercase micro-labels. It does not survive the move to Material Symbols,
 * for a reason specific to filled icons: these are drawn for `opsz=24`, and
 * their counters — the gap in a shield, the notch in a battery — are solid
 * shapes a few units wide on a 960 grid. Scaled to 14px those gaps fall below
 * a device pixel and close up, so the glyph reads as a filled blob. A stroked
 * 14px icon merely looked small; a filled one loses the detail that says which
 * icon it is.
 *
 * 16 is therefore the floor, which is also what the brief asks for. The ~32
 * call sites that used `xs` were moved to `sm`.
 *
 * Sizing lives in this prop rather than in a Tailwind class because an SVG
 * carrying both `width="16"` and `h-4` states the same fact twice, in two
 * languages, and the CSS silently wins when they disagree.
 */
export const ICON_SIZES = {
  sm: 16,
  md: 20,
  lg: 24,
}

/** The default when a call site names no size: the action-button step. */
export const DEFAULT_ICON_SIZE = 'md'

/**
 * Resolve a `size` prop to pixels.
 *
 * Accepts a token name or a raw number. The number path is kept for the two
 * places that genuinely need an off-scale glyph (the login hero mark, the map
 * overlay's locate puck) rather than as a general licence — a raw number in a
 * table cell is the thing this file exists to stop.
 */
export function resolveIconSize(size) {
  if (typeof size === 'number') return size

  const px = ICON_SIZES[size]
  if (px !== undefined) return px

  /*
   * An unknown token is a BUG, and it used to be an invisible one.
   *
   * The fallback below is deliberate — an icon at the wrong size still beats a
   * crash in production — but silently returning the 20px default is how
   * `BADGE_ICON_SIZES.sm` went on pointing at the retired `xs` through a whole
   * migration and put a 20px glyph inside a 20px pill. Nothing threw, nothing
   * logged, and the only evidence was a pill that looked slightly wrong.
   *
   * So dev says so, once per bad token, with the name in the message. Stripped
   * from production builds by the `import.meta.env.DEV` guard.
   */
  if (import.meta.env.DEV && !warned.has(size)) {
    warned.add(size)
    console.warn(
      `[icons] Unknown size token ${JSON.stringify(size)} — falling back to ` +
        `"${DEFAULT_ICON_SIZE}" (${ICON_SIZES[DEFAULT_ICON_SIZE]}px). ` +
        `Valid tokens: ${Object.keys(ICON_SIZES).join(', ')}.`,
    )
  }

  return ICON_SIZES[DEFAULT_ICON_SIZE]
}

/** Dev-only, so one bad call site does not spam a scrolling list. */
const warned = new Set()
