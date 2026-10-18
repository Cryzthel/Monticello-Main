import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/refresh_shell.dart';
import 'package:monticello_villas_app/core/widgets/spiral_loader.dart';

void main() {
  group('the spiral geometry', () {
    const speed = Duration(milliseconds: 900);

    test('the figure repeats over six speeds, not one', () {
      // The dots oscillate out and back over `speed * 2`; the ring turns over
      // `speed * 3`. One controller drives both, so its period has to be the
      // point where the two realign — anything shorter jumps on the loop.
      expect(SpiralLoader.periodFor(speed), speed * 6);
      expect(SpiralLoader.periodFor(speed).inMilliseconds % 1800, 0);
      expect(SpiralLoader.periodFor(speed).inMilliseconds % 2700, 0);
    });

    test('a dot travels out to the rim and back, and repeats', () {
      // A sixth of the way through the period is a quarter of the way through
      // the dot's own out-and-back: heading out.
      final start = SpiralPainter.phaseOf(0, 0);
      final quarter = SpiralPainter.phaseOf(1 / 12, 0);
      final half = SpiralPainter.phaseOf(1 / 6, 0);
      final threeQuarters = SpiralPainter.phaseOf(1 / 4, 0);

      expect(start, closeTo(0, 0.001));
      expect(quarter, closeTo(0.5, 0.001));
      expect(half, closeTo(1, 0.001), reason: 'out at the rim');
      expect(threeQuarters, closeTo(0.5, 0.001), reason: 'on the way back');
      // Three full out-and-backs per period.
      expect(SpiralPainter.phaseOf(1 / 3, 0), closeTo(0, 0.001));
    });

    test('neighbouring dots are an eighth of a leg apart', () {
      // `animation-delay: calc(var(--uib-speed) * -0.125)` per child: dot i+1
      // runs an eighth of a leg AHEAD of dot i. A leg is a sixth of the
      // figure's period, so that lead is 1/48 of it — and rewinding by exactly
      // that much puts a dot where its predecessor is now.
      //
      // This stagger is the whole illusion: without it eight dots pulse in and
      // out as one ring, and nothing about the figure spirals.
      const lead = 1 / 48;
      for (var i = 0; i < SpiralLoader.dots - 1; i++) {
        expect(
          SpiralPainter.phaseOf(0.5 - lead, i + 1),
          closeTo(SpiralPainter.phaseOf(0.5, i), 1e-9),
          reason: 'dot ${i + 1} does not trail dot $i',
        );
      }
    });

    test('a collapsed dot is at the centre and a full one at the rim', () {
      expect(SpiralPainter.radiusOf(0, 16), 0);
      expect(SpiralPainter.radiusOf(1, 16), 16);
    });

    test('a rotation is three speeds, and converts back', () {
      // `speed` is the CSS oscillation leg; a caller thinking in visible turns
      // means the container's `speed * 3`. The two helpers are inverses, which
      // is what lets the refresh bar state its cadence as a rotation.
      expect(SpiralLoader.rotationFor(speed), speed * 3);
      expect(SpiralLoader.speedForRotation(speed * 3), speed);
      expect(
        SpiralLoader.rotationFor(SpiralLoader.speedForRotation(speed * 3)),
        speed * 3,
      );
    });
  });

  group('the refresh bar', () {
    Future<void> pump(WidgetTester tester, {required bool active}) {
      return tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: RefreshLoaderBar(active: active)),
        ),
      );
    }

    testWidgets('is closed and still while nothing is refreshing',
        (tester) async {
      await pump(tester, active: false);
      await tester.pumpAndSettle();

      // Zero height: the bar takes space from the list only while it is
      // actually saying something.
      expect(tester.getSize(find.byType(RefreshLoaderBar)).height, 0);
      expect(
        tester.widget<SpiralLoader>(find.byType(SpiralLoader)).spinning,
        isFalse,
      );
    });

    testWidgets('opens and spins while a refresh is in flight', (tester) async {
      await pump(tester, active: true);
      // pump, never pumpAndSettle: the loader repeats for as long as the
      // refresh runs, so there is no "settled" frame to wait for.
      await tester.pump(RefreshLoaderBar.transition);

      expect(tester.getSize(find.byType(RefreshLoaderBar)).height,
          RefreshLoaderBar.barHeight);
      expect(
        tester.widget<SpiralLoader>(find.byType(SpiralLoader)).spinning,
        isTrue,
      );
      await tester.pump(const Duration(milliseconds: 300));
    });

    testWidgets('turns once every 1.5 seconds', (tester) async {
      await pump(tester, active: true);
      await tester.pump(const Duration(milliseconds: 300));

      // The number that matters is the VISIBLE one — how long a whole turn
      // takes — not the oscillation leg the widget is configured with. At the
      // loader's own 900ms default a turn ran 2.7s, so a refresh that finished
      // normally never showed a complete cycle.
      final loader = tester.widget<SpiralLoader>(find.byType(SpiralLoader));
      expect(
        SpiralLoader.rotationFor(loader.speed),
        const Duration(milliseconds: 1500),
      );
      expect(RefreshLoaderBar.spinPeriod, const Duration(milliseconds: 1500));
    });

    testWidgets('draws no Material spinner anywhere', (tester) async {
      await pump(tester, active: true);
      await tester.pump(const Duration(milliseconds: 300));

      // The stock indicator is suppressed, not merely recoloured somewhere
      // else: nothing in this bar is a CircularProgressIndicator.
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byType(CustomPaint), findsWidgets);
    });
  });

  group('how long the bar stays up', () {
    const frame = Duration(milliseconds: 16);
    const giveUp = Duration(seconds: 8);

    Future<void> pumpShell(
      WidgetTester tester,
      Future<void> Function() onRefresh,
    ) {
      return tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RefreshShell(
              onRefresh: onRefresh,
              child: ListView(
                children: const [SizedBox(height: 900, child: Text('feed'))],
              ),
            ),
          ),
        ),
      );
    }

    bool barIsOpen(WidgetTester tester) =>
        tester.widget<RefreshLoaderBar>(find.byType(RefreshLoaderBar)).active;

    /// One frame, collecting anything the refresh threw on it.
    ///
    /// An `onRefresh` is genuinely allowed to fail — every caller's ends in a
    /// Firestore `.get()`, which throws on a rules rejection — and flutter_test
    /// surfaces that on whichever frame it lands, then fails the test on the
    /// way out if nothing claimed it. Every pump below goes through here so a
    /// deliberate failure is the test's to assert on rather than the harness's
    /// to complain about.
    Future<void> step(WidgetTester tester, List<Object> caught) async {
      await tester.pump(frame);
      final error = tester.takeException();
      if (error != null) caught.add(error);
    }

    /// Pulls the list down, then advances until the bar opens. That wait is
    /// unavoidable and not part of what is being measured — the
    /// RefreshIndicator owns the drag and only calls back once it has snapped
    /// to its armed position.
    Future<void> pullToRefresh(WidgetTester tester, List<Object> caught) async {
      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      var waited = Duration.zero;
      while (!barIsOpen(tester) && waited < giveUp) {
        await step(tester, caught);
        waited += frame;
      }
      expect(barIsOpen(tester), isTrue, reason: 'the pull started no refresh');
    }

    /// Frames from here until the bar closes.
    Future<Duration> timeUntilClosed(
      WidgetTester tester,
      List<Object> caught,
    ) async {
      var open = Duration.zero;
      while (barIsOpen(tester) && open < giveUp) {
        await step(tester, caught);
        open += frame;
      }
      expect(barIsOpen(tester), isFalse, reason: 'the bar never closed');
      return open;
    }

    testWidgets('a refresh that finishes instantly still shows a whole spin',
        (tester) async {
      // The case this exists for: a warm cache answering on the first
      // microtask. Without a floor the bar opened and shut inside a couple of
      // frames, which reads as a flicker rather than as a refresh.
      final caught = <Object>[];
      await pumpShell(tester, () async {});
      await pullToRefresh(tester, caught);

      final open = await timeUntilClosed(tester, caught);
      expect(
        open,
        greaterThanOrEqualTo(RefreshLoaderBar.spinPeriod - frame),
        reason: 'the spin was cut short',
      );
      expect(caught, isEmpty);
      await tester.pumpAndSettle();
    });

    testWidgets('a slow refresh is not padded past the work', (tester) async {
      // The floor is a floor, not a fixed wait. A fetch that outlasts one spin
      // must still dismiss when it genuinely lands.
      const fetch = Duration(seconds: 3);
      final caught = <Object>[];
      await pumpShell(tester, () => Future<void>.delayed(fetch));
      await pullToRefresh(tester, caught);

      final open = await timeUntilClosed(tester, caught);
      expect(open, greaterThanOrEqualTo(fetch - frame));
      expect(
        open,
        lessThan(fetch + RefreshLoaderBar.spinPeriod),
        reason: 'the floor was added on TOP of the fetch instead of under it',
      );
      expect(caught, isEmpty);
      await tester.pumpAndSettle();
    });

    // A THROWING REFRESH IS NOT COVERED HERE.
    //
    // The shell holds its close in `finally`, so a failed refresh does close on
    // a complete spin — but asserting it is not possible from a widget test as
    // the shell stands. `_handleRefresh` rethrows, the error travels out
    // through RefreshIndicator's own future with nothing awaiting it, and an
    // unhandled error in the test zone fails the test outright rather than
    // landing where `tester.takeException()` can claim it. That is pre-existing
    // and unrelated to the timing this group is about: every caller's
    // `onRefresh` ends in a Firestore `.get()`, which throws on a rules
    // rejection, and nothing in the chain catches it. Worth fixing on its own
    // terms; a test asserting it has to come with that fix.
  });
}
