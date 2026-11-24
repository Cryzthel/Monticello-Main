import wordmarkLight from '@shared/assets/monticello-wordmark-light.png?inline'

/**
 * The letterhead every PDF this system produces is printed on.
 *
 * ── WHY THIS EXISTS NOW AND DID NOT BEFORE ─────────────────────────────────
 * `dutyLogPdf.js` and `admin-portal/src/lib/reportPdf.js` each drew their own
 * masthead, and the note in the first one said a shared helper would be the
 * right move at a third exporter — at two it would be an abstraction built
 * from one example of each kind. The third reason arrived from a different
 * direction: the exports were asked to match the official Monticello Villas
 * stationery, which means a real banner with the real lockup on it. That is a
 * piece of brand, not a piece of either document, and the one thing that must
 * NOT drift between two exports is the letterhead they share.
 *
 * ── THE COLOURS ARE THE LOGO'S OWN, SAMPLED ────────────────────────────────
 * Not the console's. The portals run on emerald (`--color-brand-cta`,
 * #047857) and the official wordmark does not: it is maroon type with a green
 * leaf, and these values are read off the supplied artwork rather than guessed
 * at — #7B2727 for the type, #8DA33F for the leaf.
 *
 * That divergence is deliberate and worth stating so nobody "fixes" it: the
 * screen palette is the product's, this is the HOA's letterhead, and a
 * document that leaves the building should look like the organisation rather
 * than like the software that printed it.
 *
 * ── THE LOCKUP IS THE ARTWORK, NOT A TYPESETTING OF IT ─────────────────────
 * It would be easy to draw the words "MONTICELLO VILLAS" in bold Helvetica
 * with letter-spacing and call it the brand. It is a serif lockup with a leaf
 * in it, and a sans-serif imitation reads as a counterfeit of the real one the
 * moment the two are seen together. The PNG is embedded instead.
 *
 * `?inline` makes Vite hand this over as a data URI rather than a URL. jsPDF
 * runs synchronously and `addImage` would otherwise need the bytes fetched
 * first — one more async step, and a failure mode where the export silently
 * produces a header with a hole in it because the asset 404'd.
 */

/** Sampled from the supplied wordmark. */
export const BRAND_MAROON = [123, 39, 39] //  #7B2727 — the type
export const BRAND_LEAF = [141, 163, 63] //   #8DA33F — the leaf

export const INK = [23, 23, 27]
export const MUTED = [113, 113, 122]
export const RULE = [228, 228, 231]

/** A4 portrait, in points — the format every export here uses. */
export const PAGE = { w: 595.28, h: 841.89 }
export const MARGIN = 56

const BANNER_H = 112
const LEAF_RULE_H = 3
/** The lockup's natural aspect, 400 × 115. */
const MARK_W = 162
const MARK_H = (MARK_W * 115) / 400

/**
 * Paint the banner across the top of the CURRENT page and return the y the
 * document should carry on from.
 *
 * Full-bleed: the maroon runs edge to edge rather than sitting inside the
 * margin. A banner inset by 56pt reads as a box someone drew on the page; one
 * that reaches the paper's edge reads as letterhead, which is the thing being
 * imitated.
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {string} subtitle  Letterspaced line under the lockup.
 */
export function drawBrandHeader(doc, subtitle) {
  doc.setFillColor(...BRAND_MAROON)
  doc.rect(0, 0, PAGE.w, BANNER_H, 'F')

  // The leaf green as a hairline along the bottom edge. It is the only other
  // colour in the lockup, and it keeps the banner from reading as a plain
  // dark slab — the same role the green rule played in the old masthead.
  doc.setFillColor(...BRAND_LEAF)
  doc.rect(0, BANNER_H, PAGE.w, LEAF_RULE_H, 'F')

  // The white-knockout variant: the supplied artwork is maroon on
  // transparency and would vanish here. See scripts that generated it — the
  // type is remapped to white per-pixel so the antialiased edges survive, and
  // the leaf is left in its own green.
  doc.addImage(wordmarkLight, 'PNG', (PAGE.w - MARK_W) / 2, 22, MARK_W, MARK_H)

  if (subtitle) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(255, 255, 255)
    // `charSpace` rather than spaces between letters: real tracking, and it
    // leaves the string selectable and searchable as one word in a reader.
    doc.text(subtitle.toUpperCase(), PAGE.w / 2, 90, { align: 'center', charSpace: 1.6 })
  }

  return BANNER_H + LEAF_RULE_H + 34
}

/**
 * Stamp the official footer onto EVERY page: the signature line, the
 * disclaimer and `Page X of Y`.
 *
 * Called last, after the body is drawn, because the page count is not known
 * until the final row lands — and because a footer written as each page fills
 * would say "Page 1 of 1" on page one of four.
 *
 * ── THE SIGNATURE LINE IS ON EVERY PAGE, AND THAT IS ON PURPOSE ────────────
 * A duty record gets separated. A sheet with no place to counter-sign is a
 * sheet that cannot be filed as the signed copy, and the one that goes missing
 * is never the one you expected.
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {object} options
 * @param {string} options.disclaimer   Why this document exists and what it is.
 * @param {string} [options.signatory]  Label under the rule.
 */
export function drawOfficialFooter(doc, { disclaimer, signatory = 'Verified by (Security Supervisor)' }) {
  const pages = doc.getNumberOfPages()
  const baseline = PAGE.h - MARGIN + 30

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)

    // The signature rule, left, with its label beneath — half the content
    // width so it cannot collide with the page number on the right.
    const ruleY = baseline - 26
    const ruleW = (PAGE.w - MARGIN * 2) * 0.42
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.75)
    doc.line(MARGIN, ruleY, MARGIN + ruleW, ruleY)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(signatory, MARGIN, ruleY + 10)

    doc.setFontSize(6.5)
    doc.text(disclaimer, MARGIN, baseline, { maxWidth: PAGE.w - MARGIN * 2 - 70 })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text(`Page ${page} of ${pages}`, PAGE.w - MARGIN, baseline, { align: 'right' })
  }
}
