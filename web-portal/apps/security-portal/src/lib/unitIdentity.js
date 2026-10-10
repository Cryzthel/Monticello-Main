import { staffLabel } from '@shared/lib/identity'

/**
 * What to call an officer on an operational surface — never their email.
 *
 * ── THE LEAK THIS CLOSES ───────────────────────────────────────────────────
 * `staff_accounts.name` is frequently the address the account was provisioned
 * with, so any surface rendering `unit.name` directly printed
 * `guard.test@monticellovillas.ph` onto a dispatch card that anyone at the
 * guardhouse desk can read over a shoulder. `staffLabel` has existed to stop
 * exactly this; the unit picker and nine strings in the detail drawer simply
 * never called it.
 *
 * ── WHY `staffLabel` ALONE IS NOT ENOUGH ───────────────────────────────────
 * It replaces an address with a role word — "Security personnel" — which is
 * right on a card describing ONE officer and useless in a list where a
 * dispatcher is choosing between two. Both rows would read the same and the
 * choice would be a coin flip.
 *
 * So the badge number is the fallback before the role word. It is an
 * operational identifier rather than a contact detail, it is already printed
 * beside the name, and it is what a dispatcher says on the radio.
 *
 * ── WHY THIS IS NOT IN parts.jsx ───────────────────────────────────────────
 * It went there first, beside the components that use it, and that file
 * already carried two `only-export-components` warnings for mixing constants
 * and helpers in with components — a third would have made this change a net
 * regression on a rule the project already has. Both of these are pure
 * functions about identity with no JSX in them, so they belong in a module,
 * and moving `initials` across with it leaves `parts.jsx` cleaner than it was.
 *
 * @returns {{ label: string, badge: string }} `badge` is blank when the badge
 *   number has been promoted into `label`, so a caller never prints it twice.
 */
export function unitLabel({ name, badgeNumber } = {}) {
  const real = staffLabel(name, '')
  const badge = String(badgeNumber ?? '').trim()
  if (real) return { label: real, badge }
  if (badge) return { label: `Unit ${badge}`, badge: '' }
  return { label: 'Unnamed unit', badge: '' }
}

/**
 * Two-letter initials for a unit's avatar.
 *
 * `replace(/@.*​/, '')` first, so an email-provisioned account yields the
 * initials of its local part rather than of a domain — "GT" for
 * `guard.test@…`, never "GM" for a gmail address.
 */
export function initials(name = '') {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}
