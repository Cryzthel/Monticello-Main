import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * The portal's one "pick exactly one of these" control.
 *
 * Timeframes (7d / 30d / 6m / 1yr), view switchers (Inbox / Archived), theme
 * pickers and page sub-navigation all render through here. Before this there
 * were fourteen hand-written copies of the same `.segmented` markup across the
 * two portals, each owning its own active branch, count pill and keyboard
 * story (mostly: no keyboard story).
 *
 * ── THE SLIDE ──────────────────────────────────────────────────────────────
 * Modelled on the oblong brief's reference capsule: a dark track and an
 * emerald pill that travels to the option you pick.
 *
 * The pill is NOT a box moving behind the labels. That version has a flaw you
 * can see in slow motion — the labels recolour on their own timer, so the new
 * label turns dark while the pill is still on its way to it. Instead the
 * labels are rendered twice (Emil Kowalski's clip-path tab technique): the
 * base row in idle colours, and an `aria-hidden` copy in the selected colours
 * on a brand fill, clipped to the selected segment's rectangle. Transitioning
 * the clip moves the pill and recolours every label at exactly the pixel the
 * pill's edge crosses it. It is paint-only, so nothing reflows during the
 * slide.
 *
 * The copy is positioned from MEASURED button rectangles, not by re-running
 * the flex layout, so it stays aligned when the track stretches (`fullWidth`)
 * or sits inside a scrolling wrapper. Put overflow on a WRAPPER, never on the
 * track: a scrollbar drawn inside a capsule reads as a rendering fault, and
 * the indicator layer would count towards the track's own scroll extent. A
 * ResizeObserver on the
 * track and every button re-measures when a count changes width, when a web
 * font finishes loading, or when a hidden panel becomes visible.
 *
 * ── ACCESSIBILITY ─────────────────────────────────────────────────────────
 * `kind="toggle"` renders a labelled group of `aria-pressed` buttons, the
 * shape every filter here already had. `kind="tabs"` renders a real tablist:
 * one tab stop, arrow keys move AND select (automatic activation — every panel
 * here is instant to show), Home/End jump to the ends. Arrow keys work in the
 * toggle group too; it costs nothing and the group is otherwise a row of Tab
 * presses.
 *
 * The mirrored copy is `aria-hidden`, so a screen reader hears each label
 * once.
 *
 * @param {object}   props
 * @param {Array<{value: string|number, label: React.ReactNode, shortLabel?: React.ReactNode,
 *                icon?: React.ComponentType, count?: number|string, title?: string,
 *                disabled?: boolean}>} props.options
 * @param {string|number} props.value
 * @param {(value: any) => void} props.onChange
 * @param {string}   props.ariaLabel      Names the group for assistive tech.
 * @param {'toggle'|'tabs'} [props.kind]
 * @param {'md'|'lg'} [props.size]         `lg` is the page sub-navigation tier.
 * @param {boolean}  [props.fullWidth]    Options share the track's width equally.
 * @param {boolean}  [props.mono]         Tabular-figure labels, for figure sets.
 * @param {string}   [props.idPrefix]     Tabs only: ids for aria-controls wiring.
 * @param {boolean}  [props.disabled]     Every option read-only (the selection still shows).
 * @param {string}   [props.className]    Extra classes on the track.
 * @param {string}   [props.segmentClassName] Extra classes on every segment.
 */
export default function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  kind = 'toggle',
  size = 'md',
  fullWidth = false,
  mono = false,
  idPrefix,
  disabled = false,
  className = '',
  segmentClassName = '',
}) {
  const trackRef = useRef(null)
  const originRef = useRef(null)
  const buttonRefs = useRef(new Map())
  const lastActiveRef = useRef(null)
  const [layout, setLayout] = useState(null)
  const [instant, setInstant] = useState(true)

  const isTabs = kind === 'tabs'
  const activeIndex = options.findIndex((option) => option.value === value)
  const optionKey = options.map((option) => option.value).join('|')

  const measure = useCallback(() => {
    const track = trackRef.current
    const origin = originRef.current
    if (!track || !origin) return

    // Fractional boxes, not offsetLeft/offsetWidth: those round to whole
    // pixels, and a label copy half a pixel off its twin visibly shimmers as
    // the pill passes over it.
    //
    // Measured from `origin` — a zero-size box pinned where the indicator
    // layer's own top-left corner will be — rather than from the track's edge
    // minus `clientLeft`. Under display scaling a 1px border renders at 0.8px
    // while `clientLeft` still reports 1, which put every mirrored label a
    // fifth of a pixel off. The probe also scrolls with the content, so a
    // scrolled track needs no scrollLeft arithmetic.
    //
    // Dividing by `scale` undoes a transform on an ancestor (a dialog
    // mid-entrance is at 98%), so the numbers are layout pixels. The layout
    // width comes from the computed style, which is fractional — offsetWidth
    // is rounded to a whole pixel, and on a narrow track that alone skewed the
    // scale by 0.2%, enough to ellipsise a label that fits.
    const trackBox = track.getBoundingClientRect()
    const originBox = origin.getBoundingClientRect()
    const layoutWidth = Number.parseFloat(getComputedStyle(track).width)
    const scale = layoutWidth > 0 && trackBox.width > 0 ? trackBox.width / layoutWidth : 1
    const rects = options.map((option) => {
      const button = buttonRefs.current.get(option.value)
      if (!button || !scale) return null
      const box = button.getBoundingClientRect()
      // Width rounds UP with a hair of slack. The engine snaps boxes to its
      // own sub-pixel grid, and a copy that lands 0.06px narrower than its
      // twin is enough to make a label that exactly fits show an ellipsis.
      // The label is centred, so the slack moves it by 0.01px.
      return {
        left: round((box.left - originBox.left) / scale),
        top: round((box.top - originBox.top) / scale),
        width: Math.ceil((box.width / scale + 0.05) * 100) / 100,
        height: round(box.height / scale),
      }
    })
    const active = rects[activeIndex]

    // A zero-sized selection means the control is not laid out (a hidden tab
    // panel, a collapsed drawer). Drop back to the static fill rather than
    // clipping to nothing, which would make the selection vanish.
    if (!active || active.width === 0) {
      setLayout(null)
      return
    }

    // The layer's size only has to COVER every segment: the clip is written
    // relative to the layer's own edges, so any width that does leaves the
    // visible pill exactly on the selected segment.
    const extent = rects.reduce(
      (acc, rect) => (rect ? { right: Math.max(acc.right, rect.left + rect.width), bottom: Math.max(acc.bottom, rect.top + rect.height) } : acc),
      { right: 0, bottom: 0 },
    )
    const width = round(Math.max(track.scrollWidth, extent.right))
    const height = round(Math.max(track.clientHeight, extent.bottom))
    const next = {
      width,
      height,
      rects,
      clip: `inset(${active.top}px ${round(width - active.left - active.width)}px ${round(
        height - active.top - active.height,
      )}px ${active.left}px round 6px)`,
    }

    // Only a change of SELECTION slides. A reflow — a window resize, a web
    // font landing, a count gaining a digit — moves the pill with the layout
    // in the same frame; gliding after it would read as the control lagging.
    const reflowOnly = lastActiveRef.current === activeIndex
    lastActiveRef.current = activeIndex

    setLayout((previous) => {
      const unchanged =
        previous &&
        previous.clip === next.clip &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.rects.every((rect, i) => sameRect(rect, next.rects[i]))
      if (unchanged) return previous
      if (previous && reflowOnly) setInstant(true)
      return next
    })
  }, [options, activeIndex])

  // The observer below calls through this ref, so it can stay connected
  // across renders instead of re-subscribing every time a parent passes a
  // fresh `options` array.
  const measureRef = useRef(measure)
  measureRef.current = measure

  // Before paint, so the first frame already shows the pill in place.
  useLayoutEffect(() => {
    measure()
  }, [measure])

  // Transitions are armed only after the first measured frame has painted.
  // Otherwise the pill would slide in from the track's corner on mount.
  useEffect(() => {
    if (!layout || !instant) return undefined
    const timer = setTimeout(() => setInstant(false), 0)
    return () => clearTimeout(timer)
  }, [layout, instant])

  useEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => measureRef.current())
    observer.observe(track)
    buttonRefs.current.forEach((button) => observer.observe(button))
    return () => observer.disconnect()
  }, [optionKey])

  function select(index) {
    const option = options[index]
    if (!option || option.disabled || disabled) return
    if (option.value !== value) onChange(option.value)
  }

  function handleKeyDown(event) {
    if (disabled) return
    const enabled = options.map((option, i) => (option.disabled ? null : i)).filter((i) => i !== null)
    if (!enabled.length) return
    const position = enabled.indexOf(activeIndex)

    let target = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      target = enabled[(position + 1 + enabled.length) % enabled.length]
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      target = enabled[(position - 1 + enabled.length) % enabled.length]
    } else if (event.key === 'Home') {
      target = enabled[0]
    } else if (event.key === 'End') {
      target = enabled[enabled.length - 1]
    }
    if (target === null || target === undefined) return

    event.preventDefault()
    select(target)
    // Focus follows the selection directly rather than on the next frame:
    // rAF-deferred focus is not guaranteed to run in a backgrounded tab.
    buttonRefs.current.get(options[target].value)?.focus({ preventScroll: false })
  }

  const sizeClass = size === 'lg' ? 'segment-lg' : ''
  const widthClass = fullWidth ? 'flex-1 basis-0' : ''
  // Equal-width figures in the UI face; the mono face read as costume beside
  // the Inter labels around it (2026-09-22).
  const labelClass = mono ? 'tabular-nums' : ''
  // One step for both sizes now. The old ladder was 16 against 14 — a
  // difference nobody could see, bought at the price of a second number.
  const iconSize = 'sm'

  return (
    <div
      ref={trackRef}
      role={isTabs ? 'tablist' : 'group'}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={`segmented ${fullWidth ? 'flex w-full' : ''} ${disabled ? 'opacity-60' : ''} ${className}`}
      data-indicator={layout ? 'ready' : 'static'}
    >
      <span ref={originRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-0 w-0" />
      {options.map((option, index) => {
        const active = index === activeIndex
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) buttonRefs.current.set(option.value, node)
              else buttonRefs.current.delete(option.value)
            }}
            type="button"
            id={isTabs && idPrefix ? `${idPrefix}-tab-${option.value}` : undefined}
            role={isTabs ? 'tab' : undefined}
            aria-selected={isTabs ? active : undefined}
            aria-controls={isTabs && idPrefix ? `${idPrefix}-panel-${option.value}` : undefined}
            aria-pressed={isTabs ? undefined : active}
            tabIndex={isTabs ? (active ? 0 : -1) : undefined}
            title={option.title}
            disabled={disabled || option.disabled}
            onClick={() => select(index)}
            onKeyDown={handleKeyDown}
            // The base row always wears idle colours once the indicator is
            // live; the selected look comes from the clipped layer above it.
            className={`segment ${sizeClass} ${widthClass} ${
              active && !layout ? 'segment-active' : 'segment-idle'
            } ${active ? 'cursor-default' : ''} ${segmentClassName}`}
          >
            <SegmentContent option={option} labelClass={labelClass} iconSize={iconSize} />
          </button>
        )
      })}

      {layout ? (
        <div
          aria-hidden="true"
          className="segmented-indicator"
          data-instant={instant ? 'true' : 'false'}
          style={{ width: layout.width, height: layout.height, clipPath: layout.clip }}
        >
          {options.map((option, index) => {
            const rect = layout.rects[index]
            if (!rect) return null
            return (
              <span
                key={option.value}
                className={`segment ${sizeClass} ${segmentClassName}`}
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              >
                <SegmentContent option={option} labelClass={labelClass} iconSize={iconSize} />
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/**
 * One segment's contents. Rendered identically in both layers — any
 * difference between the two (an icon in one, a different truncation in the
 * other) would show as a label that jumps when the pill arrives.
 */
function SegmentContent({ option, labelClass, iconSize }) {
  const Icon = option.icon
  return (
    <>
      {Icon ? <Icon size={iconSize} /> : null}
      {option.shortLabel ? (
        <>
          <span className={`truncate sm:hidden ${labelClass}`}>{option.shortLabel}</span>
          <span className={`hidden truncate sm:inline ${labelClass}`}>{option.label}</span>
        </>
      ) : (
        <span className={`truncate ${labelClass}`}>{option.label}</span>
      )}
      {option.count !== undefined && option.count !== null ? (
        <span className="count-pill">{option.count}</span>
      ) : null}
    </>
  )
}

// Hundredths of a pixel: precise enough to land on the same device pixel as
// the button, coarse enough that float noise does not register as a change.
function round(n) {
  return Math.round(n * 100) / 100
}

function sameRect(a, b) {
  if (!a || !b) return a === b
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}
