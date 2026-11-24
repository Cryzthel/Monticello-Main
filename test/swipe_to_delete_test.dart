import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/swipe_to_delete.dart';

/// A fixed 300px row, so swipe distances map onto the threshold predictably:
/// 0.42 of 300 is 126px.
const double _rowWidth = 300;

Future<void> _pumpRow(WidgetTester tester, VoidCallback onDismissed) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: _rowWidth,
            child: SwipeToDelete(
              key: const ValueKey('row-1'),
              onDismissed: onDismissed,
              child: Container(
                height: 70,
                color: AppColors.backgroundSecondary,
                alignment: Alignment.center,
                child: const Text('ALERT'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  group('the gesture', () {
    testWidgets('a swipe past the threshold deletes', (tester) async {
      var dismissed = 0;
      await _pumpRow(tester, () => dismissed++);

      // ~67% of the width, comfortably past the 42% commit point.
      await tester.drag(find.text('ALERT'), const Offset(-200, 0));
      await tester.pumpAndSettle();

      expect(dismissed, 1);
      expect(find.text('ALERT'), findsNothing);
    });

    testWidgets('a short swipe springs back and deletes nothing',
        (tester) async {
      var dismissed = 0;
      await _pumpRow(tester, () => dismissed++);

      // ~13% — the range a diagonal scroll flick lands in. Committing here is
      // the accidental-delete complaint that the raised threshold exists for.
      await tester.drag(find.text('ALERT'), const Offset(-40, 0));
      await tester.pumpAndSettle();

      expect(dismissed, 0);
      expect(find.text('ALERT'), findsOneWidget);
    });

    testWidgets('a right swipe does nothing at all', (tester) async {
      var dismissed = 0;
      await _pumpRow(tester, () => dismissed++);

      // One direction only. A two-way swipe on a card with no second action
      // just makes the row feel loose.
      await tester.drag(find.text('ALERT'), const Offset(260, 0));
      await tester.pumpAndSettle();

      expect(dismissed, 0);
      expect(find.text('ALERT'), findsOneWidget);
    });

    testWidgets('the plate is revealed mid-swipe', (tester) async {
      await _pumpRow(tester, () {});

      // Part-way through a drag, without releasing.
      final gesture =
          await tester.startGesture(tester.getCenter(find.text('ALERT')));
      await gesture.moveBy(const Offset(-90, 0));
      await tester.pump();

      expect(find.byType(SwipeDeletePlate), findsOneWidget);

      await gesture.up();
      await tester.pumpAndSettle();
    });
  });

  group('SwipeDeletePlate', () {
    Future<BoxDecoration> pumpPlate(
      WidgetTester tester,
      double progress,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: _rowWidth,
              height: 70,
              child: SwipeDeletePlate(progress: progress),
            ),
          ),
        ),
      );
      final container = tester.widget<Container>(
        find
            .descendant(
              of: find.byType(SwipeDeletePlate),
              matching: find.byType(Container),
            )
            .first,
      );
      return container.decoration! as BoxDecoration;
    }

    testWidgets('is rose-500, not the error red', (tester) async {
      final decoration = await pumpPlate(tester, 0.5);

      // rose-500. Deliberately not AppColors.danger (red-600), which means
      // "something is wrong" — deleting a notification is a choice.
      expect(decoration.color, const Color(0xFFF43F5E));
      expect(AppColors.swipeDelete, isNot(AppColors.danger));
    });

    testWidgets('the icon is hidden at rest and solid past the threshold',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: _rowWidth,
              height: 70,
              child: SwipeDeletePlate(progress: 0),
            ),
          ),
        ),
      );
      // A scroll that nudges the row a pixel must not flash a delete icon.
      expect(tester.widget<Opacity>(find.byType(Opacity)).opacity, 0);

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: _rowWidth,
              height: 70,
              child: SwipeDeletePlate(progress: SwipeToDelete.threshold),
            ),
          ),
        ),
      );
      expect(tester.widget<Opacity>(find.byType(Opacity)).opacity, 1);
    });

    testWidgets('the icon grows as the row travels', (tester) async {
      // Scoped to the plate: MaterialApp and Scaffold contribute Transforms of
      // their own, so an unqualified byType finds several.
      double currentScale() {
        final transform = tester.widget<Transform>(
          find
              .descendant(
                of: find.byType(SwipeDeletePlate),
                matching: find.byType(Transform),
              )
              .first,
        );
        // entry(0, 0), NOT getMaxScaleOnAxis(). Transform.scale builds a 2D
        // matrix that leaves z at 1, so the max-axis helper reports 1.0 for
        // every scale below full size — both readings came back equal.
        return transform.transform.entry(0, 0);
      }

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: _rowWidth,
              height: 70,
              child: SwipeDeletePlate(progress: 0),
            ),
          ),
        ),
      );
      final atRest = currentScale();

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: _rowWidth,
              height: 70,
              child: SwipeDeletePlate(progress: SwipeToDelete.threshold),
            ),
          ),
        ),
      );
      final committed = currentScale();

      // Settles at full size exactly when releasing would delete, so the
      // gesture confirms itself before the finger lifts.
      expect(atRest, lessThan(committed));
      expect(committed, closeTo(1.0, 0.001));
    });
  });
}
