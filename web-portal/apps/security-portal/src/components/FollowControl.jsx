import { Crosshair } from '@shared/icons'

/**
 * Lock the camera to the responding unit, or let it go.
 *
 * ── WHY THIS IS A TOGGLE AND NOT A "RE-CENTRE" BUTTON ───────────────────────
 * A Recentre button used to exist on the dispatch drawer and was removed for
 * being a second way to do what clicking the marker already did. This is not
 * that button coming back: a one-shot recentre moves the camera once and the
 * unit immediately starts walking back out of frame. Following is a MODE, and
 * the thing worth controlling is whether the camera keeps up, not where it is
 * right now.
 *
 * ── IT TURNS ITSELF OFF ─────────────────────────────────────────────────────
 * The map reports the first drag, scroll or pinch and the mode ends. So the
 * label reads "Follow unit" when idle and offers to resume once the operator
 * has taken the camera back — the toggle reflects what the camera is doing,
 * rather than asserting a state the last gesture already overruled.
 */
export default function FollowControl({ following, disabled, onToggle }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs leading-relaxed text-text-secondary">
        {disabled
          ? 'Available once a unit is routed to a call.'
          : following
            ? 'The camera is riding with the unit. Pan, scroll or pinch to take it back.'
            : 'Keeps the camera on the responding unit as it moves.'}
      </p>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={following}
        className={`btn btn-sm w-full ${following ? 'btn-success' : 'btn-outline'}`}
      >
        <Crosshair size="sm" aria-hidden="true" />
        {following ? 'Following — stop' : 'Follow unit'}
      </button>
    </div>
  )
}
