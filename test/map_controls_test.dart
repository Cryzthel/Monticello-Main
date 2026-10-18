import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/map_controls.dart';

/// Guards the map control contract: TWO circular buttons, MapControlButton.size square, naming the
/// destination layer.
///
/// The three maps each grew a private copy of this control and drifted — that
/// is what the shared widget exists to stop, and these tests are what stop the
/// shared widget from quietly drifting on its own.
///
/// What is NOT tested here: that the homepage card and the incident picker
/// actually render exactly two of these. Both host a Mapbox platform view,
/// which cannot be built under `flutter_test`. Those two call sites are
/// verified by reading, not by this file.
Widget _host(Widget child) => MaterialApp(
      home: Scaffold(body: Center(child: child)),
    );

void main() {
  group('MapControlButton', () {
    testWidgets('is a compact MapControlButton.size circle', (tester) async {
      await tester.pumpWidget(_host(
        MapControlButton(
          icon: MapActionIcons.currentLocation,
          tooltip: 'Recenter on my location',
          onTap: () {},
        ),
      ));

      // The compact size is a deliberate trade below the 44 guideline (see
      // MapControlButton.size). Pin it, so any further shrink is a decision
      // made in that constant and not an accident here.
      final size = tester.getSize(find.byType(MapControlButton));
      expect(size.width, MapControlButton.size);
      expect(size.height, MapControlButton.size);
    });

    testWidgets('carries its tooltip as a screen-reader label',
        (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_host(
        MapControlButton(
          icon: MapActionIcons.toSatellite,
          tooltip: 'Switch to Satellite',
          onTap: () {},
        ),
      ));

      // The glyph alone cannot say which layer it means. Anyone the picture
      // does not reach gets the words or gets nothing.
      expect(
        find.bySemanticsLabel('Switch to Satellite'),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('reports taps', (tester) async {
      var taps = 0;
      await tester.pumpWidget(_host(
        MapControlButton(
          icon: MapActionIcons.currentLocation,
          tooltip: 'Recenter on my location',
          onTap: () => taps++,
        ),
      ));

      await tester.tap(find.byType(MapControlButton));
      await tester.pump();
      expect(taps, 1);
    });
  });

  group('MapControlCluster', () {
    testWidgets('lays two buttons out vertically by default', (tester) async {
      await tester.pumpWidget(_host(
        MapControlCluster(
          children: [
            MapControlButton(
              icon: MapActionIcons.toStreets,
              tooltip: 'Switch to Streets',
              onTap: () {},
            ),
            MapControlButton(
              icon: MapActionIcons.currentLocation,
              tooltip: 'Recenter on my location',
              onTap: () {},
            ),
          ],
        ),
      ));

      expect(find.byType(MapControlButton), findsNWidgets(2));
      expect(find.byType(Column), findsOneWidget);

      final first = tester.getRect(find.byType(MapControlButton).first);
      final second = tester.getRect(find.byType(MapControlButton).last);
      // Stacked, and separated by exactly the declared gap — they are two
      // controls with air between them, not two halves of one pill.
      expect(second.left, first.left);
      expect(second.top - first.bottom, MapControlCluster.gap);
    });

    testWidgets('lays them out side by side on the horizontal axis',
        (tester) async {
      await tester.pumpWidget(_host(
        MapControlCluster(
          axis: Axis.horizontal,
          children: [
            MapControlButton(
              icon: MapActionIcons.toStreets,
              tooltip: 'Switch to Streets',
              onTap: () {},
            ),
            MapControlButton(
              icon: MapActionIcons.currentLocation,
              tooltip: 'Recenter on my location',
              onTap: () {},
            ),
          ],
        ),
      ));

      final first = tester.getRect(find.byType(MapControlButton).first);
      final second = tester.getRect(find.byType(MapControlButton).last);
      expect(second.top, first.top);
      expect(second.left - first.right, MapControlCluster.gap);
    });

    testWidgets('adds no gap around a single child', (tester) async {
      await tester.pumpWidget(_host(
        MapControlCluster(
          children: [
            MapControlButton(
              icon: MapActionIcons.currentLocation,
              tooltip: 'Recenter on my location',
              onTap: () {},
            ),
          ],
        ),
      ));

      final cluster = tester.getSize(find.byType(MapControlCluster));
      expect(cluster.height, MapControlButton.size);
    });
  });

  group('MapActionIcons', () {
    test('the two layer glyphs are distinct', () {
      // Both name a DESTINATION, so they must never collapse to one picture —
      // an icon that looks the same in both states says nothing at all.
      expect(MapActionIcons.toStreets, isNot(MapActionIcons.toSatellite));
    });

    test('the GPS glyph is neither layer glyph', () {
      expect(MapActionIcons.currentLocation, isNot(MapActionIcons.toStreets));
      expect(MapActionIcons.currentLocation, isNot(MapActionIcons.toSatellite));
    });
  });
}
