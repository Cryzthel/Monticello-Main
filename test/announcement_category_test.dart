import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/core/config/subdivision_boundary.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcement_card.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcement_detail_sheet.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

Announcement _post(String category) => Announcement(
      id: 'x',
      title: 't',
      body: 'b',
      postedAt: DateTime.now(),
      author: 'HOA',
      category: category,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// Guards the announcement category contract with the admin dashboard.
  ///
  /// The regression these exist for: the app filtered on "Utilities" and
  /// "Events", neither of which the dashboard ever writes (it publishes
  /// General / Security / Maintenance / Event), so those two tabs returned an
  /// empty feed no matter what the HOA had posted.
  ///
  /// The expected values must stay in agreement with `ANNOUNCEMENT_CATEGORIES`
  /// and `CATEGORY_TONES` in `web-portal/src/shared/lib/announcements.js`.
  group('announcement categories', () {
    test('the vocabulary matches what the dashboard publishes', () {
      expect(kAnnouncementCategories,
          equals(['General', 'Security', 'Maintenance', 'Event']));
    });

    test('legacy labels fold onto the canonical key', () {
      expect(announcementCategoryKey('Utilities'), 'Maintenance');
      expect(announcementCategoryKey('Events'), 'Event');
      // Case and stray whitespace are data, not distinct categories.
      expect(announcementCategoryKey('  security '), 'Security');
    });

    test('an unrecognised category degrades to General, never to blank', () {
      expect(announcementCategoryKey('Sportsfest'), 'General');
      expect(announcementCategoryKey(''), 'General');
    });

    test('tones mirror the web portal', () {
      expect(announcementCategoryColor('General'), AppColors.info);
      expect(announcementCategoryColor('Security'), AppColors.danger);
      expect(announcementCategoryColor('Maintenance'), AppColors.warning);
      expect(announcementCategoryColor('Event'), AppColors.ctaGreen);
      // A legacy post keeps the colour it always had.
      expect(announcementCategoryColor('Utilities'), AppColors.warning);
    });
  });

  group('AnnouncementFilterBar', () {
    test('offers All plus every published category', () {
      expect(AnnouncementFilterBar.options,
          equals(['All', 'General', 'Security', 'Maintenance', 'Event']));
    });

    test('All matches everything', () {
      for (final category in ['General', 'Security', 'Utilities', 'nonsense']) {
        expect(
          AnnouncementFilterBar.matches('All', _post(category)),
          isTrue,
          reason: '"$category" should survive the unfiltered view',
        );
      }
    });

    test('a legacy post files under the tab it belongs in', () {
      // This is the whole point: before normalisation a stored "Utilities"
      // post matched no tab at all.
      expect(
          AnnouncementFilterBar.matches('Maintenance', _post('Utilities')),
          isTrue);
      expect(AnnouncementFilterBar.matches('Event', _post('Events')), isTrue);
      expect(
          AnnouncementFilterBar.matches('Security', _post('Utilities')),
          isFalse);
    });
  });

  /// Guards the homepage map's framing.
  ///
  /// The camera limit is derived from the boundary polygon rather than stored
  /// beside it, so that re-tracing `monticello_villas_boundary.geojson`
  /// re-frames the map with no code change — and so the phone cannot pan over
  /// an area the dispatcher's map refuses to.
  group('premises framing', () {
    setUpAll(() async {
      await SubdivisionBoundary.load();
    });

    test('derives from the boundary ring, padded outward', () {
      final ring = SubdivisionBoundary.ring;
      expect(ring, isNotEmpty);

      final south = ring.map((p) => p.latitude).reduce((a, b) => a < b ? a : b);
      final north = ring.map((p) => p.latitude).reduce((a, b) => a > b ? a : b);
      final west = ring.map((p) => p.longitude).reduce((a, b) => a < b ? a : b);
      final east = ring.map((p) => p.longitude).reduce((a, b) => a > b ? a : b);
      const pad = MapConstants.premisesFramePadding;

      expect(MapConstants.premisesSouthWest.latitude, closeTo(south - pad, 1e-9));
      expect(MapConstants.premisesSouthWest.longitude, closeTo(west - pad, 1e-9));
      expect(MapConstants.premisesNorthEast.latitude, closeTo(north + pad, 1e-9));
      expect(MapConstants.premisesNorthEast.longitude, closeTo(east + pad, 1e-9));
    });

    test('the frame encloses the premises, and only just', () {
      // Every vertex is reachable...
      for (final p in SubdivisionBoundary.ring) {
        expect(p.latitude, inInclusiveRange(
            MapConstants.premisesSouthWest.latitude,
            MapConstants.premisesNorthEast.latitude));
        expect(p.longitude, inInclusiveRange(
            MapConstants.premisesSouthWest.longitude,
            MapConstants.premisesNorthEast.longitude));
      }
      // ...and the frame stays a subdivision-sized box, not a city-sized one.
      // ~0.011 deg is roughly 1.2 km; anything much larger means the camera
      // limit has quietly stopped being about Monticello Villas.
      final latSpan = MapConstants.premisesNorthEast.latitude -
          MapConstants.premisesSouthWest.latitude;
      final lngSpan = MapConstants.premisesNorthEast.longitude -
          MapConstants.premisesSouthWest.longitude;
      expect(latSpan, lessThan(0.02));
      expect(lngSpan, lessThan(0.02));
    });

    test('centres on the premises, not on one phase of it', () {
      expect(MapConstants.containsInSubdivision(MapConstants.premisesCenter),
          isTrue);
    });

    test('lists the phases that exist on the ground', () {
      // Mirrors SUBDIVISION_PHASES on the web side — the numbering skips 4.
      expect(MapConstants.subdivisionPhases, equals(['1', '2', '3', '5']));
    });
  });
}
