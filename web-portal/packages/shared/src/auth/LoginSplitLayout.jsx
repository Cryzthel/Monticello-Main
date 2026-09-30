import { useEffect, useState } from 'react'

import { useForcedTheme } from '@shared/theme/ThemeProvider'

/**
 * The sign-in screen: two full-height panes divided by a hairline down the
 * middle of the viewport. The illustration owns the left pane; the form sits in
 * a card on the right.
 *
 * ── THIS DOES NOT REPLACE LoginLayout ────────────────────────────────────────
 * LoginLayout — the single centred card — is still what the guardhouse renders,
 * byte for byte, and is deliberately untouched. Only the admin console was
 * asked for this treatment, and the two files existing side by side is the
 * honest way to say that the screens have diverged. Folding both into one
 * component behind a `split` flag would have hidden a real product decision
 * inside a boolean.
 *
 * ── WHERE THE TONES SIT, AND WHY THEY ARE THAT WAY ROUND ─────────────────────
 * The illustration pane is WHITE and the form pane is the canvas grey
 * (#F5F6F8), which is the reverse of the arrangement this screen carried while
 * the form had no container.
 *
 * It had to flip, because a card needs a ground. `--color-base-900` (the card)
 * is #FFFFFF and `--color-base-950` (the canvas) is #F5F6F8 — that pair is the
 * entire figure/ground relationship in this design system, and it only works in
 * one direction. A white card on a white pane has nothing but its own hairline
 * to state its edge; the grey has to be on the side the card is on.
 *
 * The useful side effect is that the divider now coincides with a change of
 * tone. A line between two identically-coloured panes is a line someone drew;
 * a line on the seam between two grounds is the seam.
 *
 * ── HOW THIS ARRIVED AT FULL BLEED ───────────────────────────────────────────
 * By subtraction, and the order matters because each removal only became
 * possible once the one before it had happened:
 *
 *   1. THE CANVAS WAS THE WRONG GREY — `bg-slate-50` (#F8FAFC) against a body
 *      painting #F5F6F8. Two greys three units apart, stacked, with a visible
 *      seam that read as a second background box behind the card.
 *   2. THE CARD HAD AN INNER GUTTER — which put two concentric rounded
 *      rectangles on the left half.
 *   3. THE HERO COLUMN WAS TINTED — so the card read as a tinted box beside a
 *      white box inside one border. Removing it was only possible once the
 *      hero stopped being a video: an MP4 has no alpha and was knocked out
 *      with `mix-blend-multiply`, which reads as transparency ONLY over a
 *      near-white surface, so the asset was dictating the column's colour.
 *   4. THE OUTER CARD — by then a white rectangle framing content that no
 *      longer needed framing, with the two panes going full bleed in its place.
 *
 * The container below is NOT that card coming back. That one wrapped the whole
 * screen, illustration included, which is what made the layout read as a box
 * inside a box. This one wraps the FORM: the eight controls that are the only
 * reason anyone opens this page, grouped as one object on a ground.
 *
 * ── WHY THIS SCREEN IS PINNED LIGHT ──────────────────────────────────────────
 * By request: the sign-in surface is fixed light and the dashboard's theme
 * toggle must not reach it. `useForcedTheme('light')` is the mechanism, and its
 * own comment explains why a wrapper class cannot be — briefly, the palette
 * lives in inheriting custom properties on <html>, so a nested `.light` div
 * declares nothing and inherits the very dark values it was added to escape.
 * The pin releases the moment this component unmounts, so the preference a
 * dark-mode administrator set is intact on the dashboard a moment later.
 *
 * Every token here therefore resolves to its light value permanently:
 * `bg-base-950` is always #F5F6F8, `text-text-primary` always slate-900,
 * `border-slate-200` always #E2E8F0. They stay tokens rather than hexes for the
 * reason in (1) — this screen and the dashboard behind it must not describe the
 * same colour two different ways.
 */

/**
 * Tailwind's `lg`, as a media query.
 *
 * DUPLICATES the `lg:` prefixes on the hero pane, and has to: CSS decides the
 * LAYOUT and JavaScript decides whether the illustration is MOUNTED, and those
 * are two different questions with one answer. Measured, because the obvious
 * assumption is wrong — hiding an ancestor does not stop a media element from
 * fetching its source. The first build of this screen pulled the full hero on a
 * 375px phone that could never show a frame of it.
 */
const HERO_QUERY = '(min-width: 64rem)'

/** True while the viewport is wide enough for the hero pane to be painted. */
function useHeroVisible() {
  const [visible, setVisible] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(HERO_QUERY).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(HERO_QUERY)
    const onChange = (event) => setVisible(event.matches)
    // Re-read on mount as well as on change: a viewport that crossed the
    // breakpoint between the initial render and this effect would otherwise
    // keep the stale answer until the NEXT resize.
    setVisible(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return visible
}

/** One entrance, shared by both panes so neither arrives before the other. */
const ENTRANCE = 'animate-[riseIn_500ms_cubic-bezier(0.16,1,0.3,1)_both]'

/**
 * @param illustration  The hero pane's content. Neither rendered nor fetched
 *                      below `lg` — see HERO_QUERY.
 * @param title         The h1. One per screen — the hero pane deliberately
 *                      carries no heading of its own.
 * @param description   The supporting line under the title.
 */
export default function LoginSplitLayout({ children, illustration, title, description }) {
  useForcedTheme('light')
  const heroVisible = useHeroVisible()

  return (
    // The canvas grey is on the GRID, so it is also what a phone sees: below
    // `lg` the hero pane is not rendered and the form card sits on this ground
    // alone, which is the ordinary card-on-canvas relationship the rest of the
    // product uses. The hero pane paints its white over it above `lg`.
    //
    // EVERY TRACK IS `minmax(0,1fr)`, INCLUDING THE SINGLE MOBILE ONE. A grid
    // track's default minimum is `auto`, which means it refuses to shrink below
    // its item's min-content width — so a plain `grid-cols-2` / implicit single
    // column silently becomes a floor. Measured: the form pane held itself at
    // 374px inside a 320px grid and pushed 54px of horizontal scroll onto the
    // page, which is every phone narrower than an iPhone 12. Releasing the
    // minimum let the pane reach 320 and the card 280 with nothing clipped, so
    // there was never a real content floor — only the track's default.
    //
    // This is the same guard the two-column layout carried before it was
    // simplified to `lg:grid-cols-2`; the shorthand is what dropped it.
    <div className="grid min-h-screen w-full grid-cols-[minmax(0,1fr)] bg-base-950 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── Hero pane ────────────────────────────────────────────────────── */}
      {/* HIDDEN below lg, not shrunk. On a phone the form IS the screen: a
          scaled-down illustration above it would push the fields and the CTA
          under the fold on every handset, which is the one thing a sign-in
          screen cannot afford. `hidden lg:grid` hides the pane; `heroVisible`
          is what keeps the 203 KB animation off mobile data — see HERO_QUERY.

          `border-r` is the line down the middle of the screen. It belongs to
          this pane rather than to the form pane's left edge for one reason:
          this is the pane that disappears below `lg`, and a border owned by the
          pane that survives would need its own breakpoint to be switched off.

          The padding is deliberately small — `p-8`, against the `p-12`/`p-16`
          this pane carried when the illustration was capped at 448px. The
          illustration is the whole content of a half-viewport pane, and
          padding was the thing keeping it from filling one. */}
      <div
        className={`hidden place-items-center border-r border-slate-200 bg-white p-8 lg:grid ${ENTRANCE}`}
      >
        {heroVisible ? illustration : null}
      </div>

      {/* ── Form pane ────────────────────────────────────────────────────── */}
      {/* `justify-center` here and `my-auto` on the card, rather than
          `items-center`, which is the same centring with one difference that
          matters: when the card is taller than the viewport — the
          second-factor step on a short window — `align-items:center` overflows
          in BOTH directions and the top becomes unreachable, because scrolling
          cannot go above the origin. Auto margins resolve to 0 once free space
          is negative, so the card sits at the top and the page scrolls. */}
      <div className="flex w-full justify-center px-5 py-10 sm:px-8 lg:py-12">
        {/* THE FORM'S CONTAINER. `shadow-modal` rather than the flatter
            `shadow-panel` a dashboard card gets: this is the only object on
            its half of the screen and there is no other content for it to
            establish a stacking relationship with, so the deeper shadow reads
            as presence rather than as noise. It is also what the single-card
            login used before this screen was split, so the two portals' sign-in
            cards still cast the same shadow.

            29rem (464px) holds a 384px column of content inside `p-10`, which
            is where the field/label/CTA rhythm was tuned.

            The padding steps DOWN on a phone rather than staying put. At
            `p-8` on a 375px screen the card's content box is 286px, and the
            28px heading needs ~294px to set on one line — so it broke after
            "Welcome back," and left "Admin" alone on the second. `p-6` buys
            back the 16px that fixes it, and a phone does not want a desktop's
            inset anyway. */}
        <div
          className={`my-auto w-full max-w-[29rem] rounded-2xl border border-slate-200 bg-white p-6 shadow-modal sm:p-8 lg:p-10 ${ENTRANCE}`}
        >
          {/* Brand mark. Chrome, not a control — it belongs to the shell for
              the same reason it did in the single-card layout: a component
              named LoginForm rendering a wordmark is the seam that let the two
              consoles' headers drift apart in the first place. */}
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

          {/* THE HEADING, SET AS DISPLAY TYPE RATHER THAN AS A BIG LABEL.
              Three values doing the work, all of them things Inter needs at
              this size and does not get from a bare `text-2xl font-bold`:

                · 1.75rem — 28px. Large enough to be the anchor of the card
                  without competing with the CTA for weight.
                · tracking -0.022em. Inter's default spacing is tuned for text
                  sizes; at 28px it sets loose, and the negative tracking is
                  what makes a heading look drawn rather than typed. This is
                  the single biggest difference between a heading that reads as
                  designed and one that reads as a default.
                · leading 1.15. The stock 1.25 leaves a gap under a
                  single-line heading that reads as a missing element.

              It steps down to 24px below `sm` for the same reason the card's
              padding does — see there. Both were needed: the padding alone
              still left it one wrap away on a 360px handset.

              `mt-9` is the space the removed "Admin portal authentication"
              capsule and its two margins occupied, given back to the heading. */}
          <h1 className="mt-9 text-2xl font-bold leading-[1.15] tracking-[-0.022em] text-text-primary sm:text-[1.75rem]">
            {title}
          </h1>

          {description ? (
            <p className="mt-2.5 text-sm font-normal leading-relaxed text-text-muted">
              {description}
            </p>
          ) : null}

          <div className="mt-7">{children}</div>
        </div>
      </div>
    </div>
  )
}
