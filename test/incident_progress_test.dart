import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/shared_widgets.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

Incident _incident(IncidentStatus status, {DateTime? resolvedAt}) => Incident(
      id: 'INC-001',
      title: 'Broken street light',
      category: 'maintenance',
      phase: '1',
      block: '2',
      lot: '3',
      description: '',
      reportedAt: DateTime(2026, 8, 1, 9),
      priority: IncidentPriority.medium,
      status: status,
      reporter: 'Resident',
      resolvedAt: resolvedAt,
    );

Future<void> _pumpTracker(WidgetTester tester, IncidentStatus status) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: ReportStatusTracker(status: status)),
    ),
  );
}

/// Diameter of one step node. The connector rails are [AnimatedContainer]s
/// too, so the circles are picked out by their fixed width — which the widget
/// folds into `constraints` rather than keeping as a `width` field.
const double _nodeSize = 26;

List<AnimatedContainer> _steps(WidgetTester tester) => tester
    .widgetList<AnimatedContainer>(find.byType(AnimatedContainer))
    .where((c) => c.constraints?.maxWidth == _nodeSize)
    .toList();

BoxDecoration _decoration(AnimatedContainer step) =>
    step.decoration! as BoxDecoration;

/// Every completed step's checkmark.
///
/// Counted as painters, not icons, and that is the assertion: an [Icon] is
/// text, and an icon font that has not resolved draws the missing-glyph box —
/// a hollow SQUARE inside the circle. A path cannot fail that way.
List<CheckmarkPainter> _checks(WidgetTester tester) => tester
    .widgetList<CustomPaint>(find.byType(CustomPaint))
    .map((p) => p.painter)
    .whereType<CheckmarkPainter>()
    .toList();

void main() {
  group('the four-step tracker', () {
    testWidgets('draws every step', (tester) async {
      await _pumpTracker(tester, IncidentStatus.pending);
      expect(_steps(tester), hasLength(4));
    });

    testWidgets('a completed step is a bare filled circle with a check',
        (tester) async {
      // Dispatched sits on step 3, so steps 1 and 2 are behind it.
      await _pumpTracker(tester, IncidentStatus.dispatched);

      final done = _steps(tester).take(2);
      for (final step in done) {
        final decoration = _decoration(step);
        // THE POINT OF THIS TEST. Every node used to carry a 2px border, and
        // on a done node it was drawn in the same emerald as the fill — a ring
        // around a disc of the identical colour, on a card that has no strokes
        // of its own.
        expect(decoration.border, isNull,
            reason: 'a completed step has no outer ring');
        expect(decoration.shape, BoxShape.circle);
        expect(decoration.color, AppColors.ctaGreen);
      }

      final checks = _checks(tester);
      expect(checks, hasLength(2));
      for (final check in checks) {
        expect(check.color, AppColors.onAccent);
        expect(check.progress, 1, reason: 'drawn, not mid-animation');
      }
    });

    testWidgets('no completed step draws a font glyph', (tester) async {
      await _pumpTracker(tester, IncidentStatus.resolved);

      // The remaining way a square could appear inside these circles: an
      // unresolved icon font renders the missing-glyph box, in the icon's own
      // colour, centred exactly where the check should be.
      expect(
        find.descendant(
          of: find.byType(ReportStatusTracker),
          matching: find.byType(Icon),
        ),
        findsNothing,
      );
    });

    testWidgets('a pending step keeps its ring, which is all it has',
        (tester) async {
      await _pumpTracker(tester, IncidentStatus.pending);

      // An empty circle on a white card would not exist without its edge, so
      // the ring survives exactly where it is load-bearing.
      final pending = _steps(tester).last;
      expect(_decoration(pending).border, isNotNull);
      expect(_decoration(pending).color, AppColors.surface);
      expect(find.text('4'), findsOneWidget);
    });

    testWidgets('the live step is numbered, not checked', (tester) async {
      await _pumpTracker(tester, IncidentStatus.verifying);

      expect(_checks(tester), hasLength(1));
      expect(find.text('2'), findsOneWidget);
      expect(_decoration(_steps(tester)[1]).color, AppColors.primary);
    });

    testWidgets('a resolved report completes step 4', (tester) async {
      await _pumpTracker(tester, IncidentStatus.resolved);

      // The regression this guards: `resolved` maps to trackingStep 3 — the
      // LAST index — so reading that as "steps completed" left the fourth node
      // permanently active, showing the numeral 4 on a report closed weeks
      // ago. The timeline never visibly finished.
      expect(_checks(tester), hasLength(4));
      for (final numeral in ['1', '2', '3', '4']) {
        expect(find.text(numeral), findsNothing,
            reason: 'no step is still counting once the report is resolved');
      }
      for (final step in _steps(tester)) {
        expect(_decoration(step).border, isNull);
        expect(_decoration(step).color, AppColors.ctaGreen);
      }
    });

    testWidgets('a closed report completes too', (tester) async {
      await _pumpTracker(tester, IncidentStatus.closed);
      expect(_checks(tester), hasLength(4));
    });

    testWidgets('every label is centred under its own node', (tester) async {
      // THE POINT OF THIS TEST. The rail was laid out as node/gap/node/gap…
      // with the discs fixed-width and the gaps absorbing the slack, while the
      // labels underneath were four equal cells. Two different grids: on an
      // 800px tracker the first node centred at 13 and its label's cell at 100,
      // and the two middle labels sat ~8px off the steps they name.
      await _pumpTracker(tester, IncidentStatus.verifying);

      const labels = ['Submitted', 'Verified', 'In Progress', 'Resolved'];
      final nodes = _steps(tester);
      expect(nodes, hasLength(labels.length));

      for (var i = 0; i < labels.length; i++) {
        expect(
          tester.getRect(find.text(labels[i])).center.dx,
          closeTo(tester.getRect(find.byWidget(nodes[i])).center.dx, 0.01),
          reason: '"${labels[i]}" is not under step ${i + 1}',
        );
      }
    });

    testWidgets('the steps are evenly spaced across the tracker',
        (tester) async {
      await _pumpTracker(tester, IncidentStatus.pending);

      final centres = _steps(tester)
          .map((node) => tester.getRect(find.byWidget(node)).center.dx)
          .toList();
      final firstGap = centres[1] - centres[0];
      for (var i = 1; i < centres.length - 1; i++) {
        expect(centres[i + 1] - centres[i], closeTo(firstGap, 0.01));
      }
      // Symmetric about the middle: the outer nodes sit half a step column in
      // from each edge, not flush against the card's gutters.
      final track = tester.getRect(find.byType(ReportStatusTracker));
      expect(centres.first - track.left,
          closeTo(track.right - centres.last, 0.01));
    });

    testWidgets('a false alarm stops without completing', (tester) async {
      await _pumpTracker(tester, IncidentStatus.falseAlarm);

      // It shares step 3 with `resolved`, but a report withdrawn as a mistake
      // never travelled the fourth stage and is not travelling it now — so the
      // last node is pending (grey ring, numbered), neither checked nor live.
      expect(_checks(tester), hasLength(3));
      final last = _steps(tester).last;
      expect(_decoration(last).border, isNotNull);
      expect(_decoration(last).color, AppColors.surface);
    });
  });

  group('the status segmented control', () {
    const segments = ['All', 'Active', 'Resolved'];

    /// Returns the harness's current index, so a test can assert the control
    /// reported the tap as well as moved for it.
    Future<ValueGetter<int>> pump(WidgetTester tester,
        {int initial = 0}) async {
      var index = initial;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) => Padding(
                // 375pt phone minus the screen's 16pt gutters.
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: SegmentedControl(
                  segments: segments,
                  selectedIndex: index,
                  onChanged: (i) => setState(() => index = i),
                ),
              ),
            ),
          ),
        ),
      );
      return () => index;
    }

    /// The thumb is the control's only positioned child, in both modes —
    /// `AnimatedPositioned` builds a `Positioned` of its own, so this matches
    /// whether or not a continuous position is driving it. Finding it by
    /// `DecoratedBox` instead would also match the track, which is a
    /// [Container] and builds one.
    Rect thumb(WidgetTester tester) => tester.getRect(
          find.descendant(
            of: find.byType(SegmentedControl),
            matching: find.byType(Positioned),
          ),
        );

    testWidgets('splits the track evenly and fills it', (tester) async {
      await pump(tester);

      final track = tester.getRect(find.byType(SegmentedControl));
      // The 4px inset on each side is what makes the track read as a groove
      // the thumb sits IN, so the thumb is a third of the INNER width.
      expect(thumb(tester).width, closeTo((track.width - 8) / 3, 0.01));
      expect(thumb(tester).left, closeTo(track.left + 4, 0.01));
      expect(track.height, SegmentedControl.height);
    });

    testWidgets('slides the thumb to the tapped segment', (tester) async {
      final index = await pump(tester);
      final start = thumb(tester).left;

      await tester.tap(find.text('Resolved'));
      await tester.pump();
      expect(index(), 2, reason: 'the tap is reported immediately');

      // Mid-flight: one object travelling, not two fills swapping. If the
      // thumb jumped, this frame would already be at its destination.
      await tester.pump(const Duration(milliseconds: 60));
      final moving = thumb(tester).left;
      expect(moving, greaterThan(start));

      await tester.pumpAndSettle();
      final settled = thumb(tester).left;
      expect(settled, greaterThan(moving));
      // Last segment, so its right edge lands on the track's inner edge.
      expect(thumb(tester).right,
          closeTo(tester.getRect(find.byType(SegmentedControl)).right - 4,
              0.01));
    });

    testWidgets('every segment is a selectable button to the a11y tree',
        (tester) async {
      final handle = tester.ensureSemantics();
      await pump(tester, initial: 1);

      expect(tester.getSemantics(find.text('Active')),
          isSemantics(isButton: true, isSelected: true));
      expect(tester.getSemantics(find.text('Resolved')),
          isSemantics(isButton: true, isSelected: false));
      handle.dispose();
    });

    testWidgets('tapping the live segment is not a state change',
        (tester) async {
      var changes = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SegmentedControl(
              segments: segments,
              selectedIndex: 1,
              onChanged: (_) => changes++,
            ),
          ),
        ),
      );

      await tester.tap(find.text('Active'));
      await tester.pump();
      // Re-reporting the current value would rebuild the whole incident list
      // for nothing, and fire a haptic that answers no question.
      expect(changes, 0);
    });

    testWidgets('tracks a continuous position when one is supplied',
        (tester) async {
      final position = ValueNotifier<double>(0);
      addTearDown(position.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: SegmentedControl(
                segments: segments,
                selectedIndex: 0,
                position: position,
                onChanged: (_) {},
              ),
            ),
          ),
        ),
      );

      final track = tester.getRect(find.byType(SegmentedControl));
      final segment = (track.width - 8) / 3;
      final origin = thumb(tester).left;

      // Half a page dragged: the indicator is half a segment along, WITHOUT
      // the page having settled. An indicator that waited for onPageChanged
      // would still be sitting at zero here.
      position.value = 0.5;
      await tester.pump();
      expect(thumb(tester).left, closeTo(origin + segment / 2, 0.01));

      position.value = 1.75;
      await tester.pump();
      expect(thumb(tester).left, closeTo(origin + segment * 1.75, 0.01));
    });

    testWidgets('a tracked thumb does not lag behind its own animation',
        (tester) async {
      final position = ValueNotifier<double>(0);
      addTearDown(position.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SegmentedControl(
              segments: segments,
              selectedIndex: 0,
              position: position,
              onChanged: (_) {},
            ),
          ),
        ),
      );
      final origin = thumb(tester).left;

      position.value = 2;
      await tester.pump();

      // No implicit animation while tracking. One frame after the value moves,
      // the thumb is already there — an AnimatedPositioned would still be
      // easing, which on a value that changes every frame reads as the pill
      // trailing the finger by its own duration.
      final segment =
          (tester.getRect(find.byType(SegmentedControl)).width - 8) / 3;
      expect(thumb(tester).left, closeTo(origin + segment * 2, 0.01));
    });

    testWidgets('labels flip at the halfway mark, not on settle',
        (tester) async {
      final position = ValueNotifier<double>(0);
      addTearDown(position.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SegmentedControl(
              segments: segments,
              selectedIndex: 0,
              position: position,
              onChanged: (_) {},
            ),
          ),
        ),
      );
      final handle = tester.ensureSemantics();

      // Just past halfway to "Active". The fill has already arrived under that
      // label, so the label must already be reading as selected — otherwise it
      // is dark text on solid emerald for the rest of the drag.
      position.value = 0.6;
      await tester.pump();

      expect(tester.getSemantics(find.text('Active')),
          isSemantics(isSelected: true));
      expect(tester.getSemantics(find.text('All')),
          isSemantics(isSelected: false));
      handle.dispose();
    });

    testWidgets('an out-of-range index does not throw out of layout',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SegmentedControl(
              segments: segments,
              selectedIndex: 7,
              onChanged: (_) {},
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('the detail sheet timeline', () {
    Future<void> pump(WidgetTester tester, Incident incident) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: IncidentStatusTimeline(incident: incident),
            ),
          ),
        ),
      );
      // pump, never pumpAndSettle: the active node's halo repeats forever.
      await tester.pump();
    }

    testWidgets('marks the last node live while the report is open',
        (tester) async {
      await pump(tester, _incident(IncidentStatus.inProgress));
      expect(find.text('Now'), findsOneWidget);
    });

    testWidgets('completes the last node once resolved', (tester) async {
      await pump(tester, _incident(
        IncidentStatus.resolved,
        resolvedAt: DateTime(2026, 8, 3, 14, 30),
      ));

      // "Now" on an incident that closed two days ago is the same off-by-one
      // as the numbered step 4, in the place a resident is most likely to
      // read it: the node they opened the sheet to check.
      expect(find.text('Now'), findsNothing);
      expect(find.text('Aug 3 • 2:30 PM'), findsOneWidget);
      expect(find.text('Incident has been closed'), findsOneWidget);
    });
  });
}
