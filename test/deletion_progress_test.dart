import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/network_progress_bar.dart';
import 'package:monticello_villas_app/core/widgets/skeleton.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/incidents/models/report_deletion.dart';
import 'package:monticello_villas_app/features/incidents/screens/incidents_screen.dart';
import 'package:monticello_villas_app/features/incidents/widgets/history_skeleton.dart';

Incident _incident(IncidentStatus status, {String id = 'INC-001'}) => Incident(
      id: id,
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
    );

/// The filled portion of the bar, 0–1.
double _fill(WidgetTester tester) => tester
    .widget<FractionallySizedBox>(
      find.descendant(
        of: find.byType(NetworkProgressBar),
        matching: find.byType(FractionallySizedBox),
      ),
    )
    .widthFactor!;

/// `AnimatedContainer` folds a `color` into a `BoxDecoration`, so the fill is
/// read back off the decoration rather than off a field it does not keep.
Color _fillColor(WidgetTester tester) {
  final bar = tester.widget<AnimatedContainer>(
    find.descendant(
      of: find.byType(NetworkProgressBar),
      matching: find.byType(AnimatedContainer),
    ),
  );
  return (bar.decoration! as BoxDecoration).color!;
}

Future<void> _pumpBar(
  WidgetTester tester, {
  required NetworkTaskState state,
  Duration expected = const Duration(seconds: 1),
  VoidCallback? onSettled,
}) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 200,
            child: NetworkProgressBar(
              expected: expected,
              state: state,
              onSettled: onSettled,
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  group('the deletion progress bar', () {
    testWidgets('fills as the request runs, without finishing it',
        (tester) async {
      await _pumpBar(tester, state: NetworkTaskState.running);

      await tester.pump(const Duration(milliseconds: 500));
      final half = _fill(tester);
      expect(half, greaterThan(0));

      await tester.pump(const Duration(milliseconds: 500));
      final due = _fill(tester);
      expect(due, greaterThan(half));

      // Past the moment the request was expected to land, and still short of
      // the end: nothing has told this bar the write succeeded.
      await tester.pump(const Duration(seconds: 6));
      expect(_fill(tester), lessThan(1.0));
    });

    testWidgets('a slow connection is paced slower than a fast one',
        (tester) async {
      await _pumpBar(
        tester,
        state: NetworkTaskState.running,
        expected: const Duration(milliseconds: 400),
      );
      await tester.pump(const Duration(milliseconds: 400));
      final fast = _fill(tester);

      await _pumpBar(
        tester,
        state: NetworkTaskState.running,
        expected: const Duration(seconds: 8),
      );
      await tester.pump(const Duration(milliseconds: 400));
      final slow = _fill(tester);

      // THE POINT OF THIS TEST. Same wall-clock moment, two connections: the
      // bar is a function of the measured round trip, not of a fixed animation
      // that would have drawn both identically.
      expect(fast, greaterThan(slow * 3));
    });

    testWidgets('the server answer is what completes it', (tester) async {
      var settled = 0;
      await _pumpBar(
        tester,
        state: NetworkTaskState.running,
        onSettled: () => settled++,
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(_fill(tester), lessThan(1.0));

      await _pumpBar(
        tester,
        state: NetworkTaskState.succeeded,
        onSettled: () => settled++,
      );
      await tester.pump(NetworkProgressBar.settle);
      await tester.pump();

      expect(_fill(tester), 1.0);
      expect(settled, 1, reason: 'the row is released exactly once');
    });

    testWidgets('a failure stops the bar where it was and turns it red',
        (tester) async {
      var settled = 0;
      await _pumpBar(
        tester,
        state: NetworkTaskState.running,
        onSettled: () => settled++,
      );
      await tester.pump(const Duration(milliseconds: 600));
      final reached = _fill(tester);

      await _pumpBar(
        tester,
        state: NetworkTaskState.failed,
        onSettled: () => settled++,
      );
      await tester.pump(const Duration(milliseconds: 200));

      // Running a failed bar to full would draw the one thing that did not
      // happen.
      expect(_fill(tester), reached);
      expect(_fillColor(tester), AppColors.danger);
      expect(settled, 0, reason: 'the red is held long enough to be read');

      await tester.pump(NetworkProgressBar.failLinger);
      expect(settled, 1);
    });
  });

  group('a report being deleted', () {
    Future<void> pumpFeed(
      WidgetTester tester, {
      required Map<String, ReportDeletion> deletions,
      ValueChanged<String>? onSettled,
    }) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncidentHistoryList(
              incidents: [
                _incident(IncidentStatus.resolved, id: 'INC-001'),
                _incident(IncidentStatus.closed, id: 'INC-002'),
              ],
              canDelete: true,
              onDelete: (_) async {},
              onRefresh: () async {},
              deletions: deletions,
              onDeletionSettled: onSettled,
            ),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('holds its row and draws a bar on it', (tester) async {
      await pumpFeed(tester, deletions: {
        'INC-001': ReportDeletion(
          incident: _incident(IncidentStatus.resolved),
          expected: const Duration(seconds: 1),
        ),
      });

      // The card stays. Firestore drops the document from its local cache the
      // moment delete() is called, so a row that followed the store would
      // vanish a frame after the resident confirmed — taking the progress bar
      // with it.
      expect(find.text('Broken street light'), findsNWidgets(2));
      expect(find.byType(NetworkProgressBar), findsOneWidget);
      expect(find.text('Deleting report…'), findsOneWidget);
    });

    testWidgets('says so when the delete did not land', (tester) async {
      await pumpFeed(tester, deletions: {
        'INC-001': ReportDeletion(
          incident: _incident(IncidentStatus.resolved),
          expected: const Duration(seconds: 1),
          state: NetworkTaskState.failed,
        ),
      });

      expect(
        find.text('Couldn\'t delete — the report is still here.'),
        findsOneWidget,
      );
    });

    testWidgets('a row not being deleted carries no bar', (tester) async {
      await pumpFeed(tester, deletions: const {});
      expect(find.byType(NetworkProgressBar), findsNothing);
    });

    testWidgets('reports back with the key of the row it was drawing',
        (tester) async {
      final settled = <String>[];
      await pumpFeed(
        tester,
        deletions: {
          'INC-002': ReportDeletion(
            incident: _incident(IncidentStatus.closed, id: 'INC-002'),
            expected: const Duration(seconds: 1),
            state: NetworkTaskState.succeeded,
          ),
        },
        onSettled: settled.add,
      );

      await tester.pump(NetworkProgressBar.settle);
      await tester.pump();
      expect(settled, ['INC-002']);
    });
  });

  group('the skeleton placeholders', () {
    testWidgets('the History feed stands in one card per report',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: HistoryFeedSkeleton(cards: 3)),
      ));

      expect(find.byType(SkeletonBlock), findsWidgets);
      // Four discs and three rails per card, plus the content blocks.
      expect(find.byType(FadeTransition), findsWidgets);
    });

    testWidgets('pulses, and keeps pulsing', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: HistoryFeedSkeleton(cards: 1)),
      ));

      double opacity() => tester
          .widget<FadeTransition>(
            find
                .descendant(
                  of: find.byType(Skeleton),
                  matching: find.byType(FadeTransition),
                )
                .first,
          )
          .opacity
          .value;

      expect(opacity(), 1.0);
      await tester.pump(Skeleton.period ~/ 2);
      expect(opacity(), closeTo(Skeleton.minOpacity, 0.001));
      // Back up: `animate-pulse` is a cycle, not a one-way fade.
      await tester.pump(Skeleton.period ~/ 2);
      expect(opacity(), closeTo(1, 0.001));
    });

    testWidgets('is announced as loading, not read out shape by shape',
        (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: HistoryFeedSkeleton(cards: 2)),
      ));

      expect(find.bySemanticsLabel('Loading your reports'), findsOneWidget);
      handle.dispose();
    });
  });
}
