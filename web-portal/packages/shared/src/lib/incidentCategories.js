/**
 * The one category taxonomy the portal reports against.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Nothing here invents a vocabulary. These are exactly the seven options the
 * mobile report wizard offers (report_incident_screen.dart `_categories`), and
 * that is the point: the breakdown chart's job is to describe what residents
 * actually filed, so its buckets have to be the buttons they actually pressed.
 * Before this, the chart derived its slices from whatever strings happened to
 * be in Firestore, which meant retired options, casing variants and empty
 * fields each became their own slice.
 *
 * ── HAZARD ─────────────────────────────────────────────────────────────────
 * `hazard` was retired from the mobile picker and is deliberately NOT listed
 * as a reportable category — no new report can be filed under it. It is still
 * an ALIAS, because roughly the opposite of removing a category is losing the
 * reports filed under it: those incidents happened, and a chart that silently
 * drops them under-reports the period.
 *
 * It folds into `other`, which is where those reports were always heading. The
 * mobile note that retired it says so directly: "Unsafe conditions nearby" is
 * what a resident reaches for when nothing else fits, so it competed with
 * Other while genuine fires and floods had their own options.
 *
 * NOTE what this does not touch. `wpda.js` CATEGORY_WEIGHTS, `badgeStyles.js`
 * tones and the Cloud Function's priority table all still recognise `hazard`
 * as a first-class key, and must keep doing so — a stored report needs its
 * triage weight and its badge colour whatever the chart calls it. This module
 * governs REPORTING buckets only.
 */

/** The bucket everything unrecognised lands in. */
export const OTHER_CATEGORY = 'other'

/**
 * Canonical keys, in the mobile picker's own order.
 *
 * Order matters for one thing only — it is the tiebreak when two categories
 * have equal counts, so a chart with three empty-ish buckets does not reshuffle
 * itself between renders.
 */
export const INCIDENT_CATEGORIES = [
  'security',
  'maintenance',
  'medical',
  'fire',
  'noise',
  'flooding',
  OTHER_CATEGORY,
]

const CATEGORY_SET = new Set(INCIDENT_CATEGORIES)

/**
 * Retired or legacy keys, and where their reports now count.
 *
 * `uncategorized` is here rather than being its own slice: a report with no
 * category is, to a reader of this chart, an "Other" — and a second bucket
 * that means almost the same thing splits one number into two small ones.
 */
const CATEGORY_ALIASES = {
  hazard: OTHER_CATEGORY,
  uncategorized: OTHER_CATEGORY,
  others: OTHER_CATEGORY,
}

/**
 * Raw Firestore value -> canonical key.
 *
 * Lower-cased first. Category values are NOT reliably lower-case in this data
 * set — the mobile wizard writes its labels Title Case ('Security'), seeded and
 * older documents vary — which is the same normalisation `categoryWeightOf` and
 * the Cloud Function's `computeWpdaScore` already perform. Without it the same
 * category arrives as two slices.
 */
export function normalizeCategory(raw) {
  const key = String(raw ?? '').trim().toLowerCase()
  if (!key) return OTHER_CATEGORY
  if (CATEGORY_SET.has(key)) return key
  return CATEGORY_ALIASES[key] ?? OTHER_CATEGORY
}

/**
 * Display labels.
 *
 * `other` reads "Others" per the portal spec, while the mobile option it
 * mirrors is singular ("Other"). Same bucket, and the portal wording is what
 * was asked for — but they are worth keeping in one place precisely because
 * they differ, so nobody has to guess whether the two are the same thing.
 */
export const CATEGORY_LABELS = {
  security: 'Security',
  maintenance: 'Maintenance',
  medical: 'Medical',
  fire: 'Fire',
  noise: 'Noise',
  flooding: 'Flooding',
  [OTHER_CATEGORY]: 'Others',
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[normalizeCategory(category)]
}

/**
 * Chart colour per category — keyed by CATEGORY, never by position.
 *
 * ── WHY NOT AN INDEXED PALETTE ─────────────────────────────────────────────
 * The donut used to colour slices by their index in a count-sorted array, so a
 * category's colour was a function of how busy the week had been. Flip the
 * timeframe pill and Maintenance goes from blue to amber; the legend follows,
 * so nothing looks broken — it just quietly stops being possible to compare two
 * views, or to learn what any colour means.
 *
 * The values are the mobile picker's own accents, so a category is the same
 * colour on the resident's phone and on the admin's dashboard.
 */
export const CATEGORY_COLORS = {
  security: '#6366F1',
  maintenance: '#3B82F6',
  medical: '#F43F5E',
  fire: '#F97316',
  noise: '#A855F7',
  flooding: '#06B6D4',
  [OTHER_CATEGORY]: '#94A3B8',
}

export function categoryColor(category) {
  return CATEGORY_COLORS[normalizeCategory(category)]
}

/**
 * Incident counts per category, for the Overview breakdown chart.
 *
 * Every raw value is folded through `normalizeCategory` first, which is what
 * makes the chart's buckets the mobile picker's options rather than "whatever
 * strings happen to be in Firestore". Three things that used to produce their
 * own slice no longer do: retired categories (`hazard`), casing variants
 * ('Security' vs 'security', which counted twice), and reports carrying no
 * category at all.
 *
 * Zero-count categories are omitted. The taxonomy is the set of buckets a count
 * CAN land in, not a set of rows the chart must always draw — a donut carrying
 * empty slices for options nobody has used reads as a legend, not as data.
 *
 * Sorted by count desc, then by canonical order, so equal counts hold still
 * between renders instead of swapping places on every snapshot.
 */
export function computeCategoryBreakdown(incidents) {
  const counts = new Map()
  incidents.forEach((incident) => {
    const key = normalizeCategory(incident.category)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        INCIDENT_CATEGORIES.indexOf(a.category) - INCIDENT_CATEGORIES.indexOf(b.category),
    )
}
