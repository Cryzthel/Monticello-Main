import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/filter_pills.dart';
import 'package:monticello_villas_app/core/widgets/history_row.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

Announcement _post(String author) => Announcement(
      id: 'a',
      title: 'Water interruption',
      body: 'Phase 2',
      postedAt: DateTime(2026, 10, 29),
      author: author,
    );

void main() {
  group('FilterPillBar', () {
    Future<void> pump(WidgetTester tester, int selected, ValueChanged<int> onChanged) =>
        tester.pumpWidget(MaterialApp(
          home: Scaffold(
            body: FilterPillBar(
              selectedIndex: selected,
              onChanged: onChanged,
              options: const [
                FilterPillOption('All'),
                FilterPillOption('Active'),
                FilterPillOption('Resolved'),
              ],
            ),
          ),
        ));

    BoxDecoration fillOf(WidgetTester tester, String label) {
      final box = tester.widget<AnimatedContainer>(
        find.ancestor(of: find.text(label), matching: find.byType(AnimatedContainer)),
      );
      return box.decoration! as BoxDecoration;
    }

    testWidgets('the active pill is solid green with white text', (tester) async {
      await pump(tester, 0, (_) {});
      await tester.pumpAndSettle();
      expect(fillOf(tester, 'All').color, FilterPillBar.activeFill);
      expect(tester.widget<Text>(find.text('All')).style!.color, Colors.white);
      expect(fillOf(tester, 'Active').color, isNot(FilterPillBar.activeFill));
    });

    testWidgets('tapping reports the index, and the change animates', (tester) async {
      var picked = -1;
      await pump(tester, 0, (i) => picked = i);
      await tester.tap(find.text('Resolved'));
      expect(picked, 2);

      await pump(tester, 2, (_) {});
      await tester.pump(const Duration(milliseconds: 60));
      // Mid-transition: the label is neither its old nor its new colour yet.
      final mid = tester.widget<Text>(find.text('Resolved')).style!.color;
      expect(mid, isNot(Colors.white));
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.text('Resolved')).style!.color, Colors.white);
    });
  });

  group('HistoryRow', () {
    testWidgets('title, detail, time and status in one row', (tester) async {
      var tapped = false;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: HistoryRow(
            icon: Icons.warning,
            tint: AppColors.danger,
            title: 'Suspicious person',
            detail: 'Security · Phase 2 Block 7',
            at: DateTime(2026, 10, 29, 14, 5),
            statusLabel: 'Resolved',
            statusColor: AppColors.success,
            onTap: () => tapped = true,
          ),
        ),
      ));
      expect(find.text('Suspicious person'), findsOneWidget);
      expect(find.text('Security · Phase 2 Block 7'), findsOneWidget);
      expect(find.text('29 Oct 14:05'), findsOneWidget);
      expect(find.text('Resolved'), findsOneWidget);
      await tester.tap(find.text('Suspicious person'));
      expect(tapped, isTrue);
      expect(tester.takeException(), isNull);
    });
  });

  group('Announcement.publisher', () {
    test('an email-shaped author reads as the HOA, never the address', () {
      expect(_post('adminmonticellov@gmail.com').publisher, 'Monticello Villas HOA');
      expect(_post('').publisher, 'Monticello Villas HOA');
    });

    test('a display name is kept', () {
      expect(_post('HOA Office').publisher, 'HOA Office');
    });
  });
}
