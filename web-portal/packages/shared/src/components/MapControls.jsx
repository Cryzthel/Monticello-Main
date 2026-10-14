import { useEffect, useState } from 'react'
import { Crosshair, Loader2, Maximize2, Minimize2, Minus, Plus, RotateCcw } from '@shared/icons'
import Tooltip from '@shared/components/Tooltip'
import { boundaryMaxBounds, containsPoint } from '@shared/lib/subdivisionBoundary'
import { ONE_SHOT_POSITION_OPTIONS, isUsableFix } from '@shared/lib/geolocation'

/**
 * The map's floating control toolbar.
 *
 * Replaces Mapbox's built-in NavigationControl and FullscreenControl, which
 * ship a white chrome with their own border radius and shadow — a bright
 * rounded box sitting on a near-black dashboard over dark tiles. Restyling
 * them means overriding `.mapboxgl-ctrl-*` selectors, which is brittle across
 * SDK upgrades; rebuilding them is less code and gives us tooltips, grouping
 * and the portal's own tokens for free.
 *
 * GROUPED, not a single stack: the clusters are separated by a gap so the
 * toolbar reads as "move the camera" / "find me, go big" rather than one
 * undifferentiated column of icons. Each cluster is a single rounded surface
 * with hairline dividers between its buttons.
 *
 * ── FOUR BUTTONS, NOT SIX ─────────────────────────────────────────────────
 * "Reset view" (fit the subdivision) and "Reset bearing" (ease back to north)
 * are deleted. Both undid a camera move the operator had just chosen, and
 * neither was reachable for a reason: the map opens fitted to the boundary and
 * flat, so on the overwhelming majority of sessions both buttons were offering
 * to restore a state the camera had never left. What is left is the set a
 * dispatcher actually drives — zoom, find me, go big.
 *
 * The compass needle went with them. It doubled as an orientation readout, but
 * it was a readout of a rotation the user had to perform deliberately (ctrl +
 * drag), and a permanent control whose only job is to describe a state nobody
 * is in is exactly the clutter this pass removes. Rotation itself is
 * untouched — the gesture still works, it simply has no button.
 *
 * Tooltips are placed LEFT — the toolbar hugs the right edge of the map, and
 * a right-placed label would be clipped by the viewport.
 */

function ControlButton({ icon: Icon, label, hint, onClick, disabled, active, busy }) {
  return (
    <Tooltip label={label} hint={hint} side="left">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        className={`flex h-9 w-9 items-center justify-center transition-[color,background-color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40 ${
          active
            ? 'bg-brand-100 text-brand-400'
            : 'text-text-secondary hover:bg-tint/[0.08] hover:text-text-primary'
        }`}
      >
        {busy ? <Loader2 size="sm" className="animate-spin" /> : <Icon size="sm" />}
      </button>
    </Tooltip>
  )
}

/** One rounded surface; children are divided by hairlines. */
function Cluster({ children }) {
  return (
    <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-hairline bg-base-850 shadow-overlay divide-y divide-hairline">
      {children}
    </div>
  )
}

export default function MapControls({
  map,
  ready,
  compact = false,
  maximized = false,
  onToggleMaximized,
  /**
   * The basemap, and how to change it: `{ key, options, onChange }` or null.
   *
   * ── IT IS PROPS NOW, NOT A RENDERED NODE ────────────────────────────────
   * It arrived here as a `header` node on the grounds that this component owns
   * a position and has no business knowing what a basemap is. That held while
   * the control was a labelled segmented capsule — an opaque box that only
   * needed somewhere to sit.
   *
   * It no longer is. An icon-only toggle has to live in the same cluster as
   * zoom and locate, share their 36px square, their hairline dividers and
   * their left-placed tooltips; a node passed in from outside would have to
   * reproduce all of that and then keep matching it. So the DATA crosses the
   * boundary and the rendering stays here with the buttons it has to look
   * like, which is the arrangement the rest of this toolbar already uses.
   *
   * `options` is the caller's list of `{ value, label, icon }`. This component
   * still does not know what the styles ARE — only that there are two of them
   * and which one is on, which is the minimum a toggle can be built from.
   */
  basemap = null,
}) {
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')

  // The `rotate` subscription that kept a compass needle in sync went with the
  // compass. Nothing in this toolbar reads the bearing now, so re-rendering
  // the control column on every frame of a rotation gesture bought nothing.

  useEffect(() => {
    if (!locateError) return undefined
    const timer = setTimeout(() => setLocateError(''), 6000)
    return () => clearTimeout(timer)
  }, [locateError])

  if (!map || !ready) return null

  function locate() {
    if (!navigator.geolocation) {
      setLocateError('This browser has no location support.')
      return
    }
    setLocating(true)
    setLocateError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false)
        /**
         * ── THE SAME COARSE-FIX CHECK THE TELEMETRY STREAM MAKES ───────────
         * `enableHighAccuracy` is a request, and a desktop with no Wi-Fi radio
         * answers it from its IP address: thousands of metres, pointing at an
         * ISP exchange. Flying the camera there at zoom 18 is a button that
         * visibly lies, and it lies MORE confidently than doing nothing — the
         * operator gets a street view of a place they have never been, with no
         * cue that the fix was a guess.
         *
         * So it says so and stays put, using the notice this control already
         * owns. See `isUsableFix` for why the line is where it is.
         */
        if (!isUsableFix(coords)) {
          setLocateError(
            'Your device could not pin down a position — it answered to the nearest few kilometres. On a laptop, switch Wi-Fi on; a wired desktop has nothing to locate with.',
          )
          return
        }
        const point = { lat: coords.latitude, lng: coords.longitude }
        // This used to refuse outright, because a fenced camera would silently
        // clamp the flight to the nearest edge and read as a broken button.
        // The camera is no longer fenced, so it centres either way — a guard
        // on patrol past the gate is a normal thing to be — and the notice is
        // now informational rather than a refusal.
        if (!containsPoint(point)) {
          setLocateError('Centred on you — note you are outside Monticello Villas.')
        }
        // A fixed 18 rather than `getMaxZoom() - 1`. The ceiling is now 22, so
        // the old expression would have dropped the operator to 21 — deep
        // enough that a single house fills the viewport and all context is
        // gone. 18 puts them on their own street.
        map.easeTo({ center: [point.lng, point.lat], zoom: Math.max(map.getZoom(), 18), duration: 800 })
      },
      (err) => {
        setLocating(false)
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied in your browser.'
            : 'Could not get your location.',
        )
      },
      ONE_SHOT_POSITION_OPTIONS,
    )
  }

  /**
   * Fit the whole estate, flat and north-up.
   *
   * ── THIS BUTTON WAS DELETED ONCE, AND IT IS NOT THE SAME BUTTON ──────────
   * An earlier pass removed a "Reset view" control, and the reasoning was
   * sound at the time: the map opened fitted to the boundary and flat, nothing
   * could rotate or tilt it, so on almost every session the button was
   * offering to restore a state the camera had never left.
   *
   * That stopped being true when the dispatch map got a turn-by-turn camera.
   * A navigation session now moves the camera to zoom 17.5 and pitch 50 and
   * holds it there, following an officer across the subdivision; ending one
   * leaves the operator wherever that officer finished, at street zoom. There
   * is now a state to come back FROM, and the gestures that would otherwise
   * get you there — rotate and pitch — are deliberately disabled, so for
   * bearing and pitch this is the only way back.
   *
   * ── THE SAME BOUNDS AND PADDING THE MAP OPENS WITH ──────────────────────
   * `boundaryMaxBounds()` and `padding: 32`, copied from the mount effect
   * deliberately rather than chosen to look right. "Reset" has to land on the
   * view the map started at, and a second set of numbers here would be a
   * reset that goes somewhere the map has never been — close enough that
   * nobody notices, which is worse than visibly wrong.
   *
   * Derived from the boundary file rather than stored, so it also cannot drift
   * when the perimeter is re-traced.
   */
  function resetView() {
    map.fitBounds(boundaryMaxBounds(), {
      padding: 32,
      pitch: 0,
      bearing: 0,
      duration: 900,
      essential: true,
    })
  }

  return (
    <>
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col gap-2">
        {/* ── VIEW — what the map is drawn on, and how far back you stand ───
            Its own cluster above the camera controls, because these two change
            what you can SEE rather than where you are looking. The basemap
            toggle is paired with Reset view on purpose: both are the controls
            an operator reaches for when the map has stopped telling them what
            they need, and neither is reachable by gesture.

            ── ICON-ONLY, AND WHY THAT IS NOT A LOSS HERE ─────────────────
            The labelled capsule this replaces measured 181px and had to shrink
            its own words on a phone to avoid colliding with the controls
            drawer. The labels were buying very little: with exactly two
            basemaps the control is a toggle, and the CANVAS is the state
            readout — satellite imagery and a street map are not something an
            operator can mistake for one another, so a caption naming the one
            they are already looking at is 181px spent on confirmation.

            The glyph therefore shows the DESTINATION, not the current state —
            the satellite dish when you are on streets, the map when you are on
            satellite — so the button answers "what happens if I press this",
            which is the only thing a toggle is ever asked. The tooltip says it
            in words for anyone who wants them. */}
        {basemap?.options?.length === 2 ? (
          <Cluster>
            {(() => {
              const other =
                basemap.options.find((option) => option.value !== basemap.key) ?? basemap.options[0]
              const Icon = other.icon
              return (
                <ControlButton
                  icon={Icon}
                  label={`Switch to ${String(other.label).toLowerCase()}`}
                  hint="Basemap"
                  onClick={() => basemap.onChange?.(other.value)}
                />
              )
            })()}
            <ControlButton
              icon={RotateCcw}
              label="Reset view"
              hint="Fit Monticello Villas, north up"
              onClick={resetView}
            />
          </Cluster>
        ) : null}

        {/* Navigation — move the camera. Two buttons: the two the scroll
            wheel already does, kept for a trackpad and for touch. */}
        <Cluster>
          <ControlButton icon={Plus} label="Zoom in" hint="Scroll up" onClick={() => map.zoomIn({ duration: 300 })} />
          <ControlButton icon={Minus} label="Zoom out" hint="Scroll down" onClick={() => map.zoomOut({ duration: 300 })} />
        </Cluster>

        {/* Action — find me, go big. */}
        {compact ? null : (
          <Cluster>
            <ControlButton
              icon={Crosshair}
              label="My location"
              hint="Centre on your position"
              onClick={locate}
              busy={locating}
            />
            <ControlButton
              icon={maximized ? Minimize2 : Maximize2}
              label={maximized ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={onToggleMaximized}
              active={maximized}
            />
          </Cluster>
        )}
      </div>

      {locateError ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 ml-3 max-w-[16rem] translate-x-0 rounded-xl border border-warning/30 bg-base-900 px-3 py-2 text-xs text-warning shadow-overlay"
          style={{ right: '3.75rem' }}
        >
          {locateError}
        </div>
      ) : null}
    </>
  )
}
