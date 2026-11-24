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
 * SOS alerts, as a reporting bucket.
 *
 * ── WHY A PANIC ALERT NEEDS A CATEGORY ─────────────────────────────────────
 * It does not have one, and it never will: the SOS button is a single press
 * with nothing to choose. But the Overview COUNTS panic alerts in Total reports
 * and Resolved reports (2026-10-29, by request), and a row that is counted in
 * the headline while belonging to no bucket is exactly what made the category
 * donut sum to less than the card above it — see overviewMetrics.js for the
 * reported symptom.
 *
 * So the bucket is not a claim that an SOS has a category. It is the admission
 * that the page counts them, made visible in the one chart whose job is to
 * explain what the total is made of. Folding them into `other` instead would
 * keep the arithmetic honest and the chart misleading, because "Others" already
 * means "a report that fit none of the options" and an emergency is not that.
 *
 * Not reachable from `normalizeCategory`'s alias table by accident — no incident
 * document carries this key today. If one ever does (a seed, a later product
 * decision to let a resident file an emergency as an incident), landing it here
 * is the right answer anyway.
 */
export const SOS_CATEGORY = 'sos'

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
  OTHER_CATEGORY,
  // Last, and after Others. It is not one of the mobile picker's options (see
  // SOS_CATEGORY) and this order is only the equal-count tiebreak, so putting
  // it at the end keeps the resident-facing options in the resident-facing
  // order they were listed in.
  SOS_CATEGORY,
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
  // Retired 2026-10-08. It is HERE rather than simply deleted because the
  // reports that were filed under it still exist and still have to render: an
  // alias turns them into Others, where a bare deletion would leave
  // `normalizeCategory` returning a key with no label, no colour and no icon.
  //
  // The mobile picker still OFFERS Flooding (report_incident_screen.dart), and
  // the Cloud Function still scores it (functions/index.js, flooding: 55), so
  // new reports can still arrive under this key until both are changed and the
  // functions deploy is unblocked. Until then this alias is not only
  // back-compatibility — it is what keeps incoming reports legible.
  flooding: OTHER_CATEGORY,
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
  [OTHER_CATEGORY]: 'Others',
  // "SOS alerts", not "Emergency": the console calls this collection SOS
  // everywhere else (the Panic alerts page, the KPI help text, the SMS
  // fallback), and a legend row has to be findable from the page it sits on.
  [SOS_CATEGORY]: 'SOS alerts',
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
  [OTHER_CATEGORY]: '#94A3B8',
  // The danger red the SOS surfaces already use, so the slice reads as the
  // emergency it is rather than as a seventh incident type.
  [SOS_CATEGORY]: '#DC2626',
}

export function categoryColor(category) {
  return CATEGORY_COLORS[normalizeCategory(category)]
}

/*
  -- THE BREAKDOWN ITSELF MOVED TO overviewMetrics.js ------------------------
  `computeCategoryBreakdown` counted raw category strings over INCIDENTS. The
  Overview counts SOS alerts in its totals too, so a helper that only ever saw
  incidents could not produce a chart that summed to those totals - which is
  the bug that was reported. `computeBreakdown` there buckets report RECORDS
  (incidents and SOS alike, category already normalised by this module) and
  returns each row's resolved count and its share as well.

  What stays here is the TAXONOMY: the keys, the aliases, the labels, the
  colours and `normalizeCategory`. One module owns what the categories are;
  another owns what is counted.
*/
