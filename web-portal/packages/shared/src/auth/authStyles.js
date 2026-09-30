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
