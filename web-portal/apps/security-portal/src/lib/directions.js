/**
 * Mapbox Directions for the Live Dispatch map's Acknowledge & Respond flow.
 *
 * ── PURE, APART FROM ONE fetch ─────────────────────────────────────────────
 * Everything except `fetchRoute` is plain data in, plain data out, so the URL,
 * the response parsing and the formatting can be exercised without a token or
 * a network — and so the shared map component never learns the Directions
 * API's response shape. It is handed a GeoJSON FeatureCollection and nothing
 * else (see `routeToGeojson`).
 *
 * ── WHAT LEAVES THE BUILDING ───────────────────────────────────────────────
 * A route request sends Mapbox two coordinates: the incident pin and the
 * responding officer's position. That is the price of routing at all — the
 * API cannot plan a path it is not told the ends of — and it goes to the same
 * vendor, on the same token, that already serves the basemap. Nothing else
 * about the report (resident, category, narrative) is sent.
 */

/**
 * The two routing graphs an officer can choose between.
 *
 * Driving is the default because wherever a road exists it is the faster
 * response. Walk is one press away, for a unit on foot and for the case the
 * driving graph gets wrong inside a gated estate: a road OpenStreetMap tags as
 * private, which driving will route around or refuse outright.
 *
 * `mapbox/driving`, not `mapbox/driving-traffic`. There is no live traffic on
 * subdivision streets for the traffic profile to use, so it would only add
 * its tighter request limits.
 */
export const ROUTE_PROFILES = {
  driving: { key: 'driving', label: 'Ride', mapbox: 'mapbox/driving', transport: 'bike', simKmh: 22 },
  walking: { key: 'walking', label: 'Walk', mapbox: 'mapbox/walking', transport: 'foot', simKmh: 5 },
}

/**
 * `transport` names the icon, not the routing graph.
 *
 * The graph stays `mapbox/driving` because that is the road network a patrol
 * uses, and Mapbox has no motorcycle profile. What changed is the label and
 * the glyph: a Monticello patrol answers calls on two wheels, so "Drive" and a
 * car said the wrong thing about who is coming. `mapbox/cycling` was NOT
 * substituted — it prefers paths and avoids roads a patrol bike legitimately
 * rides, so it would plan a worse route to make an icon literal.
 *
 * `simKmh` is used ONLY by the route simulator (see useRouteSimulation). It is
 * not an estimate of anything and never reaches a real ETA — those come from
 * Mapbox's own duration for the profile.
 */

export const DEFAULT_ROUTE_PROFILE = 'driving'

export function routeProfile(key) {
  return ROUTE_PROFILES[key] ?? ROUTE_PROFILES[DEFAULT_ROUTE_PROFILE]
}

/**
 * A routing failure an officer can read.
 *
 * `code` is for branching, `message` is for the screen. Every message says
 * what happened in the officer's terms rather than echoing an HTTP status,
 * because the person reading it is mid-response and cannot act on "422".
 */
export class RouteError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RouteError'
    this.code = code
  }
}

const DIRECTIONS_ENDPOINT = 'https://api.mapbox.com/directions/v5'

// Six decimals is ~11 cm — finer than any fix a phone produces, and short
// enough that the URL stays readable in a network log.
function formatCoordinate([lng, lat]) {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`
}

/**
 * `overview=full`, not the default `simplified`. Simplification generalises
 * the line for the zoom that fits the WHOLE route, and a subdivision route is
 * viewed at z17-18 — where a simplified line visibly cuts corners across
 * lots, which is the one thing a line meant to be followed must not do.
 */
export function buildDirectionsUrl({ origin, destination, profile, token }) {
  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    // `steps=true` costs nothing extra on the same request and is what turns a
    // line on a map into directions somebody can follow while moving. Without
    // it the officer gets a shape and a number; with it they get "turn left
    // onto Phase 1 Main Road".
    steps: 'true',
    access_token: token,
  })
  return `${DIRECTIONS_ENDPOINT}/${routeProfile(profile).mapbox}/${formatCoordinate(origin)};${formatCoordinate(destination)}?${params}`
}

/**
 * Mapbox maneuver types, mapped to the turn glyph the list shows.
 *
 * Keyed on `maneuver.type` first and `maneuver.modifier` second, which is the
 * shape the API actually answers with: a single `turn` type carries every
 * direction in its modifier, so branching on type alone would draw the same
 * arrow for a left and a right.
 */
export const MANEUVER_ICONS = {
  depart: 'depart',
  arrive: 'arrive',
  'turn:left': 'left',
  'turn:right': 'right',
  'turn:sharp left': 'sharp-left',
  'turn:sharp right': 'sharp-right',
  'turn:slight left': 'slight-left',
  'turn:slight right': 'slight-right',
  'turn:straight': 'straight',
  'turn:uturn': 'uturn',
  continue: 'straight',
  'continue:left': 'slight-left',
  'continue:right': 'slight-right',
  'continue:uturn': 'uturn',
  merge: 'straight',
  'fork:left': 'slight-left',
  'fork:right': 'slight-right',
  'end of road:left': 'left',
  'end of road:right': 'right',
  roundabout: 'roundabout',
  rotary: 'roundabout',
  'roundabout turn': 'roundabout',
  'new name': 'straight',
  notification: 'straight',
}

/** The glyph key for one maneuver, always something renderable. */
export function maneuverIcon(maneuver) {
  const type = String(maneuver?.type ?? '').toLowerCase()
  const modifier = String(maneuver?.modifier ?? '').toLowerCase()
  return (
    MANEUVER_ICONS[`${type}:${modifier}`] ??
    MANEUVER_ICONS[type] ??
    MANEUVER_ICONS[`turn:${modifier}`] ??
    'straight'
  )
}

/**
 * The turn-by-turn list, flattened out of the response's legs.
 *
 * ── WHY FLATTEN ─────────────────────────────────────────────────────────────
 * Directions nests steps inside legs, one leg per pair of waypoints. This
 * request has exactly two waypoints and therefore one leg, so the nesting adds
 * a level for a case that cannot occur here — and a `legs[0].steps` reach
 * spread through the UI would break silently the day a via-point is added.
 * Flattening once, here, is the same choice `routeToGeojson` makes about the
 * geometry: the components never learn the API's shape.
 *
 * `instruction` comes from `maneuver.instruction`, which is Mapbox's own
 * localised sentence. It is not reassembled from type and street name — doing
 * that produces "Turn left onto " whenever a road is unnamed, and unnamed
 * roads are most of a subdivision.
 *
 * The final `arrive` step is kept. Its distance is 0 and it reads "You have
 * arrived", which is the one line that tells an officer the list is finished
 * rather than truncated.
 */
export function parseSteps(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : []
  const steps = []

  legs.forEach((leg) => {
    const legSteps = Array.isArray(leg?.steps) ? leg.steps : []
    legSteps.forEach((step) => {
      const instruction = step?.maneuver?.instruction
      if (!instruction) return
      steps.push({
        instruction,
        /** Metres travelled along THIS step, before the next maneuver. */
        distance: Number.isFinite(step.distance) ? step.distance : 0,
        duration: Number.isFinite(step.duration) ? step.duration : 0,
        /** The road being travelled, when it has a name. */
        name: typeof step.name === 'string' && step.name.trim() ? step.name.trim() : '',
        icon: maneuverIcon(step.maneuver),
        type: step?.maneuver?.type ?? '',
      })
    })
  })

  return steps
}

/**
 * The fastest route out of a Directions response, or a RouteError.
 *
 * `routes[0]` IS the fastest: the request does not ask for alternatives, so
 * the API returns its single recommended route. `NoRoute` and `NoSegment`
 * arrive as HTTP 200 with a code rather than as errors, which is why the code
 * is checked here and not only the status in `fetchRoute`.
 */
export function parseDirectionsResponse(body, { origin, destination, profile }) {
  const best = body?.routes?.[0]
  if (body?.code !== 'Ok' || !best?.geometry) {
    if (body?.code === 'NoSegment') {
      throw new RouteError('no-segment', 'One end of the route is too far from any mapped road or path.')
    }
    // "— try Walk" pointed at the Ride / Walk control, which has been deleted
    // (see the profile note in DashboardPage). Advice naming a control that is
    // not there teaches an officer the console is hiding something.
    throw new RouteError(
      'no-route',
      profile === 'walking'
        ? 'No walking route reaches this pin.'
        : 'No road route reaches this pin. Navigate to the nearest gate and proceed on foot.',
    )
  }

  const waypoints = body.waypoints ?? []
  return {
    profile: routeProfile(profile).key,
    steps: parseSteps(best),
    /** Metres. */
    distance: best.distance,
    /** Seconds. */
    duration: best.duration,
    geometry: best.geometry,
    origin,
    destination,
    // Where the API joined each end to the road graph — see routeToGeojson.
    snappedOrigin: waypoints[0]?.location ?? null,
    snappedDestination: waypoints[waypoints.length - 1]?.location ?? null,
  }
}

function httpRouteError(status, body) {
  if (status === 401 || status === 403) {
    return new RouteError('unauthorized', 'Mapbox refused the token for directions. Check its scopes and URL restrictions.')
  }
  if (status === 429) {
    return new RouteError('rate-limited', 'Routing is rate-limited right now. Try again in a moment.')
  }
  if (status === 422 && body?.message) {
    return new RouteError('invalid', `Mapbox could not route this: ${body.message}`)
  }
  return new RouteError('http', `The routing service answered with an error (${status}).`)
}

/**
 * Fetch the fastest route between two `[lng, lat]` points.
 *
 * An abort is rethrown untouched rather than wrapped, so a caller that
 * superseded this request can tell "I cancelled it" from "it failed" and stay
 * silent about the former.
 */
export async function fetchRoute({
  origin,
  destination,
  profile = DEFAULT_ROUTE_PROFILE,
  token = import.meta.env.VITE_MAPBOX_TOKEN,
  signal,
}) {
  if (!token) {
    throw new RouteError('no-token', 'Routing is unavailable: no Mapbox token is configured.')
  }

  let response
  try {
    response = await fetch(buildDirectionsUrl({ origin, destination, profile, token }), { signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new RouteError('network', 'Could not reach the routing service. Check this console’s connection.')
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) throw httpRouteError(response.status, body)
  return parseDirectionsResponse(body, { origin, destination, profile })
}

const EARTH_RADIUS_M = 6371008.8

/** Great-circle distance between two `[lng, lat]` points, in metres. */
export function distanceMeters([lng1, lat1], [lng2, lat2]) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

// Below this, a connector would be a dash hidden under the origin dot or the
// incident pin, so it is not drawn.
const CONNECTOR_MIN_METERS = 3

/**
 * The route as the map draws it: one FeatureCollection, each feature tagged
 * with a `kind` the map's layers filter on.
 *
 *   route      the road-following line Mapbox returned — or, once the unit
 *              has started moving, only the part still AHEAD of it
 *   covered    the part already travelled, drawn muted behind the live line.
 *              Kept rather than trimmed away: a dispatcher glancing at the map
 *              needs to see the whole path to judge whether a unit is going
 *              the sensible way, and a line that erases itself as the unit
 *              advances takes that away exactly as the call gets interesting
 *   connector  a dashed straight leg from each true end to where the route
 *              joins the road graph
 *   origin     where the route starts, drawn only when that is not a live
 *              unit (the guardhouse fallback): a unit is its own marker
 *
 * Every feature carries `tone` ('live' | 'preview'), which colours it.
 *
 * ── WHY THE CONNECTORS EXIST ──────────────────────────────────────────────
 * The Directions API snaps both ends to the nearest routable segment, so the
 * line it returns stops at the STREET, not at the pin. A report pinned at the
 * back of a lot would get a route that visibly ends short of the incident,
 * which reads as "the route does not go there". The dashed leg shows the last
 * metres — and dashed, because they are not a road and must not look like one.
 */
export function routeToGeojson(route, { tone = 'live', withOrigin = true, progress = null } = {}) {
  // With a live fix on the line, the route is drawn in two pieces so the
  // travelled part can recede. Without one it stays a single line, which is
  // also what a preview should look like.
  const features = progress
    ? [
        {
          type: 'Feature',
          properties: { kind: 'route', tone },
          geometry: { type: 'LineString', coordinates: progress.remainingCoords },
        },
        {
          type: 'Feature',
          properties: { kind: 'covered', tone },
          geometry: { type: 'LineString', coordinates: progress.coveredCoords },
        },
      ]
    : [{ type: 'Feature', properties: { kind: 'route', tone }, geometry: route.geometry }]

  const connect = (from, to) => {
    if (!from || !to || distanceMeters(from, to) < CONNECTOR_MIN_METERS) return
    features.push({
      type: 'Feature',
      properties: { kind: 'connector', tone },
      geometry: { type: 'LineString', coordinates: [from, to] },
    })
  }
  connect(route.origin, route.snappedOrigin)
  connect(route.snappedDestination, route.destination)

  if (withOrigin) {
    features.push({
      type: 'Feature',
      // `transport` rides along on the feature rather than arriving as a prop on
      // the map: the map already takes this route as a FeatureCollection and
      // nothing else, and a second channel for one string would be the first
      // crack in that. The symbol layer reads it with ['get', 'transport'].
      properties: { kind: 'origin', tone, transport: routeProfile(route.profile).transport },
      geometry: { type: 'Point', coordinates: route.origin },
    })
  }

  return { type: 'FeatureCollection', features }
}

/** "40 m", "1.2 km". Rounded to 10 m — a route is not measured to the metre. */
export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—'
  if (meters < 10) return '<10 m'
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

/** "<1 min", "4 min", "1 h 5 min". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * ── WHAT TIME THE UNIT GETS THERE ──────────────────────────────────────────
 *
 * "6 min" and "2:44 PM" are the same fact and they are not interchangeable.
 * A duration answers "how long until this is handled", which is the
 * dispatcher's question; a clock time answers "when can I tell the resident
 * somebody will be at the gate", which is the question they are asked on the
 * phone while they watch the map. Doing that arithmetic in your head, under
 * load, against a number that keeps changing, is exactly the sort of thing a
 * console should have already done.
 *
 * ── IT TAKES `now` RATHER THAN READING THE CLOCK ───────────────────────────
 * Two reasons, and the second is the one that matters. The obvious one is that
 * a function reading `Date.now()` cannot be tested. The real one is that React
 * will not recompute a memo because time passed — so a component rendering
 * `arrivalAt(duration)` would print the arrival time computed at the instant
 * the last Firestore write happened to land, and keep printing it. Taking
 * `now` forces the caller to own a ticking clock (see useMetricsClock), which
 * is the only way this number stays true.
 */
export function arrivalAt(remainingDurationS, now = Date.now()) {
  if (!Number.isFinite(remainingDurationS) || remainingDurationS < 0) return null
  if (!Number.isFinite(now)) return null
  return new Date(now + remainingDurationS * 1000)
}

/**
 * "2:44 PM" — a wall-clock time, in the operator's own locale.
 *
 * ── THE LOCALE IS THE BROWSER'S, DELIBERATELY ──────────────────────────────
 * `undefined` as the locale means "whatever this machine is set to", so a
 * guardhouse console set to en-PH shows a 12-hour clock and one set to a
 * 24-hour locale shows 14:44. Hardcoding `en-US` would have made the format
 * match the brief's example everywhere and been wrong on the actual hardware;
 * hardcoding `h12` would have been the same mistake one layer down.
 *
 * `locale` is a parameter only so the test can pin one. Nothing in the app
 * passes it.
 */
export function formatClockTime(date, locale = undefined) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}
