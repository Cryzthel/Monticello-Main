import { useEffect, useState } from 'react'

import { useForcedTheme } from '@shared/theme/ThemeProvider'

/**
 * The sign-in screen: two full-height panes, an illustration on the left and
 * the form on the right, divided by a hairline down the middle of the viewport.
 *
 * ── THIS DOES NOT REPLACE LoginLayout ────────────────────────────────────────
 * LoginLayout — the single centred card — is still what the guardhouse renders,
 * byte for byte, and is deliberately untouched. Only the admin console was
 * asked for this treatment, and the two files existing side by side is the
 * honest way to say that the screens have diverged. Folding both into one
 * component behind a `split` flag would have hidden a real product decision
 * inside a boolean, and every later change would have had to reason about
 * which branch it was in.
 *
 * If the guardhouse is ever asked for the same shape it renders THIS component
 * with its own illustration and strings; nothing here knows which portal it is.
 *
 * ── HOW THIS ARRIVED AT FULL BLEED ───────────────────────────────────────────
 * By subtraction, over four passes, and the order matters because each removal
 * only became possible once the one before it had happened:
 *
 *   1. THE CANVAS WAS THE WRONG GREY — `bg-slate-50` (#F8FAFC) against a body
 *      painting `--color-base-950` (#F5F6F8 since the 2026-09-22 redesign).
 *      Two greys three units apart, stacked, with a visible seam wherever the
 *      page ran taller than the container. That seam read as a second
 *      background box sitting behind the card.
 *
 *   2. THE CARD HAD AN INNER GUTTER — `p-2` / `lg:p-3`, which inset the hero
 *      panel and put two concentric rounded rectangles on the left half.
 *
 *   3. THE HERO COLUMN WAS TINTED — `bg-slate-100/70`, so the card read as a
 *      tinted box beside a white box inside one border. Removing it was only
 *      possible once the hero stopped being a video: an MP4 has no alpha and
 *      was knocked out with `mix-blend-multiply`, a blend that reads as
 *      transparency ONLY over a near-white surface, so the asset was dictating
 *      the column's colour. A Lottie draws real transparency.
 *
 *   4. THE CARD ITSELF — by then a white rectangle with a border, a radius and
 *      a shadow around content that no longer needed framing.
 *
 * What is left is the layout below: no card, no radius, no shadow, and no
 * centred column of content floating in a grey field either. The two panes ARE
 * the page, edge to edge, and the only drawn line on the screen is the one
 * dividing them.
 *
 * THE TINT MOVED RATHER THAN CAME BACK. Pane 1 is `bg-base-950` and pane 2 is
 * `bg-white` — the same canvas/surface pair the dashboard uses, at viewport
 * scale. That is not a re-run of (3): there, a tint on one COLUMN INSIDE a
 * white card made the card read as two boxes. Here the panes are not inside
 * anything, so the pair reads as what it is — a ground on one side and the
 * working surface on the other, with the divider stating the join.
 *
 * ── WHY THIS SCREEN IS PINNED LIGHT ──────────────────────────────────────────
 * By request: the sign-in surface is fixed light and the dashboard's theme
 * toggle must not reach it. `useForcedTheme('light')` is the mechanism, and its
 * own comment explains why a wrapper class cannot be — briefly, the palette
 * lives in inheriting custom properties on <html>, so a nested `.light` div
 * declares nothing and inherits the very dark values it was added to escape.
 * The pin is released the moment this component unmounts, so the preference a
 * dark-mode administrator set is intact on the dashboard a moment later.
 *
 * Because the theme is pinned, every token here resolves to its light value
 * permanently: `bg-base-950` is always #F5F6F8, `text-text-primary` always
 * slate-900, `border-slate-200` always #E2E8F0. They stay tokens rather than
 * hexes for the reason in (1) — this screen and the dashboard behind it must
 * not describe the same colour two different ways.
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
 *
 * Gating in CSS alone cannot fix that, and gating in JS alone would leave the
 * pane's sizing to a state update. Hence both, with the breakpoint named once
 * here so the two cannot drift silently.
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
 *                      below `lg` — see HERO_QUERY, and the pane itself for why
 *                      it is not merely shrunk.
 * @param title         The h1. One per screen — the hero pane deliberately
 *                      carries no heading of its own.
 * @param description   The supporting line under the title.
 */
export default function LoginSplitLayout({ children, illustration, title, description }) {
  useForcedTheme('light')
  const heroVisible = useHeroVisible()

  return (
    // `bg-white` on the grid, not only on the form pane. Below `lg` the hero
    // pane is not rendered at all, so without it the single remaining pane
    // would be white over a body painting #F5F6F8 — which shows as a grey band
    // under an overscroll on a phone. Above `lg` the hero pane paints over it.
    <div className="grid min-h-screen w-full bg-white lg:grid-cols-2">
      {/* ── Hero pane ────────────────────────────────────────────────────── */}
      {/* HIDDEN below lg, not shrunk. On a phone the form IS the screen: a
          scaled-down illustration above it would push the two fields and the
          CTA under the fold on every handset, which is the one thing a sign-in
          screen cannot afford. `hidden lg:grid` hides the pane; `heroVisible`
          is what keeps the 95 KB animation off mobile data — see HERO_QUERY.

          `border-r` is the line down the middle of the screen. It belongs to
          this pane rather than to the form pane's left edge for one reason:
          this pane is the one that disappears below `lg`, and a border owned by
          the pane that survives would need its own breakpoint to be turned off
          again. */}
      <div className={`hidden place-items-center border-r border-slate-200 bg-base-950 p-12 lg:grid xl:p-16 ${ENTRANCE}`}>
        {heroVisible ? illustration : null}
      </div>

      {/* ── Form pane ────────────────────────────────────────────────────── */}
      {/* `justify-center` here and `my-auto` on the content, rather than
          `items-center`, which is the same centring with one difference that
          matters: when the content is taller than the viewport — the
          second-factor step on a short window — `align-items:center` overflows
          in BOTH directions and the top becomes unreachable, because scrolling
          cannot go above the origin. Auto margins resolve to 0 once free space
          is negative, so the content sits at the top and the page scrolls. */}
      <div className="flex w-full justify-center px-6 py-12 sm:px-10">
        {/* `max-w-sm` is the whole of the form's width discipline. The pane is
            half the viewport — 720px at 1440 — and a form stretched across that
            is unreadable: the eye loses the left edge on the return sweep, and
            a 700px-wide text input looks like a search bar, not a credential
            field. 384px keeps the label, the field and the CTA in one column
            the eye can hold, and the air either side of it is the point rather
            than waste. */}
        <div className={`my-auto w-full max-w-sm ${ENTRANCE}`}>
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

          {/* The "Admin portal authentication" capsule that sat here is gone by
              request, and nothing replaces it: the brand mark above already
              says which product this is and the heading says what to do, so a
              third line between them was labelling a screen with exactly one
              possible purpose. `mt-10` is the space the capsule and its two
              margins occupied, handed back to the heading. */}
          <h1 className="mt-10 text-2xl font-bold leading-tight tracking-tight text-text-primary">
            {title}
          </h1>

          {description ? (
            // No `max-w` on this one any more. It had `36ch` to stop it setting
            // as one long line and an orphan — a real risk in a column as wide
            // as the old card's. Inside `max-w-sm` the column IS 36ch, so the
            // cap was doing nothing but making the paragraph narrower than the
            // fields it introduces.
            <p className="mt-2.5 text-sm font-normal leading-relaxed text-text-muted">
              {description}
            </p>
          ) : null}

          {/* Everything below this line — labels, field wells, the Remember-me
              row, the CTA — shares the brand mark's and the heading's left
              edge, because they all sit in this one `max-w-sm` column. The only
              things inset from it are the leading icons INSIDE a field well. */}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}
