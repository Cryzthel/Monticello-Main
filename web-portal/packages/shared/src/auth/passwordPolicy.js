/**
 * What counts as an acceptable new password, and how strong it is.
 *
 * In its own module rather than beside the component that renders it, for the
 * same reason `authStyles.js` is: a file that exports both a component and
 * plain values loses Fast Refresh for everything that imports it. It also makes
 * the policy findable — "where are the password rules" has one answer.
 *
 * ── THESE ARE THE MOBILE APP'S RULES, DELIBERATELY ─────────────────────────
 * Until 2026-10-15 the web asked for ten characters plus upper-and-lower as a
 * single rule. The resident app has always asked for eight, with upper case
 * counted separately — so a resident who set a password on their phone could
 * be told by the web console that the very same password was too weak. One
 * product, two answers, and the one the person had already used was the one
 * being rejected.
 *
 * Aligned to the mobile app — which is not internally consistent, so "aligned"
 * needs saying precisely. `change_password_screen.dart` checks four rules
 * (length, upper case, number, symbol); `sign_up_screen.dart` checks three,
 * dropping upper case. The web follows SIGN-UP's three. See the note on RULES
 * below for why that is the safer of the two to match.
 *
 * THE FLOOR WENT DOWN, AND THAT IS WORTH SAYING OUT LOUD. Eight characters is
 * weaker than ten, and length is the rule that actually buys security — every
 * extra character multiplies the search space, while the class rules mostly
 * push people towards `Password1!`. This change was made for parity, not
 * because eight is better. Raising mobile and web together is the improvement;
 * raising web alone just recreates the disagreement.
 */

/**
 * The symbol set, copied character-for-character from the Dart regex so the
 * two platforms accept exactly the same passwords. A symbol one side counts
 * and the other does not is the same bug as a different length, only harder
 * to see.
 */
const SPECIAL = /[!@#$%^&*(),.?":{}|<>_\-\\/[\]`~+=;]/

/**
 * The rules, in the order they are shown.
 *
 * ── THREE, NOT FOUR: THE UPPER-CASE CHECK CAME OUT 2026-10-15 ─────────
 * It was here to match `lib/features/auth/screens/change_password_screen.dart`,
 * which checks it. It came out at the user's request, after the same
 * three-rule list was specified four briefs running — and that set is exactly
 * `lib/features/auth/screens/sign_up_screen.dart`, the OTHER mobile screen,
 * which does not ask for upper case.
 *
 * Mobile is not internally consistent, so some disagreement is unavoidable
 * until one of its two screens is changed. What this picks is the LOOSER of
 * the two, which is the safe direction: a password accepted here is accepted
 * by both mobile screens at sign-up, and the only mismatch left is the mobile
 * change-password screen asking for one more class than the web does. Had the
 * web stayed stricter, a password a resident had already registered with
 * could be refused when they tried to change it here.
 */
export const RULES = [
  { id: 'length', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { id: 'number', label: 'At least one number', test: (v) => /\d/.test(v) },
  { id: 'symbol', label: 'At least one special character', test: (v) => SPECIAL.test(v) },
]

export const STRENGTH = [
  { label: 'Too short', bar: 'w-1/4 bg-danger', text: 'text-danger' },
  { label: 'Weak', bar: 'w-2/4 bg-warning', text: 'text-warning' },
  { label: 'Good', bar: 'w-3/4 bg-info', text: 'text-info' },
  { label: 'Strong', bar: 'w-full bg-brand-500', text: 'text-brand-400' },
]

/**
 * -1 for empty, otherwise an index into STRENGTH.
 *
 * ── SCALED TO THE RULE COUNT, NOT HARD-CODED TO IT ────────────────
 * This read `passed - 1`, which was right for four rules and silently wrong
 * the moment there were three: the best a password could score became 2 of 3
 * — "Good" — and "Strong" became unreachable. A meter with a top it never
 * reaches tells everyone their password is mediocre, including the people who
 * did exactly what the checklist asked.
 *
 * Expressed as a proportion instead, so adding or removing a rule moves the
 * tiers with it and the top is always "every rule met".
 */
export function scoreOf(value) {
  if (!value) return -1
  // Length is a gate, not one vote among several: nothing counts as more than
  // "too short" until it is long enough, however many symbols it has.
  if (!RULES[0].test(value)) return 0
  const passed = RULES.filter((rule) => rule.test(value)).length
  const top = STRENGTH.length - 1
  return Math.min(top, Math.max(1, Math.round((passed / RULES.length) * top)))
}

/** Every rule met. What the checklist's "all clear" and the submit gate read. */
export function meetsPolicy(value) {
  return RULES.every((rule) => rule.test(String(value ?? '')))
}

/**
 * Whether this pair may be submitted.
 *
 * ── IT NOW DEMANDS EVERY RULE, WHERE IT USED TO ACCEPT "not weakest" ───────
 * This was `scoreOf(password) >= 1`, i.e. anything past the length gate. So a
 * password could sit under a checklist with two unticked rows and still
 * submit, which makes the checklist decoration. If a rule is shown, it is
 * required; if it is not required, it should not be shown.
 */
export function passwordReady(password, confirmation) {
  return meetsPolicy(password) && password.length > 0 && password === confirmation
}
