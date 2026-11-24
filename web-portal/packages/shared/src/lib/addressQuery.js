/*
 * Parsing a typed address into the parts a resident record is filed under.
 *
 * ── WHY A PARSER AND NOT A SUBSTRING MATCH ────────────────────────────────
 *
 * The Residents page used to filter by `[name, email, phone, address].join(' ')
 * .includes(term)`. That looks like it handles addresses and does not: the
 * joined string reads "Phase 2 • Block 14 • Lot 7", so "phase 2 block 14"
 * fails on the bullet, "block 14 phase 2" fails on word order, and "P2 B14"
 * fails on everything. The three dropdowns existed to paper over that.
 *
 * This reads the SHAPE of an address query instead — a label, then its value —
 * so the same intent typed five ways lands on the same filter:
 *
 *   "Phase 2 Block 14 Lot 7"   "phase2 block14 lot7"
 *   "P2 B14 L7"                "p 2 b 14 l 7"
 *   "Block 14"                 "ph 2, blk 14"
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * No fuzzy/edit-distance matching on the VALUES. A lot number is an
 * identifier, not a word: "Lot 7" and "Lot 17" are different houses, and a
 * matcher that scores them as near-misses is worse than one that says no.
 * Fuzziness belongs on the label ("blk", "b", "block"), which is what the
 * token table below covers, and on the free-text remainder, which is matched
 * as a plain substring against the person.
 *
 * Values are compared case-insensitively and with leading zeros stripped, so
 * "Lot 07" finds "Lot 7" — same house, two ways of writing it. They are NOT
 * compared numerically, because a lot may legitimately be "7A".
 */

/** Label token -> field, for both spellings of each label. */
const FIELD_OF = {
  phase: 'phase', ph: 'phase', p: 'phase',
  block: 'block', blck: 'block', blk: 'block', bl: 'block', b: 'block',
  lot: 'lot', lt: 'lot', l: 'lot',
}

/*
 * ── TWO CLASSES OF LABEL, AND WHY THE VALUE RULE DIFFERS ──────────────────
 *
 * Written out, a label is unambiguous and its value can be anything:
 * "Block A" is a block. Abbreviated, it is one or two letters that start a
 * great many names, and the value rule is the only thing stopping it eating
 * them. Without it:
 *
 *   "Bea Santos"  -> block "ea"      "Liam Cruz" -> lot "iam"
 *   "Pia Reyes"   -> phase "ia"      "Blanca"    -> block "anca"
 *
 * — all of which then match no resident at all, so searching for a person by
 * name silently returned nothing. That is why an ABBREVIATED label requires a
 * DIGIT-LED value: "P2" is an address, "Pia" is a name, and the digit is what
 * separates them.
 *
 * ── AND WHY A WRITTEN-OUT LABEL IS ONLY LOOSE WHEN IT IS SEPARATED ───────
 *
 * "Block A" has to parse, so a written-out label accepts a letter value. But
 * the same looseness turned "Lotty" into lot "ty" — the label is a prefix of
 * a real name. The distinguishing feature is the GAP: an address types a
 * separator between label and value, a name does not.
 *
 *   "Lot A"  -> lot "a"      separated, so a letter value is allowed
 *   "Lotty"  -> no match     glued, so only digits would have been allowed
 *   "lot7"   -> lot "7"      glued but numeric, which is how people type
 *
 * Longest-first ordering inside each group matters too — `phase` must be
 * tried before `ph`, or "phase 2" reads as ph + "ase 2" and fails the digit
 * rule rather than parsing.
 */
const WORD_LABELS = 'phase|block|lot'
const SHORT_LABELS = 'ph|p|blck|blk|bl|b|lt|l'
const SEP = String.raw`[\s\-.:#]`

/*
 * Values are `[a-z0-9-]*` rather than `\d+` because lots are not always
 * numbers — "7A" and "12-B" are real. Anchored on a word boundary, so "lot"
 * inside "pilot" cannot start a match.
 *
 * Groups: 1/2 written-out + separated value, 1/3 written-out + glued digits,
 * 4/5 abbreviated + digits.
 */
const PART = new RegExp(
  String.raw`\b(?:(${WORD_LABELS})(?:${SEP}+([a-z0-9][a-z0-9-]*)|(\d[a-z0-9-]*))` +
    String.raw`|(${SHORT_LABELS})${SEP}*(\d[a-z0-9-]*))`,
  'gi',
)

/** Lower-case, collapse whitespace, drop the separators people type. */
const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[•,/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** `07` and `7` are the same lot; `7a` and `7` are not. */
export const normalizeValue = (value) => {
  const v = normalize(value)
  return /^0+\d/.test(v) ? v.replace(/^0+/, '') : v
}

/**
 * Split a typed query into address parts and whatever is left over.
 *
 * @returns {{phase: string|null, block: string|null, lot: string|null,
 *            text: string, hasAddress: boolean}}
 *   `text` is the remainder with the address parts removed — a name, an email
 *   fragment, a phone. It is what the person-matching half searches, so
 *   "dela cruz block 14" filters by BOTH without the two halves interfering.
 */
export function parseAddressQuery(query) {
  const source = normalize(query)
  const found = { phase: null, block: null, lot: null }

  PART.lastIndex = 0
  const consumed = []
  let match = PART.exec(source)
  while (match !== null) {
    const label = (match[1] ?? match[4] ?? '').toLowerCase()
    const value = match[2] ?? match[3] ?? match[5]
    const field = FIELD_OF[label]
    // First one wins. "block 3 block 9" is a typo, not an OR, and quietly
    // taking the last value would filter by something the operator can still
    // see the start of in the box.
    if (field && !found[field]) {
      found[field] = normalizeValue(value)
      consumed.push([match.index, match.index + match[0].length])
    }
    match = PART.exec(source)
  }

  let text = source
  for (let i = consumed.length - 1; i >= 0; i -= 1) {
    const [from, to] = consumed[i]
    text = `${text.slice(0, from)} ${text.slice(to)}`
  }

  return {
    ...found,
    text: text.replace(/\s+/g, ' ').trim(),
    hasAddress: Boolean(found.phase || found.block || found.lot),
  }
}

/**
 * Does one record satisfy the address half of a parsed query?
 *
 * Only the parts that were TYPED are tested, so "Block 14" matches every lot
 * on block 14 rather than nothing.
 */
export function matchesAddress(record, parsed) {
  if (!parsed.hasAddress) return true
  const eq = (field) =>
    parsed[field] === null || normalizeValue(record?.[field]) === parsed[field]
  return eq('phase') && eq('block') && eq('lot')
}

/** "Phase 2 • Block 14 • Lot 7", skipping the parts a record does not have. */
export function formatAddress(record) {
  return [
    record?.phase && `Phase ${record.phase}`,
    record?.block && `Block ${record.block}`,
    record?.lot && `Lot ${record.lot}`,
  ]
    .filter(Boolean)
    .join(' • ')
}

/**
 * The distinct Phase/Block/Lot combinations present in a set of records, with
 * how many records sit at each.
 *
 * This IS the address index. It is derived from the live collection rather
 * than stored, so it cannot drift from it, and it can never offer an address
 * that matches nothing — the failure mode of a separately-maintained index.
 *
 * Sorted by phase, then block, then lot, each compared numerically when both
 * sides are numeric so Lot 9 precedes Lot 10.
 */
export function buildAddressIndex(records) {
  const byKey = new Map()
  for (const record of records ?? []) {
    if (!record?.phase && !record?.block && !record?.lot) continue
    const key = ['phase', 'block', 'lot'].map((f) => normalizeValue(record[f])).join('|')
    const existing = byKey.get(key)
    if (existing) existing.count += 1
    else
      byKey.set(key, {
        key,
        phase: record.phase ?? '',
        block: record.block ?? '',
        lot: record.lot ?? '',
        label: formatAddress(record),
        count: 1,
      })
  }

  const part = (a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
    return String(a).localeCompare(String(b), undefined, { numeric: true })
  }

  return [...byKey.values()].sort(
    (a, b) => part(a.phase, b.phase) || part(a.block, b.block) || part(a.lot, b.lot),
  )
}

/**
 * The entries of an index that satisfy a parsed query, best first.
 *
 * "Best" is simply the most specific: an entry matching all three typed parts
 * outranks one matching two. Within a rank the index's own order holds, so the
 * list reads as an ordered address book rather than a shuffled score board.
 */
export function suggestAddresses(index, parsed, limit = 8) {
  if (!parsed.hasAddress && !parsed.text) return []

  const scored = []
  for (const entry of index) {
    if (!matchesAddress(entry, parsed)) continue
    // A bare text query still browses the index, so typing a resident's name
    // does not blank the address list underneath them.
    if (parsed.text && !entry.label.toLowerCase().includes(parsed.text)) {
      if (!parsed.hasAddress) continue
    }
    const specificity = ['phase', 'block', 'lot'].filter((f) => parsed[f] !== null).length
    scored.push({ entry, specificity })
    if (scored.length >= limit * 4) break
  }

  return scored
    .sort((a, b) => b.specificity - a.specificity)
    .slice(0, limit)
    .map((s) => s.entry)
}
