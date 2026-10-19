import { useEffect, useState } from 'react'

import BrandMark from '@shared/components/BrandMark'
import { Smartphone } from '@shared/icons'
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
        {/* ── Brand lockup, pinned to the pane's top-left corner ───────────── */}
        {/* IT IS A FLEX CHILD, NOT `absolute`, and that is the whole decision.
            Absolute is what the brief suggests and what the reference does, and
            it works right up until the pane is shorter than its content: the
            centred column's auto margins collapse to 0, the column starts at
            the pane's top padding, and the heading slides under a logo that is
            no longer in the flow to push it. A second-factor step on a 600px
            window is exactly that case. In flow, the collision cannot happen —
            and the lockup still lands in the corner, because the pane's own
            padding is what positions it.

            `self-end` keeps it at its intrinsic width against a stretching
            column, so the hit area ends at the wordmark rather than running the
            full pane, and parks it on the pane's RIGHT padding edge (24 → 32 →
            64px). It steps with the pane rather than sitting at some fixed
            inset of its own.

            Right, not left, and above `lg` that reads as the far corner of the
            window: the hero pane owns the left half, so the form pane's right
            edge IS the screen's right edge. Below `lg` the hero is not
            rendered and the pane is the whole screen, so it lands in the same
            corner by a different route — no breakpoint needed either way.

            It sits RIGHT of the centred form's right edge at `lg`, where the
            pane is 720px and the measure 448px. That is deliberate, not a
            misalignment: the lockup belongs to the pane, the form to its own
            column, and the two are not meant to share an edge. */}
        {/* Brand mark. Chrome, not a control — it belongs to the shell for
            the same reason it did in the single-card layout: a component
            named LoginForm rendering a wordmark is the seam that let the two
            consoles' headers drift apart in the first place. */}
        <div className={`inline-flex shrink-0 items-center gap-2.5 self-end ${ENTRANCE}`}>
          {/* The mark, not a monogram on a tile — see the note in
              CollapsibleSidebar. This screen is pinned light, so
              `text-brand-logo` resolves to #05171B — the lockup's own field
              colour, used here as ink — permanently, regardless of the theme
              the administrator left the dashboard in. */}
          <BrandMark className="h-6 w-auto shrink-0 text-brand-logo" />

          {/* ONE LINE, AND IT IS THE BRAND NAME.

              "Incident management system" sat under this as a second line
              and is gone. It was a caption doing a subtitle's job on a
              screen that already says the same thing twice: the h1 below
              names who is signing in and the description under it names
              what they are signing into. The line restated the product to
              the handful of people who administer it.

              Removing it is also what let the wordmark grow, and the two
              changes only work together. At `text-label` (13px) this was the
              larger of two stacked lines, which is why it read as a label
              above a caption rather than as the brand — a 13px line cannot
              anchor a 40px mark, and the pair straddled the mark's centre
              instead of meeting it. Alone, at the size below, one line
              centres on the mark and the lockup reads as a lockup.

              14px against a 24px mark, by request. This line has been 13,
              18, 20, 14, 20 and 14 again, and the history only matters for
              one thing it teaches: SIZE AND INK ARE COUPLED HERE.

              The brand ink is a near-black. It shows its teal across large
              solid shapes and loses it in small thin ones, so every time
              this lockup shrank it read blacker, and every time it read
              blacker it came back as a colour bug. It went to 20px/40px
              precisely to bring the hue back, and that worked. It is at
              14px/24px now, with the ink essentially unchanged, so it
              reads as near-black again. That is the trade, taken
              knowingly — not a defect to re-report.

              If this must stay compact AND read teal, the ink has to move:
              `--color-brand-logo` in styles/index.css. Shrinking the
              lockup without lifting the ink is the loop.

              Measured in the browser with Groote loaded, "Monticello
              Villas" sets 131px at 14px and 187px at 20px. At 14px the
              lockup — mark, gap and wordmark — comes to ~175px, which
              clears the pane at every breakpoint including 320px, so
              `truncate` below is now a guard rather than a working
              constraint. If the full commercial cut of Groote replaces the
              demo, re-measure: a complete character set can ship different
              metrics.

              It still has to sit under the h1, which sets at 30px. 20/30
              is a smaller step than 18/30 but an audible one; past 22px
              the wordmark starts competing with the heading it is there to
              introduce, and that is the line.

              `min-w-0 truncate` moved onto the <p> now that it is the only
              child — the wrapper div existed to hold the second line. Both
              still matter at 320px, where the measure is narrower than the
              wordmark.

              `text-brand-logo`, NOT `text-text-primary`: the wordmark takes
              the same token as the mark beside it, so the two are one
              colour by construction and cannot drift apart. It is a visible
              change even here in light — the ink moves off slate-900
              (#0F172A) onto the brand's #05171B. */}
          <p className="min-w-0 truncate font-brand text-sm font-normal leading-tight tracking-tight text-brand-logo">
            Monticello Villas
          </p>
        </div>

        {/* No surface — this is a plain measure. `max-w-md` (448px) is the
            whole of the form's width discipline, and it is 64px wider than the
            column the card allowed, which is the point of removing it.

            It is still a CAP rather than the pane's full width. The pane is
            half the viewport, 720px at 1440, and a form stretched across that
            is unreadable: the eye loses the left edge on the return sweep, and
            a 600px text input reads as a search bar rather than a credential
            field. The `md:px-16` on the pane and the air either side of this
            measure are doing the same job from opposite directions. */}
        {/* CENTRED COLUMN. `items-center` centres the lockup, the heading and
            the description as blocks; `text-center` centres the text inside
            them. The pair is deliberate — `text-center` alone would leave the
            lockup's flex row stretched full width, and `items-center` alone
            would leave a wrapped description ragged against a centred box.

            `text-center` cascades, which is why the form wrapper below turns
            it back off. */}
        {/* `group/shell` so the greeting below can hide itself while a
            password-recovery step is mounted — see the note on it. */}
        <div className={`group/shell my-auto flex w-full max-w-md flex-col items-center self-center text-center ${ENTRANCE}`}>

          {/* THE GREETING STEPS ASIDE DURING RECOVERY.
              "Welcome back, Admin — enter your credentials" above a Reset
              password form is two headings giving two instructions, and the
              centred one is the wrong one. Each recovery step renders its own
              left-aligned title (PasswordRecovery's StepHeading), the way
              mobile's Forgot Password screen does, and marks its root with
              `data-auth-recovery`; `:has()` reads that marker here, so no
              state has to be lifted out of LoginForm to say "recovering". */}
          <div className="flex flex-col items-center group-has-[[data-auth-recovery]]/shell:hidden">

          {/* THE HEADING, AND THE ONE PLACE THIS PRODUCT USES A SECOND FACE.
              Plus Jakarta Sans at 800, via `--font-display` — see that token
              for why a display face exists at all and why only this console
              downloads it. Inter is a text face: its proportions are drawn to
              stay even at 11-16px, which is exactly what makes it
              unremarkable at 30px. This is a different typeface, not the body
              font enlarged, and that is the difference the brief is asking
              for.

              Three values carry the rest, and none of them are decoration:

                · 800, not 700. Plus Jakarta Sans has a genuinely distinct
                  ExtraBold — wider stems, tighter counters — where many
                  families just smear the bold. At 700 it reads as a heavier
                  Inter; at 800 it reads as itself.
                · tracking -0.025em. A face's default spacing is metric for
                  text sizes; at display sizes it sets loose, and negative
                  tracking is most of the difference between a heading that
                  looks drawn and one that looks typed.
                · leading 1.1. Tighter than the 1.15 this had under Inter,
                  because Jakarta's taller x-height already fills the line.

              NO GRADIENT FILL, which the brief marks optional. A two-colour
              heading is the single most recognisable tell of a generated
              landing page, and this is an internal console that four
              administrators sign into. The ink is the system's heading value.

              It steps down to 24px below `sm`, where the full string would
              otherwise orphan "Admin" onto a second line. */}
          <h1 className="font-display text-2xl font-extrabold leading-[1.1] tracking-[-0.025em] text-text-primary sm:text-[1.875rem]">
            {title}
          </h1>

          {description ? (
            // Deliberately NOT the display face. A second face earns its place
            // by contrast, and setting both lines in it would spend that
            // contrast on the line nobody reads first. `leading-relaxed`
            // (1.625) rather than the body 1.5, because this sets at 45-ish
            // characters and a longer measure wants more air between lines.
            <p className="mt-3 max-w-[46ch] text-sm font-normal leading-relaxed text-text-muted">
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
          {/* The resident app, for anyone who reached this console without an
              account — the public /download page needs no sign-in. */}
          <a
            href="/download"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary underline-offset-4 transition-colors hover:text-text-primary hover:underline"
          >
            <Smartphone size={14} aria-hidden="true" />
            Get the Android app
          </a>
        </div>
      </div>
    </div>
  )
}
