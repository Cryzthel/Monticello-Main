import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/shared_widgets.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

Incident _incident(
  IncidentStatus status, {
  DateTime? dispatchedAt,
  DateTime? resolvedAt,
  String guard = '',
}) =>
    Incident(
      id: 'INC-014',
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
      assignedGuardName: guard,
      dispatchedAt: dispatchedAt,
      resolvedAt: resolvedAt,
    );

/// The node diameter the tracker draws, and the stroke it asks the checkmark
/// painter for. Mirrored from the widget's own private constants — if either
/// moves, the containment test below is measuring the wrong disc and should
/// be updated deliberately rather than silently passing.
const double _nodeSize = 26;
const double _checkStroke = 2.4;

void main() {
  group('the check inside a step node', () {
    test('every corner of the drawn mark lies inside the disc', () {
      // "The check fits within the circular node without clipping" is a claim
      // about geometry, so it is measured rather than eyeballed: the painter
      // reports the extent it will actually cover — vertices inflated by half
      // a stroke, because round caps overhang each endpoint by exactly that —
      // and all four corners of that box must sit within the node's radius.
      const box = Size.square(_nodeSize);
      final bounds =
          CheckmarkPainter.boundsFor(box, strokeWidth: _checkStroke);
      const centre = Offset(_nodeSize / 2, _nodeSize / 2);
      const radius = _nodeSize / 2;

      for (final corner in [
        bounds.topLeft,
        bounds.topRight,
        bounds.bottomLeft,
        bounds.bottomRight,
      ]) {
        expect(
          (corner - centre).distance,
          lessThan(radius),
          reason: '$corner escapes the ${radius * 2}px node',
        );
      }
    });

    test('the mark is centred in the box it is given', () {
      final bounds = CheckmarkPainter.boundsFor(
        const Size.square(_nodeSize),
        strokeWidth: _checkStroke,
      );
      // Within a pixel of the disc's own centre in both axes: a tick that
      // measures as fitting but sits low and left still reads as misaligned.
      expect(bounds.center.dx, closeTo(_nodeSize / 2, 1));
      expect(bounds.center.dy, closeTo(_nodeSize / 2, 1));
    });

    test('an explicit stroke overrides the size-relative default', () {
      const box = Size.square(_nodeSize);
      // The default is tuned for the wizard's much larger confirmation badge.
      expect(CheckmarkPainter.strokeFor(box), closeTo(_nodeSize * 0.11, 1e-9));
      expect(CheckmarkPainter.strokeFor(box, _checkStroke), _checkStroke);
      // A heavier stroke grows the drawn extent, which is why the containment
      // test above has to account for it rather than measuring the path alone.
      expect(
        CheckmarkPainter.boundsFor(box, strokeWidth: 6).width,
        greaterThan(CheckmarkPainter.boundsFor(box, strokeWidth: 2).width),
      );
    });
  });

  group('the tracker keeps one set of dimensions', () {
    Future<void> pump(WidgetTester tester, IncidentStatus status,
        {double width = 340}) {
      return tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: SizedBox(
                width: width,
                child: ReportStatusTracker(status: status),
              ),
            ),
          ),
        ),
      );
    }

    List<Rect> nodes(WidgetTester tester) => tester
        .widgetList<AnimatedContainer>(find.byType(AnimatedContainer))
        .where((c) => c.constraints?.maxWidth == _nodeSize)
        .map((c) => tester.getRect(find.byWidget(c)))
        .toList();

    testWidgets('every node is the same size at every status', (tester) async {
      // Across statuses, not just within one: a done node, a live node and a
      // pending node are three different decorations, and the pending one is
      // the only one with a border. A border drawn outside the box would make
      // it a different size from its neighbours in the same rail.
      final sizes = <Size>[];
      for (final status in [
        IncidentStatus.pending,
        IncidentStatus.verifying,
        IncidentStatus.dispatched,
        IncidentStatus.resolved,
        IncidentStatus.falseAlarm,
      ]) {
        await pump(tester, status);
        await tester.pump(const Duration(milliseconds: 300));
        final rects = nodes(tester);
        expect(rects, hasLength(4), reason: 'four nodes at $status');
        sizes.addAll(rects.map((r) => r.size));
      }

      for (final size in sizes) {
        expect(size.width, _nodeSize);
        expect(size.height, _nodeSize);
      }
    });

    testWidgets('node spacing scales with the card, not with the status',
        (tester) async {
      // The horizontal rhythm comes from cutting the width into four equal
      // step columns, so the gap is a function of the card and nothing else.
      // Two statuses at one width must produce identical centres.
      await pump(tester, IncidentStatus.pending);
      final pendingCentres = nodes(tester).map((r) => r.center.dx).toList();

      await pump(tester, IncidentStatus.resolved);
      await tester.pump(const Duration(milliseconds: 300));
      final resolvedCentres = nodes(tester).map((r) => r.center.dx).toList();

      for (var i = 0; i < 4; i++) {
        expect(resolvedCentres[i], closeTo(pendingCentres[i], 0.01));
      }

      // And the gap is one quarter of the card, whatever the card is.
      await pump(tester, IncidentStatus.pending, width: 280);
      final narrow = nodes(tester).map((r) => r.center.dx).toList();
      expect(narrow[1] - narrow[0], closeTo(280 / 4, 0.01));
      expect(pendingCentres[1] - pendingCentres[0], closeTo(340 / 4, 0.01));
    });
  });

  group('the detail timeline rail', () {
    /// Deliberately a report whose stages are DIFFERENT heights: stages 1, 3
    /// and 4 carry a timestamp chip and stage 2 does not, and the last stage
    /// adds a wrapped resolution note. That unevenness is the whole point —
    /// a rail with a hard-coded connector height is correct for at most one
    /// of them.
    Future<void> pumpTimeline(WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: SizedBox(
                width: 340,
                child: IncidentStatusTimeline(
                  incident: _incident(
                    IncidentStatus.resolved,
                    dispatchedAt: DateTime(2026, 8, 1, 11, 30),
                    resolvedAt: DateTime(2026, 8, 1, 14, 5),
                    guard: 'Guard Ramirez',
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      // pump, not pumpAndSettle: the active-node pulse repeats forever, so
      // there is no settled frame to wait for even on a report that has none.
      await tester.pump(const Duration(milliseconds: 50));
    }

    List<Rect> dots(WidgetTester tester) => tester
        .widgetList<Container>(find.descendant(
          of: find.byType(IncidentStatusTimeline),
          matching: find.byType(Container),
        ))
        .where((c) =>
            c.constraints?.maxWidth == 18 && c.constraints?.maxHeight == 18)
        .map((c) => tester.getRect(find.byWidget(c)))
        .toList();

    List<Rect> connectors(WidgetTester tester) => tester
        .widgetList<Container>(find.descendant(
          of: find.byType(IncidentStatusTimeline),
          matching: find.byType(Container),
        ))
        .where((c) =>
            c.constraints?.maxWidth == 2 &&
            !(c.constraints?.hasBoundedHeight ?? true))
        .map((c) => tester.getRect(find.byWidget(c)))
        .toList();

    testWidgets('a connector runs from one dot to the next', (tester) async {
      await pumpTimeline(tester);

      final d = dots(tester);
      final lines = connectors(tester);
      expect(d, hasLength(4));
      expect(lines, hasLength(3), reason: 'one line per gap, none after the last');

      // Stated as "no gap, no overlap" rather than as exact coordinates,
      // because the rect measured here is the connector's margin box — the
      // visible rule is inset within it. What matters is that the box lands
      // flush between the two dots at both ends: it must not start above the
      // dot it hangs from, must not run past the one it reaches, and must not
      // leave daylight at either end.
      const slack = 3.0;
      for (var i = 0; i < lines.length; i++) {
        expect(lines[i].top, greaterThanOrEqualTo(d[i].bottom - 0.01),
            reason: 'line $i overlaps dot ${i + 1}');
        expect(lines[i].top - d[i].bottom, lessThanOrEqualTo(slack),
            reason: 'line $i starts short of dot ${i + 1}');
        expect(lines[i].bottom, lessThanOrEqualTo(d[i + 1].top + 0.01),
            reason: 'line $i overlaps dot ${i + 2}');
        expect(d[i + 1].top - lines[i].bottom, lessThanOrEqualTo(slack),
            reason: 'line $i stops short of dot ${i + 2}');
      }
    });

    testWidgets('the connectors are not all one height', (tester) async {
      await pumpTimeline(tester);

      // The regression guard. The old rail drew `height: 56` for every gap
      // regardless of the prose beside it, so this list would come back as
      // three identical numbers while the dots drifted away from the ends of
      // the lines. Different stages, different gaps — by construction.
      final heights =
          connectors(tester).map((r) => r.height.roundToDouble()).toSet();
      expect(heights.length, greaterThan(1),
          reason: 'every gap is the same height, so the line is not stretching');
    });

    testWidgets('every dot shares a centre line with its own label',
        (tester) async {
      await pumpTimeline(tester);

      const labels = [
        'Report Submitted',
        'Verified by Security',
        'Dispatched / In Progress',
        'Resolved',
      ];
      final d = dots(tester);
      for (var i = 0; i < labels.length; i++) {
        expect(
          tester.getRect(find.text(labels[i])).center.dy,
          closeTo(d[i].center.dy, 1.5),
          reason: '"${labels[i]}" is not level with its node',
        );
      }
    });

    testWidgets('every dot sits on one vertical axis', (tester) async {
      await pumpTimeline(tester);
      final centres = dots(tester).map((r) => r.center.dx).toSet();
      expect(centres, hasLength(1),
          reason: 'the rail wanders horizontally between stages');
    });
  });
}
