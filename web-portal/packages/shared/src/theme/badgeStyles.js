// The oblong badge's visual constants.
//
// Lives in shared/theme (next to statusStyles.js / severityColors.js) rather
// than inside StatusBadge.jsx for the reason spelled out there: a .jsx file
// that exports both a component and constants breaks Fast Refresh.
//
// These three tables ARE the badge design system — every pill in both portals
// is one row from each.

// Semantic tone -> fill / label / hairline. Keys are meanings, not colours, so
// a token change in styles/index.css propagates without touching callers.
//
// THE PASTEL CAPSULE (2026-09-22). A 50-step fill under 700-step ink in light,
// a 14-18% wash under 300-step ink in dark: the `--color-pill-*` pairs, every
// one measured above 4.5:1. The ring is the ink at 15%, just enough to hold
// the pill's edge on a white card without reading as an outline.
export const BADGE_TONES = {
  brand: 'bg-pill-success text-pill-success-fg ring-pill-success-fg/15',
  success: 'bg-pill-success text-pill-success-fg ring-pill-success-fg/15',
  warning: 'bg-pill-warning text-pill-warning-fg ring-pill-warning-fg/15',
  danger: 'bg-pill-danger text-pill-danger-fg ring-pill-danger-fg/15',
  info: 'bg-pill-info text-pill-info-fg ring-pill-info-fg/15',
  high: 'bg-pill-high text-pill-high-fg ring-pill-high-fg/15',
  violet: 'bg-pill-violet text-pill-violet-fg ring-pill-violet-fg/15',
  neutral: 'bg-pill-neutral text-pill-neutral-fg ring-pill-neutral-fg/10',
}

// Fixed heights rather than vertical padding: a 10px "Low" and a 12px
// "Unauthorized Entry" must occupy the same box, or a table row's badges
// stagger against each other.
// `md` is the type scale's badge rank: text-xs / 12px. It was 11px, half a
// step below the scale, which is the kind of drift a scale exists to stop.
// `sm` stays a hair under for genuinely dense rows (drawer lists, count
// chips) rather than dropping to the 10px micro-copy rank, which is reserved
// for genuinely micro copy. (This read "for uppercase tracked labels like
// .eyebrow" — both the casing rule and that class are retired; see the
// tombstone in index.css.)
// CAPSULE geometry: `rounded-full` on the pill itself (StatusBadge.jsx) plus
// the horizontal padding below. A capsule's curve eats room at both ends, so
// these carry MORE inline padding than a rectangular badge of the same height
// would need — otherwise the first and last glyph sit in the curve and the
// label reads as off-centre even though it is not.
//
// `md` is the reference's status capsule: `px-3` around a 12px medium label,
// `py-1` expressed as a fixed 24px row so pills in one table column line up
// whatever their icon. `sm` is the dense-row step; `lg` steps the inset up
// with the type so the curve still clears the glyphs.
//
// ── WHICH RANK GOES WHERE. THIS IS A RULE, NOT A PREFERENCE ────────────────
// `md`  every TABLE row, FEED row and LIST CARD, in both portals. Anything a
//       reader scans down a column of.
// `sm`  dense chrome only: drawers, toasts, pickers, inline fields and dialog
//       headers. Places with one badge, read once, where 24px loosens a row
//       that is deliberately tight.
//
// WHY IT IS WRITTEN DOWN. Left to per-call-site judgement this drifted badly:
// peer tables disagreed with each other, and five files disagreed with
// THEMSELVES — FiledReportsTable was `sm` four times and `md` twice, and on the
// Residents page a `sm` source chip sat in the same row as a `md` status badge,
// so one row showed two capsule heights side by side. 17 call sites were
// promoted to `md` on 2026-09-23 to settle it. If you are adding a badge to
// something with rows, it is `md`, which is the default — pass nothing.
export const BADGE_SIZES = {
  sm: 'h-5 gap-1 px-2.5 text-caption',
  md: 'h-6 gap-1.5 px-3 text-xs',
  lg: 'h-7 gap-1.5 px-3.5 text-sm',
}

/*
 * The icon step that belongs inside each pill height above (20 / 24 / 28px).
 *
 * These are `size` tokens from shared/icons, not Tailwind classes, because the
 * icons carry their size as a real `width`/`height` rather than as a class the
 * CSS has to win.
 *
 * ── THE FIRST TWO STEPS SHARE A GLYPH, AND THAT IS NEW ───────────────────
 * `sm` used to be the scale's 14px step. That step no longer exists: Material
 * Symbols are filled shapes drawn for opsz=24, and at 14px their counters
 * close up into a blob (see shared/icons/tokens.js). So the 20px pill takes a
 * 16px glyph, which leaves it 2px of air rather than 3.
 *
 * This is the one place where dropping `xs` is VISIBLE rather than merely
 * mechanical, and it is also a trap: `resolveIconSize` falls back to the 20px
 * DEFAULT for a token it does not know, so leaving `xs` here would not have
 * failed — it would have quietly put a 20px glyph inside a 20px pill.
 */
export const BADGE_ICON_SIZES = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
}

/**
 * Incident category -> badge tone.
 *
 * Distinct hue per category, so a queue can be scanned by KIND without reading
 * a word. Assigned by meaning rather than by list order: fire owns red,
 * maintenance is the deliberately quiet one.
 *
 * Severity is a SEPARATE axis (SEVERITY_TONES below) — a maintenance call can
 * still be critical. Which axis a given badge colours by is the caller's
 * choice; the tickets table tints category by severity because triage cares
 * about urgency, while the report composer tints by category because the guard
 * is choosing what KIND of thing happened.
 */
export const INCIDENT_CATEGORY_TONES = {
  fire: 'danger',
  medical: 'high',
  hazard: 'warning',
  security: 'violet',
  maintenance: 'neutral',
  noise: 'success',
}

/**
 * Category -> tone, tolerant of how the value was actually written.
 *
 * Firestore category values are not guaranteed lowercase — older and seeded
 * documents use Title Case, which is why `wpda.js`'s `categoryWeightOf`
 * already normalises before scoring. Indexing INCIDENT_CATEGORY_TONES directly
 * did not, so a report stored as "Security" fell through to the neutral grey
 * and lost the one signal the colour exists to carry. Same normalisation as
 * the scorer, so a category is coloured on exactly the terms it is weighted.
 */
export function categoryTone(category) {
  return INCIDENT_CATEGORY_TONES[String(category ?? '').toLowerCase()] ?? 'neutral'
}

// Incident severity -> tone. `high` is deliberately its own orange rather than
// a brand tint; see the note in styles/index.css and severityColors.js.
export const SEVERITY_TONES = {
  critical: 'danger',
  high: 'high',
  medium: 'warning',
  low: 'success',
}
