import 'package:latlong2/latlong.dart';

/// How close a hand-placed pin may sit to a lot's surveyed centre and still be
/// "on that lot" — about half a lot frontage plus GPS slack.
const double kPinKeepRadiusMeters = 60;

/// Where the report pin should go when the resident picks a lot.
///
/// ── WHY THIS EXISTS (2026-10-19) ─────────────────────────────────────────
/// The form used to move the pin to the lot's centre on every address pick.
/// A resident who had already dragged the needle onto the exact spot — the
/// side gate, the carport — had that precise point thrown away for a lot
/// centroid, and the guard's map then showed the report "in a different spot"
/// from where they put it.
///
/// Returns the new pin, or null to leave it where it is:
///   * no surveyed centre for the lot → null (never move to a guess);
///   * the pin was placed by hand and is already within
///     [kPinKeepRadiusMeters] of that lot → null (keep the precise point);
///   * otherwise → the lot centre (a different lot, or nothing placed yet).
LatLng? pinAfterAddressPick({
  required LatLng pin,
  required bool placedByHand,
  required LatLng? lotCentre,
}) {
  if (lotCentre == null) return null;
  if (placedByHand &&
      const Distance().as(LengthUnit.Meter, pin, lotCentre) <=
          kPinKeepRadiusMeters) {
    return null;
  }
  return lotCentre;
}
