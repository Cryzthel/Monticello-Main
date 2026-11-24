import { useEffect, useRef, useState } from 'react'
import { LottieLight } from 'lottie-react'

/**
 * The animated illustration in the sign-in screen's hero pane, for both
 * consoles.
 *
 * ── WHY IT TAKES A `fit` ─────────────────────────────────────────────────────
 * A Lottie's stated size is its CANVAS, not its drawing, and illustrators leave
 * wildly different amounts of air around the artwork inside it. Measured over a
 * full loop of the two animations this product ships:
 *
 *              canvas      artwork fills      artwork centre is off by
 *   admin      750x750     80.9% x 59.6%      -6.56%, -2.21%
 *   guardhouse 994x736     92.5% x 96.5%      -0.20%, +0.54%
 *
 * Sizing to the canvas — all that `w`/`h` can tell you — therefore gives two
 * screens that are byte-identical in CSS and visibly mismatched on screen: at
 * the same 655px box the guardhouse drew 606px of artwork against admin's
 * 534px, 13% wider, and admin's sat noticeably left of its pane's centre.
 *
 * So each call site states the facts about ITS asset and this component owns
 * the policy — one target fill, applied to both. The result is that the two
 * illustrations DRAW at the same width whatever padding their illustrator
 * happened to leave around them.
 *
 * ── WHY NOT MEASURE IT AT RUNTIME ────────────────────────────────────────────
 * It was tried, twice, and the honest answer is that the number is not stable
 * enough to read on the fly. `getBBox()` reports what is on screen at that
 * instant, and these illustrations move: sampling on a timer catches the
 * build-on and measures a half-drawn figure (516 of 606 units — a box 25% too
 * wide), while seeking to fixed points gives a different union again depending
 * which frames you pick. Both produced a centre offset that was wrong in a
 * different direction on each reload. A measurement taken once, over thirty
 * samples across a whole loop, and written down is simply more correct than one
 * taken in 450ms while the page is still rendering — and it costs no runtime
 * code, no opacity fade to hide the reflow, and has nothing to go wrong.
 *
 * TO RE-DERIVE for a new asset, put it on screen and run this in the console:
 *
 *   const svg = document.querySelector('[class*=min-h-screen] svg')
 *   const vb = svg.getAttribute('viewBox').split(' ').map(Number)
 *   await new Promise(r => setTimeout(r, 2500))          // let the build-on finish
 *   const s = []
 *   for (let i = 0; i < 30; i++) {
 *     await new Promise(r => setTimeout(r, 230))
 *     const b = svg.getBBox(); if (b.width > 0) s.push(b)
 *   }
 *   const l = Math.min(...s.map(b => b.x)), t = Math.min(...s.map(b => b.y))
 *   const r = Math.max(...s.map(b => b.x + b.width))
 *   const d = Math.max(...s.map(b => b.y + b.height))
 *   ;({ fillX: (r - l) / vb[2],
 *       offsetXPct: (((l + r) / 2 - vb[2] / 2) / vb[2]) * 100,
 *       offsetYPct: (((t + d) / 2 - vb[3] / 2) / vb[3]) * 100 })
 *
 * ── WHY LottieLight ──────────────────────────────────────────────────────────
 * The smallest of the three engines the library ships. It renders SVG only and
 * carries no expression interpreter, which is checked rather than assumed for
 * each asset: both current animations have 0 expression-driven properties, no
 * 3D layers, no text layers, no effects and no image assets. If a future
 * illustration uses any of those, `LottieSvg` keeps expressions and `Lottie` is
 * the full build — importing a different name is the whole migration.
 *
 * ── REPLACING AN ILLUSTRATION ────────────────────────────────────────────────
 * Run it through `web-portal/scripts/recolor-lottie.py` first, or it arrives in
 * its stock colours and breaks the pair. Then re-derive `fit` as above.
 */

/**
 * The fraction of the pane's available width the DRAWN ARTWORK should occupy.
 * Not the box — the artwork. That distinction is the entire point of `fit`.
 */
const TARGET_FILL = 0.86

/**
 * Ceiling on the computed box width, as a percentage of the available space.
 *
 * The box is deliberately allowed past 100%, because the overflow is the
 * animation's own empty canvas and is invisible: admin's artwork needs a ~106%
 * box to reach the target width, and letting it have one is exactly what makes
 * the two screens match. This only stops a pathological asset — artwork tucked
 * into one corner of a mostly empty canvas — computing a box several times the
 * pane's width.
 */
const MAX_WIDTH_PCT = 135

/**
 * Where to park the playhead when motion is suppressed, as a percentage of the
 * timeline. Frame 0 of most Lottie illustrations is the first frame of a
 * build-on — a half-drawn or empty canvas — so holding at zero hands a
 * reduced-motion user a pane that looks broken.
 */
const RESTING_PERCENT = 40

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** An unmeasured asset: assume it fills its canvas and is centred. */
const DEFAULT_FIT = { fillX: 1, offsetXPct: 0, offsetYPct: 0 }

export default function LoginHeroAnimation({ src, fit = DEFAULT_FIT, className = '' }) {
  const lottieRef = useRef(null)
  const [animation, setAnimation] = useState(null)
  // A 404, a truncated file, or JSON that is not an animation. The hero is
  // decoration; the pane keeps its surface and the form — the thing this page
  // exists for — is untouched either way.
  const [failed, setFailed] = useState(false)
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION).matches,
  )

  /*
   * Fetched here rather than handed to the player as a URL, which it would also
   * accept. Holding the parsed animation buys the canvas dimensions — needed
   * for the aspect ratio and the height clamp below — and a real failure path,
   * so the wrong JSON in public/ becomes an empty pane rather than an exception
   * thrown from inside the renderer.
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

  const fillX = fit?.fillX > 0 ? fit.fillX : 1
  const widthPct = Math.min(MAX_WIDTH_PCT, (TARGET_FILL / fillX) * 100)
  const aspect = animation.w / animation.h

  return (
    <LottieLight
      lottieRef={lottieRef}
      src={animation}
      loop
      autoplay={!reduced}
      // `pointer-events-none` because the box is allowed to be wider than its
      // pane (see MAX_WIDTH_PCT), and the overhang, though invisible, is a live
      // element that would otherwise sit over the neighbouring pane.
      className={`pointer-events-none h-auto select-none ${className}`}
      style={{
        // From the animation, not hardcoded. lottie-web's SVG renderer sizes
        // itself to its container, so a container with no height draws a 0px
        // tall animation; this is what gives it one. `height: auto` is not
        // redundant — the library injects `:where(.lottie-display){height:100%}`
        // in a cascade layer, and `aspect-ratio` only computes a height when
        // height is `auto`.
        aspectRatio: `${animation.w} / ${animation.h}`,
        height: 'auto',
        // Clamped by the HEIGHT budget as well as the width, in CSS so it needs
        // no knowledge of the pane. Without it a wide box on a square animation
        // comes out taller than the viewport, and since a grid row sizes to its
        // content that does not clip — it grows the row and scrolls the page.
        // Expressing the ceiling as a WIDTH keeps the artwork at its intended
        // size rather than letterboxing it, which would quietly undo the
        // normalisation on short windows. `4rem` is the hero pane's `p-8`, top
        // and bottom.
        width: `min(${widthPct}%, calc((100vh - 4rem) * ${aspect}))`,
        // Negated: `fit` records where the artwork's centre IS, and this moves
        // it back to the middle of the pane.
        transform: `translate(${-(fit?.offsetXPct ?? 0)}%, ${-(fit?.offsetYPct ?? 0)}%)`,
      }}
      // Decorative, and it says nothing the heading beside it does not. A
      // described illustration here would make every screen-reader user listen
      // to a stock drawing before reaching the two fields they came for.
      aria-hidden="true"
    />
  )
}
