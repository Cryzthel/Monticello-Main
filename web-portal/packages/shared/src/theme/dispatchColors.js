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
 * `#1A73E8` is a step DEEPER than the `live` route line it sits on. That is
 * deliberate and it is what Google does: the chevron has to read as an object
 * resting ON the line rather than as a swelling of it, and two identical blues
 * stacked at 29px and 9px wide lose that edge entirely — the arrow dissolves
 * into the route exactly when it matters. The white ring does half the work;
 * the extra depth does the other half, and it survives the satellite basemap
 * where a lighter arrow does not.
 *
 * `standby` is the SAME blue as the live route (#4285F4, via ROUTE_TONE_COLORS)
 * and that is also deliberate: a unit on standby is not yet a different kind
 * of thing, it is the same unit before the session starts. The transformation
 * is the shape — a radiating ring becomes an arrow — not the hue.
 */
export const NAV_MARKER_COLORS = {
  arrow: '#1A73E8',
  standby: ROUTE_TONE_COLORS.live,
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
  ink: '#FFFFFF',
  /** The distance countdown and the sub-line, at the plate's reduced contrast. */
  inkMuted: 'rgba(255, 255, 255, 0.72)',
  /** The arrow's own tile inside the banner. */
  tile: 'rgba(255, 255, 255, 0.14)',
}
