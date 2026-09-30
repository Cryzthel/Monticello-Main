import { useEffect, useRef, useState } from 'react'
import { LottieLight } from 'lottie-react'

/**
 * The animated illustration in the sign-in screen's hero column.
 *
 * ── WHAT THIS REPLACED, AND WHY IT HAD TO ────────────────────────────────────
 * A muted looping <video>. The brief had always asked for Lottie; the asset
 * supplied for it was an IconScout MP4, and a Lottie player renders Bodymovin
 * JSON and cannot open H.264 — so a video element was the honest way to ship
 * the file that actually existed.
 *
 * That file was the free PREVIEW download and carried IconScout's watermark
 * burned into its pixels. A watermark is not markup: there was nothing in the
 * DOM to delete, and removing it would have meant cropping or masking frames of
 * an asset nobody had licensed. The fix was to change the ASSET, not to attack
 * the mark — the hero is now a genuinely free LottieFiles animation under the
 * Lottie Simple License, and this is the Lottie player the brief wanted from
 * the start.
 *
 * Everything the video version had to work around is simply gone:
 *
 *   · NO WHITE KNOCKOUT. MP4 has no alpha, so the old hero was a hard white
 *     rectangle removed with `mix-blend-multiply` — a blend that only reads as
 *     transparency over a NEAR-WHITE surface, and which therefore quietly
 *     dictated the colour of the panel behind it. That constraint is what kept
 *     the hero column tinted. SVG has real transparency, so the column was
 *     free to become part of the card's single white plate.
 *   · SMALLER, AND SHARP AT ANY SIZE. 95 KB of vector against 684 KB of
 *     rasterised frames, and it resolves to the column instead of softening on
 *     a high-DPI display.
 *
 * ── WHY LottieLight ──────────────────────────────────────────────────────────
 * The smallest of the three engines the library ships. It renders SVG only and
 * carries no expression interpreter, which is safe here because it was checked
 * rather than assumed: the animation has 0 expression-driven properties, no 3D
 * layers, no text layers, no effects and no image or font assets. If a future
 * illustration uses any of those, `LottieSvg` keeps expressions and `Lottie` is
 * the full build — importing a different name is the whole migration.
 *
 * ── REPLACING THE ILLUSTRATION ───────────────────────────────────────────────
 * Replace the JSON file; nothing here changes. The aspect ratio is read off the
 * animation itself, so an asset with different proportions lays out correctly
 * without a matching edit in the CSS.
 */

/**
 * Where to park the playhead when motion is suppressed, as a percentage of the
 * timeline. Frame 0 of most Lottie illustrations is the first frame of a
 * build-on — a half-drawn or empty canvas — so holding at zero hands a
 * reduced-motion user a panel that looks broken. 40% is past the build and
 * before the loop's tail.
 */
const RESTING_PERCENT = 40

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

export default function LoginHeroAnimation({ src, className = '' }) {
  const lottieRef = useRef(null)
  const [animation, setAnimation] = useState(null)
  // A 404, a truncated file, or JSON that is not an animation. The hero is
  // decoration; the column keeps its surface and the form — the thing this page
  // exists for — is untouched either way.
  const [failed, setFailed] = useState(false)
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION).matches,
  )

  /*
   * Fetched here rather than handed to the player as a URL, which it would also
   * accept. Two things are bought by holding the parsed animation:
   *
   *   · THE ASPECT RATIO, read from the file's own `w`/`h` below. Without it
   *     the container needs a hardcoded shape, and "replace the JSON and
   *     nothing else changes" stops being true the moment an asset with
   *     different proportions is dropped in.
   *   · A REAL FAILURE PATH. The wrong JSON in public/ becomes an empty panel
   *     instead of an exception thrown from inside the renderer.
   *
   * It stays in `public/` rather than being imported so it remains a separate
   * cacheable file that swaps by being overwritten — which is exactly what the
   * watermark fix needed, and what the next illustration change will need.
   */
  useEffect(() => {
    let cancelled = false
    setAnimation(null)
    setFailed(false)

    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`)
        return response.json()
      })
      .then((json) => {
        if (cancelled) return
        // Every Lottie carries width, height and a frame rate.
        if (!json?.w || !json?.h || !json?.fr) throw new Error('not a Lottie')
        setAnimation(json)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [src])

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION)
    const onChange = (event) => setReduced(event.matches)
    setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // `autoplay` is read once when the animation loads, so it covers the first
  // paint and nothing after it. This is what answers the preference CHANGING —
  // without it, someone who turns reduced motion on while the page is open
  // keeps watching the hero loop.
  useEffect(() => {
    const player = lottieRef.current
    if (!player || !animation) return
    if (reduced) {
      player.pause()
      player.seek({ percent: RESTING_PERCENT })
    } else {
      player.play()
    }
  }, [reduced, animation])

  if (failed || !animation) return null

  return (
    <LottieLight
      src={animation}
      lottieRef={lottieRef}
      loop
      autoplay={!reduced}
      // 28rem. It was 24rem while the hero lived in a column inside a card,
      // where the card's own width was the limit; the pane is now half the
      // viewport — 720px at 1440 — and at 384px the illustration read as a
      // small object adrift in it rather than as one half of the screen. 448px
      // is ~62% of the pane at that width, which is where it sits in the
      // reference, and it is still capped by the pane's padding on narrower
      // laptops rather than by this number.
      className={`w-full max-w-[28rem] select-none ${className}`}
      /*
       * From the animation, not hardcoded. lottie-web's SVG renderer sizes
       * itself to its container, so a container with no height draws a 0px
       * tall animation; this is what gives it one.
       *
       * `height: auto` is not redundant, and this is the trap: the library
       * injects `@layer lottie-react { :where(.lottie-display) { width:100%;
       * height:100% } }` onto the element it renders. `aspect-ratio` only
       * computes a height when height is `auto`, so with that rule in place
       * the ratio is silently ignored and the box takes whatever height its
       * grid area gives it — measured at 428px for a 384px-wide square, i.e.
       * 44px of dead space the animation letterboxed inside. A `:where()`
       * selector in a cascade layer has zero specificity but it is still a
       * declaration, and there is no height utility on this element for it to
       * lose to. An inline value ends the argument.
       */
      style={{ aspectRatio: `${animation.w} / ${animation.h}`, height: 'auto' }}
      // Decorative, and it says nothing the heading beside it does not. A
      // described illustration here would make every screen-reader user listen
      // to a stock drawing before reaching the two fields they came for.
      aria-hidden="true"
    />
  )
}
