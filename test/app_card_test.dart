import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/app_card.dart';

Future<void> _pump(
  WidgetTester tester, {
  VoidCallback? onTap,
  VoidCallback? onLongPress,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 300,
            child: AppCard(
              onTap: onTap,
              onLongPress: onLongPress,
              child: const Text('CARD'),
            ),
          ),
        ),
      ),
    ),
  );
}

/// The scale currently applied by the card's press animation.
double _scale(WidgetTester tester) {
  final transform = tester.widget<Transform>(
    find
        .descendant(of: find.byType(AppCard), matching: find.byType(Transform))
        .first,
  );
  // entry(0, 0), not getMaxScaleOnAxis(): AnimatedScale leaves z at 1, so the
  // max-axis helper reports 1.0 for every scale below full size.
  return transform.transform.entry(0, 0);
}

void main() {
  group('an inert card', () {
    testWidgets('is not a button and does not respond to a press',
        (tester) async {
      final handle = tester.ensureSemantics();
      await _pump(tester);

      expect(
        tester.getSemantics(find.byType(AppCard)),
        isNot(isSemantics(isButton: true)),
      );

      await tester.startGesture(tester.getCenter(find.text('CARD')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(_scale(tester), 1.0);
      handle.dispose();
    });
  });

  group('a tappable card', () {
    testWidgets('reports itself as a button', (tester) async {
      final handle = tester.ensureSemantics();
      await _pump(tester, onTap: () {});

      expect(
        tester.getSemantics(find.byType(AppCard)),
        isSemantics(isButton: true),
      );
      handle.dispose();
    });

    testWidgets('fires onTap', (tester) async {
      var taps = 0;
      await _pump(tester, onTap: () => taps++);

      await tester.tap(find.text('CARD'));
      await tester.pump();
      expect(taps, 1);
    });

    testWidgets('scales down while held and springs back on release',
        (tester) async {
      await _pump(tester, onTap: () {});

      final gesture =
          await tester.startGesture(tester.getCenter(find.text('CARD')));
      // TWO pumps. The first delivers onTapDown and rebuilds with _pressed
      // true, which is the frame the implicit animation starts FROM — advancing
      // the clock in that same pump leaves it at t=0 and still reading 1.0.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      // A scale, not a ripple: on a surface this size a splash reads as a wash
      // crawling across the content rather than as the card responding.
      expect(_scale(tester), closeTo(0.98, 0.001));

      await gesture.up();
      await tester.pumpAndSettle();
      expect(_scale(tester), 1.0);
    });

    testWidgets('releases the scale when the press turns into a scroll',
        (tester) async {
      await _pump(tester, onTap: () {});

      final gesture =
          await tester.startGesture(tester.getCenter(find.text('CARD')));
      await tester.pump(const Duration(milliseconds: 120));
      // Dragging off cancels the tap. Without the onTapCancel handler the card
      // stays squashed for the rest of the scroll.
      await gesture.moveBy(const Offset(0, -200));
      await tester.pumpAndSettle();

      expect(_scale(tester), 1.0);
      await gesture.up();
    });
  });

  group('long press', () {
    testWidgets('fires onLongPress', (tester) async {
      var longPresses = 0;
      await _pump(tester, onTap: () {}, onLongPress: () => longPresses++);

      await tester.longPress(find.text('CARD'));
      await tester.pumpAndSettle();
      expect(longPresses, 1);
    });

    testWidgets('does not also fire onTap', (tester) async {
      var taps = 0;
      var longPresses = 0;
      await _pump(
        tester,
        onTap: () => taps++,
        onLongPress: () => longPresses++,
      );

      await tester.longPress(find.text('CARD'));
      await tester.pumpAndSettle();

      expect(longPresses, 1);
      expect(taps, 0, reason: 'a long press is one action, not two');
    });

    testWidgets('leaves the card at full size afterwards', (tester) async {
      await _pump(tester, onTap: () {}, onLongPress: () {});

      await tester.longPress(find.text('CARD'));
      await tester.pumpAndSettle();

      // The handler releases the press explicitly. Without that the card stays
      // squashed under whatever the long press opened, and is still squashed
      // when that closes.
      expect(_scale(tester), 1.0);
    });

    testWidgets('a card with ONLY a long press is still interactive',
        (tester) async {
      var longPresses = 0;
      await _pump(tester, onLongPress: () => longPresses++);

      await tester.longPress(find.text('CARD'));
      await tester.pumpAndSettle();
      expect(longPresses, 1);
    });
  });
}
