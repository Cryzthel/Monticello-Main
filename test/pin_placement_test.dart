import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/incidents/pin_placement.dart';

void main() {
  const lot = LatLng(14.60000, 121.00000);

  group('pinAfterAddressPick', () {
    test('no surveyed centre leaves the pin alone', () {
      expect(
        pinAfterAddressPick(
            pin: const LatLng(14.6, 121.0), placedByHand: false, lotCentre: null),
        isNull,
      );
    });

    test('nothing placed yet moves the pin to the lot', () {
      expect(
        pinAfterAddressPick(
            pin: const LatLng(14.61, 121.01), placedByHand: false, lotCentre: lot),
        lot,
      );
    });

    test('a hand-placed pin on the chosen lot is kept', () {
      // ~22 m north of the lot centre.
      const placed = LatLng(14.60020, 121.00000);
      expect(
        pinAfterAddressPick(pin: placed, placedByHand: true, lotCentre: lot),
        isNull,
      );
    });

    test('a hand-placed pin on a different lot moves to the chosen lot', () {
      // ~330 m away.
      const elsewhere = LatLng(14.60300, 121.00000);
      expect(
        pinAfterAddressPick(pin: elsewhere, placedByHand: true, lotCentre: lot),
        lot,
      );
    });
  });

  test('the filed coordinate keeps full precision and [lat, lng] order', () {
    final incident = Incident(
      id: '',
      title: 'Security Report',
      category: 'Security',
      phase: '1',
      block: '4',
      lot: '12',
      description: 'Side gate',
      reportedAt: DateTime(2026, 10, 19),
      priority: IncidentPriority.high,
      status: IncidentStatus.pending,
      reporter: 'Resident',
      reporterUid: 'uid',
      latitude: 14.6012345678,
      longitude: 121.0098765432,
    );
    final location = incident.toFirestore()['location'] as Map<String, dynamic>;
    // The portals read exactly these two keys (readLatLng) and draw
    // [lng, lat] unrounded, so the guard's pin lands on this point.
    expect(location['lat'], 14.6012345678);
    expect(location['lng'], 121.0098765432);
  });
}
