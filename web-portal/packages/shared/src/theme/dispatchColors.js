/**
 * The dispatch map's unit and route colours, in one place so the map layers,
 * the legend, the route badge and the drawer cannot drift apart.
 *
 * Plain hex rather than theme tokens: Mapbox paint properties take colour
 * strings, not CSS variables, and these must match on both basemaps anyway.
 */

/** Unit markers, by what the officer is doing. */
export const UNIT_COLORS = {
  available: '#22C55E', // green-500 — on duty, no call
  responding: '#F97316', // orange-500 — accepted and moving (flashing)
  on_scene: '#3B82F6', // blue-500 — arrived, through investigation
}

/**
 * Route lines. `live` is emerald-500, the mobile app's accent: the officer has
 * accepted and is moving along it. `preview` is blue-500: a unit picked but
 * not committed, or dispatched and not yet acknowledged.
 */
export const ROUTE_TONE_COLORS = {
  live: '#10B981',
  preview: '#3B82F6',
}
