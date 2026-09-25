/**
 * The centered single-card login shell, shared by both portals.
 *
 * WHAT THIS REPLACED
 * ------------------
 * A 50/50 split panel: the form on the left, an animated SVG console mock-up
 * on the right (HeroIllustration — ~330 lines of radar sweeps, self-drawing
 * charts, pinging rings and drifting KPI chips), plus a staggered entrance for
 * each half and a blurred accent bloom behind the form.
 *
 * All of it is gone, deliberately. The illustration file is deleted and the
 * six keyframes only it used — `float`, `glowPulse`, `radarSweep`, `ringPing`,
 * `drawLine`, `growBar`, `markerDrop` — have been removed from
 * styles/index.css rather than left behind as dead CSS shipped to every page.
 *
 * What remains is one card, dead centre, on a solid ground. A login screen has
 * exactly one job, and the split layout was spending half the viewport and
 * seven infinite animations not doing it.
 *
 * WHY THIS SCREEN IS NO LONGER PINNED DARK
 * ----------------------------------------
 * It was, through two design passes, on the grounds that a dark centred
 * sign-in card had been asked for explicitly and no later brief named the
 * login. That hold is over: it was named, and the screen now follows the theme
 * like every other one.
 *
 * The mechanism is worth keeping in mind because it is what made the flip a
 * two-token change rather than a repaint. The pin was `className="dark"` on
 * the root — the dark palette is declared as plain custom properties under a
 * bare `.dark` selector (styles/index.css), so that class re-declared the whole
 * palette for this subtree. Everything below writes ordinary semantic tokens
 * (`bg-base-900`, `text-text-primary`, `border-slate-200`), so removing the
 * class was enough; there was never a literal hex to hunt down.
 *
 * The earlier hero column solved the same problem with ~40 literal values and
 * a comment explaining why none of them could be tokens. Deleting two class
 * names instead is the whole argument for the token approach.
 */

/**
 * @param variant  'admin' | 'security'. Selects the accent hue for the header
 *                 bloom and rule ONLY — geometry, surfaces, type scale and
 *                 spacing are byte-identical between the two portals, which is
 *                 the point of this component existing once.
 * @param title    The card's header line, e.g. "Admin Login".
 * @param subLabel The supporting line beneath the title. Sentence case, set
 *                 as written — the CSS `uppercase` transform that used to
 *                 shout it is gone with every other all-caps label. Keeping
 *                 the caps out of the DOM was always right (some screen
 *                 readers spell an all-caps string letter by letter); now the
 *                 presentation agrees with the content.
 */
export default function LoginLayout({
  children,
  variant = 'admin',
  title,
  subLabel = 'Login to your account',
}) {
  const isSecurity = variant === 'security'

  // No `dark` class and no `[color-scheme:dark]` any more — this screen now
  // follows the theme like every other one. Both were removed together on
  // purpose: the class pinned OUR tokens dark and the property pinned the
  // BROWSER's native chrome (the Remember-me checkbox, Chrome's autofill wash)
  // to match. Dropping one without the other is what produces a light checkbox
  // on a dark card, or the reverse.
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-base-950 px-4 py-10 sm:px-6">
      {/* `overflow-hidden` clips the header block to the card's corner radius.
          The accent bloom it originally contained is gone, but the clip still
          earns its place: without it a nested background paints square corners
          over the curve, which is the most common way a rounded container
          fails. Nothing here needs to escape the box — there are no dropdowns
          or tooltips on this screen. */}
      <div className="w-full max-w-[26rem] animate-[riseIn_500ms_cubic-bezier(0.16,1,0.3,1)_both] overflow-hidden rounded-xl border border-hairline bg-base-900 shadow-modal">
        {/* ── Header ────────────────────────────────────────────────────── */}
        {/* The header carried two decorative layers — a masked dot lattice and
            a blurred accent bloom off the top-right corner. Both are gone: the
            corporate brief moves away from decorative visual themes, and a
            blurred colour glow is the most decorative thing either portal had
            left. The header is now type on a plain surface, with the accent
            appearing once, as the rule beside the sub-label. */}
        <div className="px-7 pb-6 pt-8">

          {/* Brand mark. Lives in the shell rather than the form because it is
              chrome, not a control — the form below is now purely fields and
              actions. */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg surface-brand text-sm font-bold">
              MV
            </div>
            <div className="min-w-0">
              <p className="truncate text-label font-semibold leading-tight text-text-primary">
                Monticello Villas
              </p>
              <p className="truncate text-caption leading-tight text-text-secondary">
                Incident management system
              </p>
            </div>
          </div>

          <h1 className="mt-8 text-2xl font-semibold leading-tight tracking-tight text-text-primary">
            {title}
          </h1>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className={`h-px w-6 shrink-0 ${isSecurity ? 'bg-info' : 'bg-brand-500'}`} />
            <p className="text-xs font-medium text-text-secondary">
              {subLabel}
            </p>
          </div>
        </div>

        {/* ── Form ──────────────────────────────────────────────────────── */}
        <div className="relative px-7 pb-8">{children}</div>
      </div>
    </div>
  )
}
