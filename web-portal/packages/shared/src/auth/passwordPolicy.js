/**
 * What counts as an acceptable new password, and how strong it is.
 *
 * In its own module rather than beside the component that renders it, for the
 * same reason `authStyles.js` is: a file that exports both a component and
 * plain values loses Fast Refresh for everything that imports it. It also makes
 * the policy findable — "where are the password rules" has one answer.
 */

/**
 * The rules, in the order they are shown.
 *
 * Length first because it is the one that actually matters — every extra
 * character multiplies the search space, while the character-class rules mostly
 * push people towards `Password1!`. The classes stay because these accounts are
 * provisioned by an administrator and a shared floor is worth having, but the
 * meter weights length heaviest for the same reason.
 */
export const RULES = [
  { id: 'length', label: 'At least 10 characters', test: (v) => v.length >= 10 },
  { id: 'case', label: 'Upper and lower case', test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: 'number', label: 'A number', test: (v) => /\d/.test(v) },
  { id: 'symbol', label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
]

export const STRENGTH = [
  { label: 'Too short', bar: 'w-1/4 bg-danger', text: 'text-danger' },
  { label: 'Weak', bar: 'w-2/4 bg-warning', text: 'text-warning' },
  { label: 'Good', bar: 'w-3/4 bg-info', text: 'text-info' },
  { label: 'Strong', bar: 'w-full bg-brand-500', text: 'text-brand-400' },
]

/** -1 for empty, otherwise an index into STRENGTH. */
export function scoreOf(value) {
  if (!value) return -1
  const passed = RULES.filter((rule) => rule.test(value)).length
  // Length is a gate, not one vote among four: nothing counts as more than
  // "weak" until it is long enough, however many symbols it has.
  if (!RULES[0].test(value)) return 0
  return Math.min(STRENGTH.length - 1, Math.max(1, passed - 1))
}

/** Whether this pair may be submitted. The single source for that answer. */
export function passwordReady(password, confirmation) {
  return scoreOf(password) >= 1 && password.length > 0 && password === confirmation
}
