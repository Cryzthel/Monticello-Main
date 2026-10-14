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
 * ── SHARED, BECAUSE THE LEAK WAS IN BOTH CONSOLES ──────────────────────────
 * This started in the Guardhouse. The Admin console's inspection rail printed
 * `report.assignedGuardName` raw into an "Assigned to" row, which is the same
 * address on the same provisioned account, on a screen an administrator shares
 * in a meeting. One derivation, two portals.
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
  /**
   * The last resort is the project's OWN role word, not an invented one.
   *
   * This read "Unnamed unit", which described the record accurately and
   * read as a defect on screen — an officer is not a nameless thing, their
   * account is simply incomplete. `staffLabel`'s default has been the
   * answer to "we cannot name this person" everywhere else in the codebase
   * since it was written, and a second phrase for the same situation is how
   * two surfaces end up disagreeing about what an empty account is called.
   *
   * It is deliberately NOT "Unassigned": these are on-duty officers who
   * exist and can be dispatched. A call with nobody on it is a different
   * state, and the drawer says so with its own badge.
   */
  return { label: 'Security personnel', badge: '' }
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
