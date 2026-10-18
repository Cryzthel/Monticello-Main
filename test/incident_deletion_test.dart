import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/shared_widgets.dart';
import 'package:monticello_villas_app/core/widgets/swipe_to_delete.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/incidents/screens/incidents_screen.dart';

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

/// A fixed 300px row, so swipe distances map onto the threshold predictably:
/// 0.42 of 300 is 126px.
const double _rowWidth = 300;

Future<void> _pumpRow(
  WidgetTester tester, {
  required VoidCallback onDismissed,
  Future<bool> Function()? confirmDismiss,
}) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: _rowWidth,
            child: SwipeToDelete(
              key: const ValueKey('row-1'),
              onDismissed: onDismissed,
              confirmDismiss: confirmDismiss,
              child: Container(
                height: 70,
                color: AppColors.backgroundSecondary,
                alignment: Alignment.center,
                child: const Text('REPORT'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Pumps a screen holding a context, and hands back a callback that opens the
/// given dialog from it.
Future<BuildContext> _pumpHost(WidgetTester tester) async {
  late BuildContext captured;
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(builder: (context) {
          captured = context;
          return const SizedBox.expand();
        }),
      ),
    ),
  );
  return captured;
}

void main() {
  group('who may delete a report', () {
    // The rule a resident sees is "anything under the Resolved tab", so the
    // deletable set and the Resolved tab's set are deliberately the same.
    const open = [
      IncidentStatus.pending,
      IncidentStatus.verifying,
      IncidentStatus.dispatched,
      IncidentStatus.inProgress,
    ];
    const finished = [
      IncidentStatus.resolved,
      IncidentStatus.closed,
      IncidentStatus.falseAlarm,
    ];

    test('an open report is neither terminal nor deletable', () {
      for (final status in open) {
        expect(status.isTerminal, isFalse, reason: '$status');
        expect(status.isDeletable, isFalse, reason: '$status');
        expect(status.isComplete, isFalse, reason: '$status');
      }
    });

    test('a finished report is terminal and deletable', () {
      for (final status in finished) {
        expect(status.isTerminal, isTrue, reason: '$status');
        expect(status.isDeletable, isTrue, reason: '$status');
      }
    });

    test('only a report that ran the full course is complete', () {
      // `falseAlarm` is the one that separates "stopped" from "finished": it
      // may be deleted and it sits under Resolved, but its timeline never
      // travelled the four stages.
      expect(IncidentStatus.resolved.isComplete, isTrue);
      expect(IncidentStatus.closed.isComplete, isTrue);
      expect(IncidentStatus.falseAlarm.isComplete, isFalse);
      expect(IncidentStatus.falseAlarm.isDeletable, isTrue);
    });
  });

  group('the confirmation modal', () {
    testWidgets('asks before deleting, and Cancel answers no', (tester) async {
      final context = await _pumpHost(tester);

      final answer = confirmReportDeletion(context, _incident(
        IncidentStatus.resolved,
      ));
      await tester.pumpAndSettle();

      expect(
        find.text(
          'Are you sure you want to delete this resolved report from your '
          'history?',
        ),
        findsOneWidget,
      );
      // The consequence a resident is not picturing when they answer.
      expect(find.textContaining('photo and video evidence'), findsOneWidget);

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(await answer, isFalse);
    });

    testWidgets('Delete answers yes', (tester) async {
      final context = await _pumpHost(tester);

      final answer =
          confirmReportDeletion(context, _incident(IncidentStatus.resolved));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      expect(await answer, isTrue);
    });

    testWidgets('dismissing the modal answers no', (tester) async {
      final context = await _pumpHost(tester);

      final answer =
          confirmReportDeletion(context, _incident(IncidentStatus.resolved));
      await tester.pumpAndSettle();

      // Barrier tap. A null return must not read as consent.
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(await answer, isFalse);
    });
  });

  group('an open report', () {
    testWidgets('explains itself instead of offering to delete',
        (tester) async {
      final context = await _pumpHost(tester);

      // The long-press path. It must not reach the delete prompt at all — a
      // confirm dialog that then refuses is a worse "no" than never asking.
      confirmDeleteReport(context, _incident(IncidentStatus.inProgress));
      await tester.pumpAndSettle();

      expect(find.text('Report still open'), findsOneWidget);
      expect(find.text('Delete'), findsNothing);
      expect(
        find.textContaining('deleted once they are resolved'),
        findsOneWidget,
      );

      await tester.tap(find.text('Got it'));
      await tester.pumpAndSettle();
    });
  });

  group('swipe with confirmation', () {
    testWidgets('a confirmed swipe deletes the row', (tester) async {
      var dismissed = 0;
      var asked = 0;
      await _pumpRow(
        tester,
        onDismissed: () => dismissed++,
        confirmDismiss: () async {
          asked++;
          return true;
        },
      );

      await tester.drag(find.text('REPORT'), const Offset(-200, 0));
      await tester.pumpAndSettle();

      expect(asked, 1);
      expect(dismissed, 1);
      expect(find.text('REPORT'), findsNothing);
    });

    testWidgets('a cancelled swipe keeps the row and deletes nothing',
        (tester) async {
      var dismissed = 0;
      await _pumpRow(
        tester,
        onDismissed: () => dismissed++,
        confirmDismiss: () async => false,
      );

      await tester.drag(find.text('REPORT'), const Offset(-200, 0));
      await tester.pumpAndSettle();

      expect(dismissed, 0);
      expect(find.text('REPORT'), findsOneWidget);
    });

    testWidgets('a cancelled swipe leaves the plate dark', (tester) async {
      await _pumpRow(
        tester,
        onDismissed: () {},
        confirmDismiss: () async => false,
      );

      await tester.drag(find.text('REPORT'), const Offset(-200, 0));
      await tester.pumpAndSettle();

      // `onUpdate` stops firing while the dialog is up and does not resume on
      // the spring-back, so without an explicit reset the row settles over a
      // plate still lit at full travel — ready to flash on the next scroll.
      for (final plate
          in tester.widgetList<SwipeDeletePlate>(find.byType(SwipeDeletePlate))) {
        expect(plate.progress, 0);
      }
    });

    testWidgets('a short swipe never raises the prompt', (tester) async {
      var asked = 0;
      await _pumpRow(
        tester,
        onDismissed: () {},
        confirmDismiss: () async {
          asked++;
          return true;
        },
      );

      // Under the 42% commit point — the range a diagonal scroll flick lands
      // in. Asking here would turn a mis-scroll into a modal.
      await tester.drag(find.text('REPORT'), const Offset(-40, 0));
      await tester.pumpAndSettle();

      expect(asked, 0);
      expect(find.text('REPORT'), findsOneWidget);
    });

    testWidgets('a row with no confirm still deletes outright', (tester) async {
      // The notification drawer's behaviour, unchanged: a copy of something
      // that happened needs no ceremony to remove.
      var dismissed = 0;
      await _pumpRow(tester, onDismissed: () => dismissed++);

      await tester.drag(find.text('REPORT'), const Offset(-200, 0));
      await tester.pumpAndSettle();

      expect(dismissed, 1);
    });
  });

  group('which tab may delete', () {
    Future<void> pumpFeed(
      WidgetTester tester, {
      required bool canDelete,
      required List<Incident> incidents,
      Future<void> Function(Incident)? onDelete,
    }) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncidentHistoryList(
              incidents: incidents,
              canDelete: canDelete,
              onDelete: onDelete ?? (_) async {},
              onRefresh: () async {},
            ),
          ),
        ),
      );
      await tester.pump();
    }

    final resolved = [
      _incident(IncidentStatus.resolved, id: 'INC-001'),
      _incident(IncidentStatus.closed, id: 'INC-002'),
    ];

    testWidgets('no card in the feed offers a swipe, on any tab',
        (tester) async {
      // THE POINT OF THIS TEST. Resolved cards used to carry a swipe-to-delete
      // AND a long press for the same action. The swipe is gone: this list
      // lives inside a PageView, and a Dismissible left anywhere in it claims
      // the horizontal drag that moves between History's three tabs — on the
      // one tab where the alternative meaning of that drag is "delete this".
      await pumpFeed(tester, canDelete: true, incidents: resolved);

      expect(find.byType(SwipeToDelete), findsNothing);
      // And no bare Dismissible either: one left in place would still block
      // the pager even while refusing every swipe.
      expect(find.byType(Dismissible), findsNothing);
    });

    testWidgets('the Resolved tab deletes on a confirmed press and hold',
        (tester) async {
      final deleted = <String>[];
      await pumpFeed(
        tester,
        canDelete: true,
        incidents: resolved,
        onDelete: (incident) async => deleted.add(incident.id),
      );

      await tester.longPress(find.text('Broken street light').first);
      await tester.pumpAndSettle();
      expect(find.text('Delete report?'), findsOneWidget);

      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      // The row asks; the screen writes. Nothing is deleted until the prompt
      // has been answered yes.
      expect(deleted, ['INC-001']);
    });

    testWidgets('a cancelled hold deletes nothing', (tester) async {
      final deleted = <String>[];
      await pumpFeed(
        tester,
        canDelete: true,
        incidents: resolved,
        onDelete: (incident) async => deleted.add(incident.id),
      );

      await tester.longPress(find.text('Broken street light').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(deleted, isEmpty);
      expect(find.text('Broken street light'), findsNWidgets(2));
    });

    testWidgets('the All tab arms nothing, even on a resolved report',
        (tester) async {
      // The same two cards that ARE deletable one tab over. Being deletable is
      // not enough — the view has to be one that deletes.
      await pumpFeed(tester, canDelete: false, incidents: resolved);

      expect(find.byType(SwipeToDelete), findsNothing);
      expect(find.byType(Dismissible), findsNothing);
    });

    testWidgets('an open report is never armed, even on the Resolved tab',
        (tester) async {
      // Belt and braces. The tab predicate should never route one here, so
      // this asserts the per-report gate still stands on its own.
      await pumpFeed(
        tester,
        canDelete: true,
        incidents: [_incident(IncidentStatus.inProgress)],
      );

      await tester.longPress(find.text('Broken street light').first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.byType(SwipeToDelete), findsNothing);
      expect(find.text('Delete report?'), findsNothing);
    });

    testWidgets('the All tab drops the long-press trigger too', (tester) async {
      await pumpFeed(tester, canDelete: false, incidents: resolved);

      await tester.longPress(find.text('Broken street light').first);
      // pump, not pumpAndSettle. With no long-press handler registered the
      // hold falls through to the tap recogniser and opens the detail sheet,
      // whose active-node halo pulses forever — settling would never return.
      // Falling through is the right outcome anyway: a slow tap is a tap.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      // No prompt, no notice, nothing destructive. A long press that opens a
      // dialog only to refuse would be the screen half-keeping its own rule.
      expect(find.text('Delete report?'), findsNothing);
      expect(find.text('Report still open'), findsNothing);
      expect(find.text('Delete'), findsNothing);
    });

    testWidgets('the Resolved tab keeps the long-press trigger',
        (tester) async {
      await pumpFeed(tester, canDelete: true, incidents: resolved);

      await tester.longPress(find.text('Broken street light').first);
      await tester.pumpAndSettle();

      expect(find.text('Delete report?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
    });

    group('nothing sits above the feed', () {
      testWidgets('the first item is a report, on every tab', (tester) async {
        // THE POINT OF THIS TEST. This feed has carried three different
        // standing notices — the All tab's retention policy, then "Press and
        // hold a report to delete it" on Resolved and "Open reports can't be
        // deleted" on Active. All of them were item 0, above the records, on
        // a screen opened to read two records and leave.
        for (final canDelete in [true, false]) {
          await pumpFeed(
            tester,
            canDelete: canDelete,
            incidents: resolved,
          );

          expect(find.byIcon(PhosphorIconsFill.handTap), findsNothing);
          expect(find.byIcon(PhosphorIconsFill.info), findsNothing);
          expect(find.textContaining('Press and hold'), findsNothing);
          expect(find.textContaining('can\'t be deleted'), findsNothing);

          // The first card sits directly under the list's own top inset —
          // nothing is prepended to it.
          expect(
            tester.getRect(find.text('Broken street light').first).top -
                tester.getRect(find.byType(ListView)).top,
            lessThan(32),
            reason: 'canDelete: $canDelete',
          );
        }
      });
    });
  });

  group('legacy', () {
    testWidgets('a row with no confirm still deletes outright', (tester) async {
      // The notification drawer's behaviour, unchanged: a copy of something
      // that happened needs no ceremony to remove.
      var dismissed = 0;
      await _pumpRow(tester, onDismissed: () => dismissed++);

      await tester.drag(find.text('REPORT'), const Offset(-200, 0));
      await tester.pumpAndSettle();

      expect(dismissed, 1);
    });
  });
}
