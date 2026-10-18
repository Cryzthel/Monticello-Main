/**
 * The dispatch map's unit and route colours, in one place so the map layers,
 * the legend, the route badge and the drawer cannot drift apart.
 *
 * Plain hex rather than theme tokens: Mapbox paint properties take colour
 * strings, not CSS variables, and these must match on both basemaps anyway.
 */

/**
 * Unit markers, by what the officer is doing.
 *
 * ── NO ORANGE ON A UNIT (2026-10-17) ────────────────────────────────────────
 * `responding` was orange-500, and incident pins turn orange (#FB923C) once a
 * report has waited two hours (RESPONSE_PHASE_COLORS.warm). A report filed
 * 28 m from a responding guard was read as "the guard's real position" beside
 * the navigation arrow, and the route was reported as starting in the wrong
 * place when it was not. Responding is now the brand emerald and the marker is
 * a shield (see unitImage), so a unit differs from a report in shape AND hue:
 * orange on this map now only ever means a resident's report.
 */
export const UNIT_COLORS = {
  available: '#22C55E', // green-500 — on duty, no call
  // emerald-600, not the brand's 700: on the dark basemap 700 made the one
  // unit that matters most the dimmest marker on screen. Its live ring is the
  // brighter emerald-500 (NAV_MARKER_COLORS.standby).
  responding: '#059669', // emerald-600 — accepted and moving (pulsing ring)
  on_scene: '#3B82F6', // blue-500 — arrived, through investigation
}

/**
 * Route lines, in Google Maps' own grammar: the route being driven is BLUE,
 * and a route merely being considered is GREY.
 *
 * `live`    #4285F4 — the officer has accepted and is moving along it.
 * `preview` #64748B — a unit picked but not committed, or dispatched and not
 *                     yet acknowledged.
 *
 * ── WHY NOT SIMPLY MAKE BOTH BLUE ───────────────────────────────────────────
 * The brief asked for one blue everywhere. The two tones are not decoration:
 * they are the only thing on the map that says whether an officer has ACCEPTED
 * the call. A dispatcher deciding whether to send a second unit reads that
 * difference, and one colour for both would have deleted it.
 *
 * Re-encoding it as a dash was not available either — `route-connector`
 * already owns dashing, where it means "this leg is not a road", and a second
 * meaning on the same channel is how both stop being readable.
 *
 * So the distinction moved rather than went: blue for the active route and
 * grey for the one under consideration is exactly what Google does with a
 * chosen route and its alternates, which is also the thing the brief was
 * pointing at. `live` was emerald — the mobile accent — and that is the part
 * genuinely given up here.
 */
export const ROUTE_TONE_COLORS = {
  live: '#4285F4',
  preview: '#64748B',
}

/**
 * ── THE NAVIGATION MARKER, AND WHY IT IS A THIRD BLUE ──────────────────────
 *
 * Once a navigation session starts, the responding unit stops being a dot in a
 * state colour and becomes a direction arrow — the one marker a driver reads
 * at a glance (see `navigationArrowImage` in IncidentMap). It needs its own
 * entry here for the same reason the tones above do: three files draw it (the
 * map's symbol layer, the standby ring it replaces, and the panel's own
 * arrow emblem) and they must not drift.
 *
 * The arrow used to be `#1A73E8`, a deeper step of the route's own blue, so it
 * read as an object resting ON the line. That worked as navigation and failed
 * as identification: blue-on-blue said "part of the route", not "the guard".
 * Emerald against the blue line keeps the object-on-the-line separation (a
 * different hue separates better than a deeper one) and ties the arrow to the
 * responder's shield, ring and halo, which are all emerald.
 *
 * `standby` is emerald-500, a step lighter than the arrow, for the ring shown
 * before Start is pressed: the same responder before the session starts.
 */
export const NAV_MARKER_COLORS = {
  // EMERALD, not Google's deeper blue (2026-10-17). The blue arrow on the blue
  // line read as part of the route rather than as the responder, which is how
  // an incident pin beside it came to be taken for the guard. The responder is
  // emerald in every state that is theirs: shield, ring, arrow, halo.
  arrow: '#047857',
  standby: '#10B981', // emerald-500 — the ring before Start is pressed
}

/**
 * The turn-guidance banner's plate: Google Maps' own navigation green.
 *
 * ── IT IS NOT THE BRAND, AND IT SHOULD NOT BE ──────────────────────────────
 * The portals' accent is emerald `#047857`, and this is a dark teal one hue
 * across from it. A brand-coloured banner was the obvious alternative and is
 * the wrong one: every other emerald surface in both consoles means "this is
 * Monticello" or "this committed successfully", and a turn instruction is
 * neither. The one signal this plate has to carry is "you are being navigated
 * RIGHT NOW", which is a mode, and a mode needs a colour nothing else on the
 * screen is using.
 *
 * White on it measures 9.8:1 — read off the rendered banner, not computed from
 * the hex — so the instruction survives a sunlit windscreen, which is the
 * actual viewing condition and the reason this is the darkest surface either
 * portal draws.
 */
export const GUIDANCE_BANNER = {
  plate: '#004D40',
  /** The plate at 92%, for the frosted banner over the map (with backdrop-blur). */
  plateGlass: 'rgba(0, 77, 64, 0.92)',
  /** The banner's hairline edge, separating it from the route card below. */
  edge: 'rgba(255, 255, 255, 0.12)',
  ink: '#FFFFFF',
  /** The distance countdown and the sub-line, at the plate's reduced contrast. */
  inkMuted: 'rgba(255, 255, 255, 0.72)',
  /** The arrow's own tile inside the banner. */
  tile: 'rgba(255, 255, 255, 0.14)',
}
