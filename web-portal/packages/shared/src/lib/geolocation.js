/**
 * What counts as knowing where somebody is.
 *
 * ── WHY THIS IS SHARED AND NOT A NUMBER IN EACH CALLER ─────────────────────
 * Three paths on two consoles ask the browser for a position: the officer's
 * telemetry stream, the map's "My location" button, and the arrival check.
 * They have different freshness needs and different consequences, but they all
 * have to agree on the one question underneath — whether the answer that came
 * back is a measurement or an inference — because an operator comparing a
 * laptop against a phone is comparing those answers directly.
 */

/**
 * Metres. Above this, a reading is not a position and is discarded rather than
 * used.
 *
 * ── THE DESKTOP / MOBILE MISMATCH, IN ONE NUMBER ───────────────────────────
 * `enableHighAccuracy` is a REQUEST. A browser that cannot honour it answers
 * anyway, from whatever it has: visible Wi-Fi access points, the cell network,
 * or — on a desktop with the radio off, or behind a VPN — the IP address. The
 * last of those reports accuracy in the thousands of metres and places the
 * officer at their ISP's exchange, which is how one device ends up streets or
 * countries away from another while both report success.
 *
 * Nothing downstream can tell those apart once the coordinates are stored: a
 * 5 km fix and a 10 m fix are both two numbers. So the judgement is made here,
 * at the only point where the accuracy radius is still attached to them.
 *
 * ── WHY 1000 AND NOT THE 100 USED FOR "APPROXIMATE" ────────────────────────
 * This is not the precision check. The security portal's
 * `GPS_ACCURACY_LIMIT_M` (100 m) answers "is this good enough for a
 * block-level judgement", and 50 m gates the arrival stamp. Those decide how
 * much to TRUST a position. This one decides whether there is a position at
 * all, and it has to be generous, because real positioning gets legitimately
 * coarse: Wi-Fi indoors, a cell fallback in a concrete stairwell, a phone
 * under dense tree cover. An officer standing at a scene must not drop off the
 * map because the reading widened to 200 m.
 *
 * IP geolocation does not land near this line — it reports 5,000 m and up — so
 * the gap between the two kinds of answer is wide enough that the exact
 * threshold does not have to be right to be useful. It only has to be between
 * them.
 *
 * At subdivision scale it is also where a fix stops carrying information:
 * Monticello Villas is a few hundred metres across, so a kilometre of
 * uncertainty cannot establish that somebody is inside it.
 */
/**
 * Metres. At or under this, a fix came from real positioning hardware and is
 * precise enough to place somebody on a street; above it the browser is
 * answering from something coarser.
 *
 * Moved here from the security portal's `routeOrigin` (which re-exports it) so
 * it sits beside `GPS_REJECT_ACCURACY_M` — the two are the same ladder, and
 * this module has no imports, which is what lets the rules built on them be
 * tested under bare node.
 *
 * A phone outdoors reports 5-20 m and indoors up to ~65 m; Wi-Fi and IP
 * positioning report 100 m and far worse. At subdivision scale 100 m is
 * already a block away.
 */
export const GPS_ACCURACY_LIMIT_M = 100

export const GPS_REJECT_ACCURACY_M = 1000

/**
 * Is this reading a position at all?
 *
 * A missing accuracy is accepted. The field is optional in the spec and some
 * providers omit it, and refusing every fix from such a provider would be
 * choosing no position over an unlabelled one — the opposite of the trade this
 * module exists to make. What is rejected is a reading that explicitly admits
 * it does not know.
 */
export function isUsableFix(coords) {
  const accuracy = coords?.accuracy
  return !Number.isFinite(accuracy) || accuracy <= GPS_REJECT_ACCURACY_M
}

/**
 * Options for a ONE-SHOT request, where somebody is waiting for the answer.
 *
 * `maximumAge: 0` because a cached fix is whatever the last caller asked for,
 * which may have been a coarse one — or one from another tab. The whole point
 * of pressing a button that finds you is that it finds you now.
 *
 * `timeout: 10_000` is the brief's number and the right one HERE: a person is
 * watching a spinner, and after ten seconds a clear "could not get your
 * location" beats a longer wait. A continuous `watchPosition` needs far more
 * (see the note on the watch in useGuardTelemetry) because a cold
 * high-accuracy lock routinely takes twenty seconds and timing out mid-lock
 * reports a failure that was not one.
 */
export const ONE_SHOT_POSITION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
}
