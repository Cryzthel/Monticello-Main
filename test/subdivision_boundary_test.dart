import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/core/config/subdivision_boundary.dart';

/// Guards the geofence.
///
/// The perimeter was re-traced in August 2026. The ring before it was a
/// 10-vertex sketch that ran diagonally THROUGH the village, leaving 15.8% of
/// the built houses outside the geofence; the ring now follows the village
/// parcel — Angela Avenue to the north, the field boundaries south and west.
///
/// That widened it on purpose, from 18.2 ha of houses to a 66.9 ha parcel, so
/// the Angela Avenue frontage and the undeveloped land south and west are now
/// INSIDE. Two tests here used to assert the opposite and were rewritten rather
/// than deleted — what they guard now is the parcel's real edges: the highway
/// to the north, and the neighbouring subdivisions east and west.
///
/// The expected values here must stay in agreement with the JS implementation
/// in `web-portal/src/shared/lib/subdivisionBoundary.js`, since both read the
/// same GeoJSON asset.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    await SubdivisionBoundary.load();
  });

  group('canonical GeoJSON asset', () {
    test('loads and yields a closed ring', () {
      expect(SubdivisionBoundary.isLoaded, isTrue,
          reason: 'assets/geo/monticello_villas_boundary.geojson failed to parse');

      final ring = SubdivisionBoundary.ring;
      expect(ring.length, greaterThanOrEqualTo(4));
      expect(ring.first.latitude, closeTo(ring.last.latitude, 1e-9));
      expect(ring.first.longitude, closeTo(ring.last.longitude, 1e-9));
    });

    test('parses [lng, lat] order correctly — the ring lands in Iloilo', () {
      // A lat/lng transposition would put the polygon near (122.5, 10.7) in
      // *reversed* terms, i.e. off the coast of Somalia, so this pins the axis
      // order rather than merely checking the file loaded.
      for (final point in SubdivisionBoundary.ring) {
        expect(point.latitude, inInclusiveRange(10.75, 10.78));
        expect(point.longitude, inInclusiveRange(122.51, 122.52));
      }
    });
  });

  group('containsInSubdivision', () {
    test('accepts points inside the premises', () {
      expect(MapConstants.containsInSubdivision(MapConstants.subdivisionCenter), isTrue);
      expect(MapConstants.containsInSubdivision(const LatLng(10.7670, 122.5155)), isTrue);
      expect(MapConstants.containsInSubdivision(const LatLng(10.7625, 122.5165)), isTrue);
    });

    test('accepts the undeveloped land the parcel includes', () {
      // BOTH OF THESE WERE `isFalse` UNTIL THE RE-TRACE, and the flip is the
      // deliberate consequence of following the village parcel instead of the
      // built houses. Kept as explicit assertions so the widening is a stated
      // decision rather than something that quietly happened.
      expect(MapConstants.containsInSubdivision(const LatLng(10.7682, 122.5175)),
          isTrue,
          reason: 'Angela Avenue frontage, north-east of the houses');
      expect(MapConstants.containsInSubdivision(const LatLng(10.7608, 122.5145)),
          isTrue,
          reason: 'south-west field, inside the parcel and awaiting development');
    });

    test('rejects land across Angela Avenue to the north', () {
      // The northern edge is the road. Anything past it is a different barangay
      // block, and a report pinned there is not this estate's to dispatch.
      expect(MapConstants.containsInSubdivision(const LatLng(10.7710, 122.5165)),
          isFalse);
    });

    test('rejects the neighbouring subdivisions either side', () {
      // Avida Village to the east, Deca Homes Pavia to the west. These are the
      // edges that actually matter now that the parcel reaches its neighbours.
      expect(MapConstants.containsInSubdivision(const LatLng(10.7640, 122.5220)),
          isFalse);
      expect(MapConstants.containsInSubdivision(const LatLng(10.7650, 122.5100)),
          isFalse);
    });

    test('rejects a far-away coordinate', () {
      expect(MapConstants.containsInSubdivision(const LatLng(14.5825, 121.0583)), isFalse);
    });
  });

  group('nearestInside (pin snap)', () {
    const distance = Distance();

    test('leaves a point already inside untouched', () {
      const inside = LatLng(10.7670, 122.5155);
      expect(SubdivisionBoundary.nearestInside(inside), inside);
    });

    test('snaps an outside pin to just inside the nearest edge', () {
      for (final outside in const [
        LatLng(10.7720, 122.5160), // north, across Angela Avenue
        LatLng(10.7650, 122.5080), // west
        LatLng(10.7650, 122.5250), // east
        LatLng(10.7580, 122.5165), // south
      ]) {
        final snapped = SubdivisionBoundary.nearestInside(outside);
        expect(snapped, isNotNull, reason: '$outside did not snap');
        expect(MapConstants.containsInSubdivision(snapped!), isTrue,
            reason: '$outside snapped to $snapped, which is outside');

        // Nearest: no ring vertex is meaningfully closer than the snap.
        final moved = distance(outside, snapped);
        final closestVertex = SubdivisionBoundary.ring
            .map((v) => distance(outside, v))
            .reduce((a, b) => a < b ? a : b);
        expect(moved, lessThanOrEqualTo(closestVertex + 20),
            reason: '$outside moved ${moved}m; a vertex is ${closestVertex}m');
      }
    });

    test('clampToSubdivision uses the polygon, not the box', () {
      final snapped =
          MapConstants.clampToSubdivision(const LatLng(10.7720, 122.5160));
      expect(MapConstants.containsInSubdivision(snapped), isTrue);
    });
  });
}
