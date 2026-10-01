import { useEffect, useState } from 'react'
import { Crosshair, Loader2, Maximize2, Minimize2, Minus, Plus } from '@shared/icons'
import Tooltip from '@shared/components/Tooltip'
import { containsPoint } from '@shared/lib/subdivisionBoundary'

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

export default function MapControls({ map, ready, compact = false, maximized = false, onToggleMaximized }) {
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
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <>
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col gap-2">
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
