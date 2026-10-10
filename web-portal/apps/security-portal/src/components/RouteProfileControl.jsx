import SegmentedControl from '@shared/components/SegmentedControl'
import { ROUTE_PROFILES } from '@/lib/directions'

const PROFILE_OPTIONS = Object.values(ROUTE_PROFILES).map((option) => ({
  value: option.key,
  label: option.label,
}))

/**
 * Which road network the route is plotted on: the patrol graph, or walking.
 *
 * ── IT MOVED OFF THE ROUTE PANEL, AND IT IS NOT A LABEL ────────────────────
 * It sat in the panel's action bar as a Ride / Walk segmented control, beside
 * Start navigation, and was read as a redundant caption for the transport
 * glyph already on the card. It is not a caption. It changes which Mapbox
 * profile the Directions request uses, which changes the line, the distance
 * and the ETA — `mapbox/driving` follows the road network a patrol actually
 * uses, and `mapbox/walking` is the one that gets through a gated estate when
 * the driving graph refuses a road OpenStreetMap has tagged private.
 *
 * So the TEXT came off the panel, where it was competing with the figures,
 * and the CONTROL came here — beside Follow, Voice and Simulation, which are
 * the other things that change how a response is being watched rather than
 * what the response is. Deleting it outright would have removed the only way
 * to re-plot a route the driving graph got wrong, with no replacement.
 */
export default function RouteProfileControl({ profile, disabled, onChange }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs leading-relaxed text-text-secondary">
        {disabled
          ? 'Available once a unit is routed to a call.'
          : 'Which network to plot on. Walk gets through gates and paths the patrol graph refuses.'}
      </p>
      <SegmentedControl
        ariaLabel="Routing profile"
        className="w-full"
        options={PROFILE_OPTIONS}
        value={profile}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  )
}
