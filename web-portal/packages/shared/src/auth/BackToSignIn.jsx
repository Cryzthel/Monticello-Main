import { ArrowLeft } from '@shared/icons'

import { SECONDARY } from '@shared/auth/authStyles'

/**
 * The way back, from anywhere in the authentication flow.
 *
 * ── WHY IT IS NEUTRAL AND NOT THE PORTAL ACCENT ──────────────────────────────
 * It used to be an accent-coloured text link — emerald in admin, sky in the
 * guardhouse — which made the two consoles' recovery screens differ in the one
 * control that is identical in purpose on both. Worse, on a screen whose only
 * other coloured thing is an error banner, a coloured secondary action competes
 * with the primary CTA for the eye.
 *
 * Slate that darkens on hover reads as "the quiet way out", which is what a
 * secondary navigation action should read as. The accent is still doing its one
 * job elsewhere: marking which console you are on.
 *
 * ── A SECONDARY BUTTON, NOT A LINK ───────────────────────────────────────────
 * Drawn as SECONDARY (authStyles.js): the primary CTA's frame with a border
 * instead of a fill, full width beneath it. Still neutral — the border and ink
 * are slate, never the accent — for the reason above.
 *
 * ── WHY A BUTTON AND NOT AN ANCHOR ───────────────────────────────────────────
 * Every use of this moves between STEPS of a flow held in React state, not
 * between URLs. The one place that genuinely navigates — the reset page, which
 * has its own route to leave — passes an `onClick` that calls `navigate`. An
 * anchor here would promise a destination the recovery steps do not have.
 */
export default function BackToSignIn({ onClick, disabled = false, label = 'Back to sign in' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={SECONDARY}
    >
      {/* The arrow is the directional cue; `aria-hidden` because the label
          beside it already says where this goes, and a screen reader announcing
          "left arrow, back to sign in" is one word of noise per visit. */}
      <ArrowLeft size="sm" className="shrink-0" aria-hidden="true" />
      {label}
    </button>
  )
}
