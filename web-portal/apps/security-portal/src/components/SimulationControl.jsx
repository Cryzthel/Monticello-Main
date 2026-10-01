import { FlaskConical, Pause, Play } from '@shared/icons'

/**
 * The switch that starts a simulated unit moving along the plotted route.
 *
 * ── WHY IT LIVES IN THE CONTROLS DRAWER ─────────────────────────────────────
 * This is the only control in either console that makes the map show something
 * that is not happening. It therefore sits at the bottom of the map's controls
 * drawer, which is collapsed by default — two deliberate actions from the map,
 * and nowhere near the acknowledge and resolve buttons that a dispatcher
 * actually presses during a call.
 *
 * It is deliberately NOT on the navigation card. That card is what an officer
 * reads while responding to an emergency, and a control that fakes the
 * emergency does not belong a thumb's width from one that resolves it.
 *
 * ── WHAT IT SAYS WHEN IT CANNOT RUN ─────────────────────────────────────────
 * With no route plotted there is nothing to walk along. The control stays
 * visible and explains itself rather than vanishing, because a demonstrator
 * hunting for a switch that disappeared will go looking in the wrong places.
 */
export default function SimulationControl({ running, disabled, onToggle, profileLabel }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs leading-relaxed text-text-secondary">
        Moves a pretend unit along the plotted route at {profileLabel.toLowerCase()} speed, for showing
        the navigation view without a unit on the road.{' '}
        {/* Said on the control itself, not only in a docblock: the person
            reaching for this is often demonstrating to someone who will ask
            whether it touches the real system. */}
        <span className="font-medium text-text-primary">
          Nothing is saved and no other console sees it.
        </span>
      </p>

      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={running}
        className={`btn btn-sm w-full justify-center ${running ? 'btn-outline' : 'btn-outline'}`}
      >
        {running ? (
          <Pause size="sm" aria-hidden="true" />
        ) : (
          <Play size="sm" aria-hidden="true" />
        )}
        {running ? 'Stop simulation' : 'Simulate movement'}
      </button>

      {disabled ? (
        <p className="text-2xs leading-snug text-text-muted">
          Plot a route first — acknowledge a call, or pick a unit for one.
        </p>
      ) : null}

      {running ? (
        <p className="flex items-center gap-1.5 text-2xs font-medium leading-snug text-warning">
          <FlaskConical size="sm" aria-hidden="true" className="shrink-0" />
          The map is showing simulated movement.
        </p>
      ) : null}
    </div>
  )
}
