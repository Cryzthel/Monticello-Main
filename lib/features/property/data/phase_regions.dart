import 'package:latlong2/latlong.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';

/// A phase's centre of mass, used to answer "which phase is this pin nearest?".
class PhaseAnchor {
  const PhaseAnchor({
    required this.phase,
    required this.centre,
    required this.cluster,
  });

  final String phase;
  final LatLng centre;

  /// Which physical group of houses this is, in plain words. Present so that
  /// re-assigning a phase number is an edit someone can make CORRECTLY from a
  /// map without reverse-engineering a coordinate.
  final String cluster;
}

/// The result of a proximity lookup.
class PhaseMatch {
  const PhaseMatch({
    required this.phase,
    required this.metres,
    required this.confident,
  });

  final String phase;
  final double metres;

  /// False when the pin is far enough from every anchor that naming one phase
  /// would be a guess dressed as a fact. The UI degrades to "Inside Monticello
  /// Villas" rather than showing a phase it does not actually know.
  final bool confident;

  /// The estate's own sheet name for this phase — MV1, MV2, MV3, MV5.
  String get planCode => 'MV$phase';
}

/// Maps a coordinate to the subdivision phase nearest it.
///
/// ── ANCHORS, NOT POLYGONS ──────────────────────────────────────────────────
/// Four points, not four outlines. The question the UI asks is literally
/// "nearest phase", so a nearest-centroid lookup answers it exactly, and four
/// draggable points are something the HOA can correct from a map in a minute.
/// Four hand-traced polygons would be more precise-LOOKING and no more correct:
/// their vertices would come from the same eyeballed screenshot these centres
/// do, but a polygon hides that uncertainty behind a hard edge, where a centre
/// plus [confidenceRadiusMetres] states it.
///
/// ── WHICH CLUSTER IS WHICH PHASE ───────────────────────────────────────────
/// This used to be an explicit guess, seeded north-to-south from the gate. It
/// is no longer a guess. The estate supplied a colour-coded satellite overlay
/// (August 2026) marking the perimeters, and Google Maps' own POI label sits
/// inside the yellow one reading "Phase 1, Monticello Villas":
///
///   • YELLOW  → Phase 1 (MV1, Isabella units) — northern cluster.
///   • BROWN + BLUE → Phase 2 (MV2, Florence & Isabella) — the north-west
///     cluster, west of Phase 1 across the internal road.
///   • GREEN   → the southern development, which the overlay marks as Phase 3.
///
/// PHASE 1 IS CONFIRMED. Phases 2 and 3 come from the operator's own marks.
///
/// PHASE 5 IS STILL INFERRED. The overlay does not mark it. The green outline
/// covers a southern development with two lobes joined at a waist, and phases 3
/// and 5 are split across them here: the larger northern lobe as Phase 3 (340
/// lots, described in the brief as "along the main access road") and the smaller
/// southern tip as Phase 5 (106 lots, "with open space amenities"). The lot
/// counts and those two descriptions agree with that split, but nothing states
/// it outright. If Phase 5 is somewhere else entirely, correct its `centre`
/// below — nothing else changes.
///
/// ── WHERE THE COORDINATES COME FROM ────────────────────────────────────────
/// Phases 1, 3 and 5 are centroids of the north / central / south thirds of
/// OpenStreetMap way 1090421190, the surveyed built extent of Monticello Villas
/// — measured, not eyeballed. Phase 2's centre is ESTIMATED from the operator
/// overlay, because OSM attributes that cluster to the neighbouring Deca Homes
/// relation and so offers no geometry for it; it carries perhaps +/- 100 m.
///
/// A wrong phase label here is a labelling error, never a positioning one: the
/// pin coordinate written to the incident record is measured, and is never
/// inferred from this table.
class PhaseRegions {
  PhaseRegions._();

  /// Beyond this, [nearest] reports `confident: false`.
  ///
  /// The clusters sit roughly 230–350 m apart, so a pin more than 300 m from
  /// every one of them is in the undeveloped land between or around them —
  /// inside the premises, but not in any phase. Naming the closest one there
  /// would be arithmetic, not knowledge.
  static const double confidenceRadiusMetres = 300;

  static const Distance _distance = Distance();

  static const List<PhaseAnchor> anchors = [
    PhaseAnchor(
      phase: '1',
      centre: LatLng(10.767480, 122.516140),
      cluster: 'Northern cluster — the yellow perimeter, carrying Google\'s '
          '"Phase 1, Monticello Villas" label',
    ),
    PhaseAnchor(
      phase: '2',
      centre: LatLng(10.767500, 122.514000),
      cluster: 'North-west cluster — the brown and blue perimeters, west of '
          'Phase 1',
    ),
    PhaseAnchor(
      phase: '3',
      centre: LatLng(10.764896, 122.515985),
      cluster: 'Central band — the northern lobe of the green perimeter, along '
          'the main access road',
    ),
    PhaseAnchor(
      phase: '5',
      centre: LatLng(10.762238, 122.517193),
      cluster: 'Southern tip — the lower lobe of the green perimeter, by the '
          'open space and Kasadyahan Gym',
    ),
  ];

  /// The phase whose anchor is closest to [point].
  ///
  /// Returns null only if the anchor table is empty, which cannot happen with
  /// the constant above but keeps callers honest if it ever becomes loaded data.
  static PhaseMatch? nearest(LatLng point) {
    if (anchors.isEmpty) return null;

    PhaseAnchor? best;
    var bestMetres = double.infinity;
    for (final anchor in anchors) {
      final metres = _distance.as(LengthUnit.Meter, point, anchor.centre);
      if (metres < bestMetres) {
        bestMetres = metres;
        best = anchor;
      }
    }
    if (best == null) return null;

    return PhaseMatch(
      phase: best.phase,
      metres: bestMetres,
      confident: bestMetres <= confidenceRadiusMetres,
    );
  }

  /// What the map's status pill should read for a given pin.
  ///
  /// Three states, and the difference between them matters:
  ///   • outside the premises  — the geofence will refuse this pin anyway
  ///   • inside, near a phase  — name it
  ///   • inside, near none     — say only what is true
  static String describe(LatLng point) {
    if (!MapConstants.containsInSubdivision(point)) {
      return 'Outside Monticello Villas';
    }
    final match = nearest(point);
    if (match == null || !match.confident) return 'Inside Monticello Villas';
    return 'Nearby: Phase ${match.phase}';
  }

  /// The two lines the pin badge shows when NO lot has been chosen.
  ///
  /// Mirrors the address hierarchy exactly — a bold primary and an emerald
  /// subtitle — so the badge does not change shape at the moment a lot is
  /// picked. The primary names what the coordinate supports (a phase), and the
  /// subtitle carries the plan code plus that phase's block span.
  ///
  /// It never fabricates a block or lot. Nothing in this app maps a coordinate
  /// to a lot boundary, so a badge reading "Block 4, Lot 12" off a map drag
  /// would be inventing two thirds of an address. What the badge CAN say is
  /// which blocks the phase contains, which is read from the schedule.
  static ({String primary, String? subtitle}) badgeLines(LatLng point) {
    if (!MapConstants.containsInSubdivision(point)) {
      return (primary: 'Outside the village', subtitle: null);
    }

    final match = nearest(point);
    if (match == null || !match.confident) {
      return (primary: 'Monticello Villas', subtitle: 'Inside the premises');
    }

    final span = SubdivisionDirectory.blockSpanLabel(match.phase);
    return (
      primary: 'Phase ${match.phase}',
      subtitle: span == null
          ? 'Monticello Villas (${match.planCode})'
          : 'Monticello Villas (${match.planCode}) · $span',
    );
  }
}
