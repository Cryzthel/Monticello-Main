/*
 * Icon design tokens — the numbers every glyph in both portals is drawn with.
 *
 * Pure constants, in a .js file of their own, for the same reason
 * theme/statusStyles.js is: a module that exports both constants and
 * components breaks Fast Refresh. The components that read these live in
 * createIcon.jsx next door.
 */

/*
 * ── THE GRID PHOSPHOR IS DRAWN ON ─────────────────────────────────────────
 *
 * Not `0 0 24 24`. Phosphor authors on a 256-unit grid, origin top-left.
 * Dropping its paths on a 24-box viewBox renders a glyph roughly ten times too
 * large, clipped to a corner — the first thing that goes wrong when someone
 * adds an icon by hand instead of through scripts/build-icons.mjs.
 *
 * Worth knowing if you are reading old commits: the set this replaced used
 * `0 -960 960 960`, origin at the BASELINE, so its coordinates were all
 * negative. Any code that assumed that offset — the Mapbox marker canvas did —
 * had to lose it. A 256 grid needs no translate at all.
 *
 * The generator asserts every glyph it emits is on this exact grid, so this
 * constant and glyphs.js cannot drift apart.
 */
export const ICON_VIEW_BOX = '0 0 256 256'

/*
 * ── NO STROKE WEIGHT, AND WHY THERE ISN'T ONE ─────────────────────────────
 *
 * There used to be an `ICON_STROKE` here, and before that a `strokeWidth` on a
 * provider. Both are gone, because Phosphor icons are FILLED shapes, not
 * stroked outlines: a glyph's apparent line thickness is baked into its
 * geometry by the font's `wght` axis at the moment it is exported, not applied
 * at render time. There is no runtime stroke to set.
 *
 * So "one weight for every icon" is decided by WHICH DIRECTORY we read from
 * rather than by a constant here. @phosphor-icons/core ships each weight as
 * its own folder — thin, light, regular, bold, fill, duotone — and
 * scripts/build-icons.mjs points at exactly one of them. Changing the house
 * weight is that one line, and the generator refuses a mapping entry that
 * tries to name a weight itself.
 *
 * ── WHY `regular`, WHEN MOBILE USES `fill` ────────────────────────────────
 *
 * The library is shared with the mobile app on purpose: same family, same
 * major version, so a glyph means the same thing on a resident's phone and an
 * administrator's screen. The WEIGHT is not shared, and that is deliberate.
 * Mobile is overwhelmingly Fill — 356 of its 427 icon uses — which suits a
 * phone, where icons are large and often the only thing in a tap target. A
 * filled glyph at 16px in a dense table loses its counters and reads as a
 * blob, and this codebase has been asked three times for outlined icons with
 * no filled variants. So: shared library, weight chosen for the medium.
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
