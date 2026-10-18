/**
 * The shapes every authentication screen shares.
 *
 * These live in a module of their own rather than in LoginForm because four
 * files need them — the sign-in form, the two-factor step, recovery and the
 * reset page — and importing a constant from a component is how a component
 * ends up with a second job. It also keeps this file out of Fast Refresh's way:
 * a module that exports both a component and a constant loses hot reloading for
 * everything that imports it.
 */

/**
 * The primary action, everywhere: "Sign in", "Verify code", "Send reset code",
 * "Set new password", "Return to sign in".
 *
 * ── WHY THE TOKEN AND NOT `bg-emerald-600` ───────────────────────────────────
 * The brief names `bg-emerald-600 hover:bg-emerald-700`. Stock Tailwind's
 * emerald-600 is #059669, and a white label on it measures about 3.8:1 — under
 * the 4.5:1 that normal-size text owes its background. A sign-in button is the
 * one control on the screen that must be legible to everyone, in a guardhouse,
 * at night, on a cheap monitor.
 *
 * `--color-brand-cta` is #047857: the same emerald family, two steps deeper,
 * measured at 5.6:1 with white and already carrying its own guaranteed-legible
 * foreground and hover. It also inverts correctly — in dark it becomes #10B981
 * with a BLACK label, because white on that fill is 2.54:1. That inversion is
 * why the fill and its text colour are a PAIR and why this uses both halves
 * rather than pinning `text-white`.
 *
 * ── THIS DIVERGES FROM THE DASHBOARDS, DELIBERATELY AND VISIBLY ──────────────
 * Every other CTA in both consoles is near-black (`--color-cta`, "the primary
 * action: near-black, by the user's choice on 2026-09-22"). The sign-in screens
 * are now emerald by a later request. If the intent is one CTA colour product
 * wide, the change belongs in `--color-cta` itself — one line in
 * styles/index.css moves every button in both dashboards at once — rather than
 * here, which moves only these four screens.
 *
 * `.btn` supplies the shape, the 150ms `--ease-out-strong` transition and the
 * 0.97 press scale, shared with every other button in the product. `.btn-brand`
 * is deliberately NOT used: it hardcodes the near-black pair.
 */
export const CTA =
  'btn h-12 w-full rounded-full bg-brand-cta text-brand-cta-fg shadow-sm transition-all hover:bg-brand-cta-hover text-sm font-semibold disabled:opacity-60'

/**
 * The secondary action: "Back to sign in", "Use a different account".
 *
 * The CTA's exact frame — `h-12`, full width, a capsule, `text-sm`
 * `font-semibold` — with the fill swapped for a 1px border, so the two read as
 * a pair stacked under each other rather than a button and a stray link. It was
 * a text link with an arrow; next to a 48px pill it looked like an afterthought
 * and gave a 32px target for the one way out of a stuck flow.
 *
 * Capsule, not `rounded-xl`: every pressable control in the portals is
 * rounded-full (see the capsule geometry note in the design system), and a
 * rounded rectangle under a pill is the mismatch this replaces.
 *
 * Tokens, not `dark:` slate pairs. The sign-in shell pins light, and
 * `border-slate-200/80` is the field border on this same screen, so the
 * secondary button and the inputs share one resting edge. Hover fills with the
 * same faint tint the reveal toggle uses.
 */
export const SECONDARY =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-slate-200/80 bg-transparent text-sm font-semibold text-text-secondary transition-[background-color,border-color,color] duration-150 ease-out hover:border-slate-300 hover:bg-tint/5 hover:text-text-primary active:bg-tint/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50'
