import 'package:latlong2/latlong.dart';

import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';

/// Where a lot's coordinate came from, which is also how far it can be trusted.
enum LotSource {
  /// From the estate's own survey, shipped in
  /// `assets/geo/lot_reference_points.geojson`. Authoritative.
  surveyed,

  /// Asserted on THIS DEVICE by a verified resident placing a pin on their own
  /// registered lot. Good evidence — they were standing there — but one
  /// household's word, so it never overrides a surveyed point.
  learned,
}

/// A lot with a known real-world position.
///
/// This is the only thing in the app that connects an address to a coordinate.
/// Everything that turns a map position into "Blk 5 Lot 19" reads through a
/// table of these.
class LotReferencePoint {
  const LotReferencePoint({
    required this.address,
    required this.centre,
    required this.source,
  });

  final SubdivisionAddress address;
  final LatLng centre;
  final LotSource source;
}

/// A reference point plus how far the pin is from it.
class LotMatch {
  const LotMatch({required this.point, required this.metres});

  final LotReferencePoint point;
  final double metres;

  SubdivisionAddress get address => point.address;
  LotSource get source => point.source;
}

/// Resolves a map coordinate to the lots around it.
///
/// ── WHY A TABLE OF POINTS AND NOT LOT POLYGONS ─────────────────────────────
/// The obvious design is a polygon per lot and a point-in-polygon test. It was
/// not built, because the geometry to fill it does not exist:
///
///   • The Pro-Friends site plans (MV1/MV2/MV3/MV5) are CAD drawings with no
///     coordinate grid, no scale bar and no north arrow. Registering one to the
///     satellite image needs control points that appear in both. There are none.
///   • OpenStreetMap has 197 building footprints inside the estate and ZERO of
///     them carry a house number, street or name — so the shapes are there but
///     nothing says which is Lot 19.
///
/// Estimating the polygons anyway would put roughly 15-30 m of registration
/// error on a lot that is about 8 m wide. That is not an approximate address;
/// it is a confidently wrong one, and this app dispatches guards to it.
///
/// So the app stores the positions it actually knows, and says nothing about
/// the ones it does not — which is also what the Grab-style reference behaves
/// like. Those floating tags are saved places out of a database, not regions
/// computed from geometry.
class LotLocator {
  const LotLocator(this.points);

  final List<LotReferencePoint> points;

  const LotLocator.empty() : points = const [];

  /// How far out a lot is still worth showing as a nearby tag.
  ///
  /// A block is roughly 50 m across, so 60 m reaches the far side of the one
  /// the pin is in plus its immediate neighbours — the handful of labels the
  /// Grab reference shows, not a screenful.
  static const double nearbyRadiusMetres = 60;

  /// How close the pin must be for a lot to be treated as THE address, rather
  /// than merely nearby.
  ///
  /// Deliberately tight. A phone's own fix is +/- 5-10 m and lots are about 8 m
  /// wide, so anything looser would resolve to the neighbour's house about as
  /// often as to the right one.
  static const double resolutionRadiusMetres = 25;

  static const Distance _distance = Distance();

  bool get isEmpty => points.isEmpty;

  /// The lots around [from], nearest first.
  List<LotMatch> nearby(
    LatLng from, {
    int limit = 4,
    double radiusMetres = nearbyRadiusMetres,
  }) {
    final matches = <LotMatch>[];
    for (final point in points) {
      final metres = _distance.as(LengthUnit.Meter, from, point.centre);
      if (metres > radiusMetres) continue;
      matches.add(LotMatch(point: point, metres: metres));
    }
    matches.sort((a, b) => a.metres.compareTo(b.metres));
    return matches.length <= limit ? matches : matches.sublist(0, limit);
  }

  /// Where a NAMED lot is — the inverse of [resolve].
  ///
  /// Added for the location search: picking "Phase 2, Block 4, Lot 12" from the
  /// dropdown should take the map there, and that needs address → coordinate,
  /// which every other method here runs the other way.
  ///
  /// Null is a real and common answer, not an error. This table is a survey
  /// plus whatever residents' own devices have contributed (see [LotSource]),
  /// so a lot nobody has stood in yet has no point. The caller leaves the pin
  /// where it is in that case — a search result must never move the map to a
  /// coordinate that was guessed.
  LatLng? centreFor(SubdivisionAddress address) {
    for (final point in points) {
      if (point.address == address) return point.centre;
    }
    return null;
  }

  /// The one lot [from] can be said to BE, or null if none is close enough.
  ///
  /// Null is a real answer here and the common one until the table is seeded.
  /// Callers fall back to what the coordinate alone supports — a phase.
  LotMatch? resolve(
    LatLng from, {
    double radiusMetres = resolutionRadiusMetres,
  }) {
    LotMatch? best;
    for (final point in points) {
      final metres = _distance.as(LengthUnit.Meter, from, point.centre);
      if (metres > radiusMetres) continue;
      if (best == null || metres < best.metres) {
        best = LotMatch(point: point, metres: metres);
      }
    }
    return best;
  }
}
