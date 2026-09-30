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
 * The primary action, everywhere: "Sign in", "Verify and sign in", "Send reset
 * link", "Set new password", "Return to sign in".
 *
 * `.btn` and `.btn-brand` are the design system's, so the fill, the hover, the
 * 150ms `--ease-out-strong` transition and the 0.97 press scale are shared with
 * every other CTA in both products. Only the SHAPE is overridden — a capsule
 * rather than the system's 8px corner — which is the sign-in screens' one
 * geometric departure and matches the oblong fields above it.
 *
 * In light, which these screens are pinned to, `--color-cta` is #0F172A and
 * `--color-cta-hover` is #1E293B: the near-black the brief asks for, arrived at
 * through the token rather than around it.
 */
export const CTA =
  'btn btn-brand h-12 w-full rounded-full text-sm font-semibold disabled:opacity-60'
