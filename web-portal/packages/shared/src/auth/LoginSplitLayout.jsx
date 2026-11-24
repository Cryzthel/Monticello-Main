import { useEffect, useState } from 'react'

import BrandMark from '@shared/components/BrandMark'
import { useForcedTheme } from '@shared/theme/ThemeProvider'

/**
 * The sign-in screen for BOTH consoles: two full-height panes divided by a
 * hairline down the middle of the viewport, the illustration owning the left
 * and the form sitting directly on the right.
 *
 * ── HOW IT CAME TO SERVE BOTH ────────────────────────────────────────────────
 * For one release it did not. The admin portal was asked for this layout and
 * the guardhouse kept the old single centred card (`LoginLayout`); the two
 * components sat side by side because that was the honest way to say the
 * screens had genuinely diverged — a `split` flag on one component would have
 * hidden a real product decision inside a boolean.
 *
 * They have converged again, so `LoginLayout` is deleted rather than left
 * around. It had exactly one caller, and a file whose own comment says "this is
 * what the guardhouse renders" is worse than absent once that stops being true.
 * It is in the history if the single-card shape is ever wanted back.
 *
 * NOTHING HERE KNOWS WHICH PORTAL IT IS, which is what made the guardhouse's
 * adoption an import and three strings. Keep it that way: portal identity
 * belongs in the page that renders this, not in the shell.
 *
 * ── WHERE THE TONES SIT, AND WHY THEY MOVED BACK ─────────────────────────────
 * The illustration pane is the canvas grey (#F5F6F8) and the form pane is
 * WHITE. They were the other way round for exactly as long as the form sat in
 * a card, and the two facts are the same fact.
 *
 * A card needs a ground: `--color-base-900` (#FFFFFF) on `--color-base-950`
 * (#F5F6F8) is the entire figure/ground relationship in this system and it only
 * works in one direction, so while there was a card the grey had to be on the
 * card's side. The card is gone, so the grey goes back to the illustration and
 * the form gets the white — which is also what makes the form column read as
 * open space rather than as a panel with something sitting on it.
 *
 * Either way round, the divider falls on a change of tone. A line between two
 * identically-coloured panes is a line someone drew; a line on the seam between
 * two grounds is the seam.
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
 *   5. THE FORM'S OWN CARD, which was tried after (4) and is also gone. It was
 *      a real improvement on nothing at all — it gave the controls an object to
 *      belong to — but it cost the form column its width: a 464px card inside a
 *      720px pane left 256px of that pane doing nothing, and the fields inside
 *      it were narrower than they had been at any point in this screen's life.
 *      Without it the same controls get a 448px column and the pane's own
 *      generous padding, which is more space and one less box.
 *
 * So: no surfaces at all. Two grounds, one line, and content sitting directly
 * on both.
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
    // White is on the GRID, because below `lg` the hero pane is not rendered
    // and the form pane is the whole screen. The hero pane paints the canvas
    // grey over it above `lg`.
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
    <div className="grid min-h-screen w-full grid-cols-[minmax(0,1fr)] bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
        className={`hidden place-items-center border-r border-slate-200 bg-base-950 p-8 lg:grid ${ENTRANCE}`}
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
      <div className="flex w-full flex-col px-6 py-12 sm:px-8 md:px-16">
        {/* No surface — this is a plain measure. `max-w-md` (448px) is the
            whole of the form's width discipline, and it is 64px wider than the
            column the card allowed, which is the point of removing it.

            It is still a CAP rather than the pane's full width. The pane is
            half the viewport, 720px at 1440, and a form stretched across that
            is unreadable: the eye loses the left edge on the return sweep, and
            a 600px text input reads as a search bar rather than a credential
            field. The `md:px-16` on the pane and the air either side of this
            measure are doing the same job from opposite directions. */}
        {/* CENTRED COLUMN. `items-center` centres the mark, the heading and
            the description as blocks; `text-center` centres the text inside
            them. The pair is deliberate — `text-center` has no effect on the
            mark, which is a replaced element rather than text, and
            `items-center` alone would leave a wrapped description ragged
            against a centred box.

            `text-center` cascades, which is why the form wrapper below turns
            it back off. */}
        {/* `group/shell` so the greeting below can hide itself while a
            password-recovery step is mounted — see the note on it. */}
        <div className={`group/shell my-auto flex w-full max-w-md flex-col items-center self-center text-center ${ENTRANCE}`}>
          {/* THE MARK, CENTRED, DIRECTLY ABOVE THE GREETING.

              It used to be a lockup — mark plus the words "Monticello
              Villas" — parked on the pane's right padding edge. Both are
              gone from the corner: the wordmark entirely, the mark to here.

              The wordmark is not reinstated under the mark. The h1 below
              names who is signing in and the description names what they
              are signing into, so a third line repeating the brand is the
              same restatement the lockup's "Incident management system"
              caption was removed for. The mark alone carries the brand and
              leaves the heading as the first thing read.

              IT IS A SIBLING OF THE GREETING, NOT A CHILD OF IT. The
              greeting hides itself while a password-recovery step is
              mounted (`group-has-[[data-auth-recovery]]`), and the brand
              should not vanish with it — recovery is still the same screen.
              The old corner lockup sat outside that hide for the same
              reason, so this keeps the behaviour it had.

              `shrink-0` because the column is a flex container: without it
              an svg with no intrinsic height in the cross axis is free to
              be squashed when the card is taller than a short viewport.

              40px on a phone, 48px above `sm`. The mark is ~1.07:1, so it
              sets ~43px and ~51px wide — comfortably inside the 448px
              measure at every breakpoint, 320px included, and a legible
              step under the 30/36px h1 rather than competing with it.

              `text-brand-logo` is the token the lockup used, kept so the
              mark's ink cannot drift from the rest of the brand. This
              screen is pinned light, so it resolves to the brand near-black
              regardless of the theme the console was left in. */}
          <BrandMark
            className="mb-6 h-10 w-auto shrink-0 text-brand-logo sm:h-12"
            title="Monticello Villas"
          />

          {/* THE GREETING STEPS ASIDE DURING RECOVERY.
              "Welcome back, Admin — enter your credentials" above a Reset
              password form is two headings giving two instructions, and the
              centred one is the wrong one. Each recovery step renders its own
              left-aligned title (PasswordRecovery's StepHeading), the way
              mobile's Forgot Password screen does, and marks its root with
              `data-auth-recovery`; `:has()` reads that marker here, so no
              state has to be lifted out of LoginForm to say "recovering". */}
          <div className="flex flex-col items-center group-has-[[data-auth-recovery]]/shell:hidden">

          {/* THE HEADING: H1 of the type scale — Space Grotesk 700 at 36px,
              through `type-h1`. It steps down to 30px on a phone, where
              36px would crowd the greeting. No gradient
              fill: the ink is the system's heading value. */}
          <h1 className="type-h1 text-text-primary">
            {title}
          </h1>

          {description ? (
            // Deliberately NOT the display face. A second face earns its place
            // by contrast, and setting both lines in it would spend that
            // contrast on the line nobody reads first. `leading-relaxed`
            // (1.625) rather than the body 1.5, because this sets at 45-ish
            // characters and a longer measure wants more air between lines.
            <p className="mt-3 max-w-[46ch] text-body font-normal leading-relaxed text-text-muted">
              {description}
            </p>
          ) : null}
          </div>

          {/* THE FORM IS CENTRED AS A BLOCK, NOT AS TEXT.

              `w-full` keeps the fields spanning the measure, so the column
              they form is centred under the centred greeting. `text-left`
              undoes the inherited `text-center` for everything inside.

              That reset is the one place this layout reads the brief rather
              than following it literally. Centred field labels and centred
              placeholder text break the left edge every input on the screen
              shares, and a label that starts in a different place for every
              field is measurably slower to scan — the eye has no column to
              run down. Centring is a property of the CARD here, which is what
              makes it read as balanced; it is not a property of the controls
              inside it. The sign-in button is full-width and so is centred by
              construction, label included. */}
          <div className="mt-9 w-full text-left group-has-[[data-auth-recovery]]/shell:mt-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
