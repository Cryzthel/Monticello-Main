import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/features/property/data/lot_reference_points.dart';
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';
import 'package:monticello_villas_app/features/property/services/lot_reference_store.dart';

/// Roughly 11 m of latitude, so the fixtures below sit at legible distances
/// rather than at coordinates chosen by trial and error.
const double _tenishMetres = 0.0001;

const _origin = LatLng(10.767480, 122.516140);

LotReferencePoint _at(int lot, double latOffset, {LotSource? source}) =>
    LotReferencePoint(
      address: SubdivisionAddress(phase: '1', block: 5, lot: lot),
      centre: LatLng(_origin.latitude + latOffset, _origin.longitude),
      source: source ?? LotSource.surveyed,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('LotLocator', () {
    test('an empty table answers nothing, rather than guessing', () {
      const locator = LotLocator.empty();
      expect(locator.isEmpty, isTrue);
      expect(locator.nearby(_origin), isEmpty);
      expect(locator.resolve(_origin), isNull);
    });

    test('nearby returns the closest lots first', () {
      final locator = LotLocator([
        _at(3, _tenishMetres * 3),
        _at(1, _tenishMetres * 1),
        _at(2, _tenishMetres * 2),
      ]);

      final results = locator.nearby(_origin);
      expect(results.map((m) => m.address.lot).toList(), [1, 2, 3]);
      expect(results.first.metres, lessThan(results.last.metres));
    });

    test('nearby honours its radius and its limit', () {
      final locator = LotLocator([
        for (var lot = 1; lot <= 9; lot++) _at(lot, _tenishMetres * lot),
      ]);

      // 60 m default radius: the lots beyond it are not "far away results",
      // they are absent.
      final withinDefault = locator.nearby(_origin, limit: 99);
      expect(withinDefault.every((m) => m.metres <= 60), isTrue);
      expect(withinDefault.length, lessThan(9));

      expect(locator.nearby(_origin).length, 4, reason: 'default limit is 4');
      expect(locator.nearby(_origin, limit: 2).length, 2);
    });

    test('resolve refuses anything outside 25 m', () {
      // ~33 m away — closer than the nearby radius, further than the
      // resolution radius. It should show as a tag but never as THE address.
      final locator = LotLocator([_at(1, _tenishMetres * 3)]);

      expect(locator.nearby(_origin), hasLength(1));
      expect(locator.resolve(_origin), isNull);
    });

    test('resolve picks the closest when several are in range', () {
      final locator = LotLocator([
        _at(7, _tenishMetres * 2),
        _at(4, _tenishMetres * 0.5),
        _at(9, _tenishMetres * 1.5),
      ]);

      expect(locator.resolve(_origin)!.address.lot, 4);
    });

    test('centreFor takes a named lot back to its coordinate', () {
      // The inverse of resolve, and what makes picking a lot in the location
      // search move the map: the dropdown hands over an address, and the pin
      // needs a coordinate.
      final locator = LotLocator([
        _at(1, _tenishMetres * 1),
        _at(2, _tenishMetres * 2),
      ]);

      const lot2 = SubdivisionAddress(phase: '1', block: 5, lot: 2);
      expect(locator.centreFor(lot2)!.latitude,
          closeTo(_origin.latitude + _tenishMetres * 2, 1e-9));
      expect(locator.centreFor(lot2)!.longitude, closeTo(_origin.longitude, 1e-9));
    });

    test('an unsurveyed lot has no coordinate, and says so', () {
      // Null is the normal answer, not a failure: the table is a survey plus
      // whatever residents' own devices have contributed, so a lot nobody has
      // stood in yet is simply absent. The caller leaves the pin where it is —
      // a search result must never move the map to a guess.
      final locator = LotLocator([_at(1, _tenishMetres)]);

      expect(
        locator.centreFor(const SubdivisionAddress(phase: '1', block: 5, lot: 9)),
        isNull,
      );
      // A different block at the same lot number is a different address.
      expect(
        locator.centreFor(const SubdivisionAddress(phase: '1', block: 6, lot: 1)),
        isNull,
      );
      expect(const LotLocator.empty().centreFor(
          const SubdivisionAddress(phase: '1', block: 5, lot: 1)), isNull);
    });
  });

  group('SubdivisionAddress.shortLabel', () {
    test('is the compact form the map tags use', () {
      const address = SubdivisionAddress(phase: '1', block: 5, lot: 19);
      expect(address.shortLabel, 'Blk 5 Lot 19');
    });
  });

  group('LotReferenceStore', () {
    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      await LotReferenceStore.clearLearned();
    });

    test('the shipped asset is valid JSON and loads cleanly', () async {
      // Guards the file itself. A malformed edit to the GeoJSON would otherwise
      // only show up as tags silently never appearing.
      await LotReferenceStore.load();
      expect(LotReferenceStore.isLoaded, isTrue);
      // Empty today — the estate has not supplied coordinates. If this starts
      // failing because real survey data landed, that is the good outcome:
      // update the expectation.
      expect(LotReferenceStore.locator.isEmpty, isTrue);
    });

    test('a remembered lot becomes locatable', () async {
      const address = SubdivisionAddress(phase: '1', block: 5, lot: 19);
      await LotReferenceStore.rememberOwnLot(address, _origin);

      final resolved = LotReferenceStore.locator.resolve(_origin);
      expect(resolved, isNotNull);
      expect(resolved!.address, address);
      expect(resolved.source, LotSource.learned);
    });

    test('a lot the estate does not have is never remembered', () async {
      // Phase 5 Block 5 stops at Lot 14.
      const bogus = SubdivisionAddress(phase: '5', block: 5, lot: 19);
      expect(SubdivisionDirectory.exists('5', 5, 19), isFalse);

      await LotReferenceStore.rememberOwnLot(bogus, _origin);
      expect(LotReferenceStore.locator.isEmpty, isTrue);
    });

    test('one stray pin is out-voted by the median', () async {
      const address = SubdivisionAddress(phase: '1', block: 5, lot: 19);

      // Three sightings at the house, then one dropped 300 m away on the walk
      // home. A mean would drag the lot a quarter of the way there.
      await LotReferenceStore.rememberOwnLot(address, _origin);
      await LotReferenceStore.rememberOwnLot(
          address, LatLng(_origin.latitude + 0.000005, _origin.longitude));
      await LotReferenceStore.rememberOwnLot(
          address, LatLng(_origin.latitude + 0.000010, _origin.longitude));
      await LotReferenceStore.rememberOwnLot(
          address, LatLng(_origin.latitude + 0.0027, _origin.longitude));

      final resolved = LotReferenceStore.locator.resolve(_origin);
      expect(resolved, isNotNull);
      expect(
        const Distance().as(LengthUnit.Meter, resolved!.point.centre, _origin),
        lessThan(3),
      );
    });

    test('a surveyed point wins over a learned one for the same lot', () {
      const address = SubdivisionAddress(phase: '1', block: 5, lot: 19);
      const surveyed = LotReferencePoint(
        address: address,
        centre: _origin,
        source: LotSource.surveyed,
      );
      final learned = LotReferencePoint(
        address: address,
        centre: LatLng(_origin.latitude + 0.0002, _origin.longitude),
        source: LotSource.learned,
      );

      LotReferenceStore.debugSeed(surveyed: [surveyed], learned: [learned]);

      final points = LotReferenceStore.locator.points;
      expect(points, hasLength(1), reason: 'the same lot must not appear twice');
      expect(points.single.source, LotSource.surveyed);
      expect(points.single.centre, _origin);
    });

    test('learned points for other lots survive the merge', () {
      LotReferenceStore.debugSeed(
        surveyed: [_at(1, 0)],
        learned: [_at(2, _tenishMetres, source: LotSource.learned)],
      );
      expect(LotReferenceStore.locator.points, hasLength(2));
    });
  });
}
