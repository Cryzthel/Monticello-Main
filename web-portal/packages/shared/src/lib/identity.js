/**
 * Seeded test identities, and how the dashboards deal with them.
 *
 * ── WHY THIS IS A DISPLAY FILTER AND NOT A DELETION ───────────────────────
 * `guard.test` and `resident.0` are not in this codebase — searching the whole
 * repo for them finds nothing. They are real Firestore documents: a staff
 * account someone created while testing, and incidents whose `reporterName`
 * field literally holds a seed string.
 *
 * So there is no mock data to strip out of the source. What this module does
 * instead is stop those records SURFACING on an operational dashboard, which is
 * the actual problem — a guard reading the dispatch map should not see a fake
 * colleague, and a triage row should not name a resident `resident.0`.
 *
 * Filtering rather than deleting is deliberate: deleting production documents is
 * not something a UI change should do silently, and an incident filed under a
 * seed account is still a real row in the audit history. Hiding it from the live
 * views is reversible; a delete is not. To remove the records properly, delete
 * them from the Firebase console (or the CLI) — that is a data operation, and it
 * belongs in one.
 *
 * ── WHY THE PATTERNS ARE NARROW ───────────────────────────────────────────
 * A blocklist that guesses at "looks fake" will eventually hide a real person,
 * so each pattern here has to be something no genuine account can be:
 *
 *   *.test / *.invalid / *.example  RFC 2606 + RFC 6761 reserve these TLDs
 *                                   precisely so they can never be registered.
 *   example.com / example.org       Reserved by the same RFC.
 *   resident.<digits>               The seed script's own naming shape. A real
 *                                   name cannot be a word, a dot and a number.
 *   guard.test / test / testing     Exact matches only, never substrings —
 *                                   otherwise "Testa" and "Protestant" match.
 *
 * Anything outside those is left alone. If a test account is named something
 * ordinary, it will show — and that is the right failure: better one stray row
 * than a heuristic quietly suppressing a real guard mid-shift.
 */

/** RFC 2606 / 6761 reserved TLDs and second-level domains. */
const RESERVED_DOMAIN = /@(?:[\w-]+\.)*(?:test|invalid|example|localhost)$|@example\.(?:com|net|org)$/i;

/** The seed script's shape: a word, a dot, and a number. */
const SEED_HANDLE = /^[a-z]+\.\d+$/i;

/** Whole-string matches only. `includes` would catch "Testa" and "Contest". */
const EXACT_TEST_LABELS = new Set([
  'test',
  'testing',
  'test user',
  'guard.test',
  'guard test',
  'demo',
  'dummy',
]);

/**
 * True when this name/email pair can only be a seeded fixture.
 *
 * Either field is enough — a test account may have a real-looking name and a
 * `@guard.test` address, or the reverse.
 */
export function isTestIdentity({ name, email } = {}) {
  const cleanEmail = String(email ?? '').trim();
  if (cleanEmail && RESERVED_DOMAIN.test(cleanEmail)) return true;

  const cleanName = String(name ?? '').trim();
  if (!cleanName) return false;
  const lower = cleanName.toLowerCase();

  if (EXACT_TEST_LABELS.has(lower)) return true;
  if (SEED_HANDLE.test(cleanName)) return true;
  // The local part of a reserved-domain address used as a display name —
  // "guard.test" arrives as a NAME on documents that stored the handle rather
  // than the address.
  if (/^[\w.-]+\.(?:test|invalid|example)$/i.test(cleanName)) return true;

  return false;
}

/** Drops seeded fixtures from a list of people. */
export function withoutTestIdentities(people = [], select = (p) => p) {
  return people.filter((person) => !isTestIdentity(select(person)));
}

/**
 * A person's name as it should appear in an operational table.
 *
 * Returns [fallback] rather than the raw value when the stored name is a seed
 * handle or missing, so a triage row reads "Resident" instead of `resident.0`.
 * It does NOT invent a name — the fallback is a role label, which is honest
 * about the fact that the record has no usable one.
 */
export function displayPersonName(name, fallback = 'Unknown') {
  const clean = String(name ?? '').trim();
  if (!clean) return fallback;
  if (SEED_HANDLE.test(clean)) return fallback;
  if (EXACT_TEST_LABELS.has(clean.toLowerCase())) return fallback;
  return clean;
}

/**
 * The first name to greet a signed-in user by, or null.
 *
 * Only a real display name qualifies. The email's local part is never used:
 * a greeting that says "Welcome back, guard.test" is the reason a greeting
 * card was once removed from the Guardhouse dashboard. With nothing usable the
 * caller greets without a name.
 */
/**
 * A security person's label for an operational surface — never an email.
 *
 * `displayPersonName` handles seed handles and blanks but passes an address
 * straight through, because in most tables the stored name IS a name. On the
 * security side it frequently is not: accounts are provisioned by email and
 * `staff_accounts.name` can hold the address, which is how an officer's
 * personal contact detail ends up printed on a dispatch card that anyone at the
 * guardhouse desk can read over a shoulder.
 *
 * The rule was already enforced for panic acknowledgements. This is that rule,
 * in one place, so the next surface to show an officer's name inherits it
 * rather than re-deciding.
 */
export function staffLabel(value, fallback = 'Security personnel') {
  const name = String(value ?? '').trim();
  if (!name || name.includes('@')) return fallback;
  return displayPersonName(name, fallback);
}

export function greetingName(user) {
  const name = String(user?.displayName ?? '').trim();
  if (!name || isTestIdentity({ name, email: user?.email })) return null;
  return name.split(/\s+/)[0];
}
