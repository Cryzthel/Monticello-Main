import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';
import 'package:monticello_villas_app/features/notifications/services/notification_prefs_store.dart';
import 'package:monticello_villas_app/features/notifications/widgets/resident_notification_tile.dart';

ResidentNotification _alert(String id, DateTime at) => ResidentNotification(
      event: NotificationEvent.dispatched,
      at: at,
      sourceId: id,
      headline: 'Guard Dispatched to Location',
      detail: 'A responder is on the way.',
      tint: AppColors.info,
      icon: Icons.send,
      statusLabel: 'Dispatched',
      statusColor: AppColors.info,
      guardName: 'R. Cruz',
    );

/// The overflow button, found by widget shape rather than by its generic type —
/// the action enum it is parameterised on is private to the tile's library.
Finder _overflowMenu() =>
    find.byWidgetPredicate((widget) => widget is PopupMenuButton);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('NotificationSections — the New / Earlier split', () {
    final boundary = DateTime(2026, 8, 15, 12, 0);

    test('anything stamped after the last visit is New', () {
      final feed = [
        _alert('a', boundary.add(const Duration(minutes: 5))),
        _alert('b', boundary.subtract(const Duration(minutes: 5))),
      ];

      final sections = NotificationSections.split(feed, boundary);
      expect(sections.fresh.map((n) => n.sourceId), ['a']);
      expect(sections.earlier.map((n) => n.sourceId), ['b']);
    });

    test('an alert stamped EXACTLY at the boundary is not New', () {
      // It was on screen when the drawer was last read. Counting it as New
      // would resurface the last row of every visit on the next one.
      final sections =
          NotificationSections.split([_alert('a', boundary)], boundary);
      expect(sections.fresh, isEmpty);
      expect(sections.earlier, hasLength(1));
    });

    test('order within each section is preserved', () {
      final feed = [
        _alert('newest', boundary.add(const Duration(hours: 2))),
        _alert('newer', boundary.add(const Duration(hours: 1))),
        _alert('older', boundary.subtract(const Duration(hours: 1))),
        _alert('oldest', boundary.subtract(const Duration(hours: 2))),
      ];

      final sections = NotificationSections.split(feed, boundary);
      expect(sections.fresh.map((n) => n.sourceId), ['newest', 'newer']);
      expect(sections.earlier.map((n) => n.sourceId), ['older', 'oldest']);
    });

    test('an empty feed produces two empty sections', () {
      final sections = NotificationSections.split(const [], boundary);
      expect(sections.isEmpty, isTrue);
    });
  });

  group('NotificationPrefsStore — dismissal', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('starts with nothing dismissed', () async {
      expect(await NotificationPrefsStore.loadDismissed(), isEmpty);
    });

    test('a dismissed id survives a reload', () async {
      await NotificationPrefsStore.dismiss('inc1:dispatched');
      expect(
        await NotificationPrefsStore.loadDismissed(),
        contains('inc1:dispatched'),
      );
    });

    test('dismissing twice does not duplicate', () async {
      await NotificationPrefsStore.dismiss('inc1:dispatched');
      await NotificationPrefsStore.dismiss('inc1:dispatched');
      expect(await NotificationPrefsStore.loadDismissed(), hasLength(1));
    });

    test('restore backs a dismissal out, so Undo can work', () async {
      await NotificationPrefsStore.dismiss('inc1:dispatched');
      await NotificationPrefsStore.restore('inc1:dispatched');
      expect(await NotificationPrefsStore.loadDismissed(), isEmpty);
    });

    test('restoring something never dismissed is a no-op', () async {
      await NotificationPrefsStore.dismiss('keep-me');
      await NotificationPrefsStore.restore('never-there');
      expect(await NotificationPrefsStore.loadDismissed(), {'keep-me'});
    });

    test('the list is capped, dropping the oldest first', () async {
      for (var i = 0; i < NotificationPrefsStore.maxDismissed + 5; i++) {
        await NotificationPrefsStore.dismiss('id-$i');
      }

      final dismissed = await NotificationPrefsStore.loadDismissed();
      expect(dismissed, hasLength(NotificationPrefsStore.maxDismissed));
      // Falling off the end means the alert can come back — the safe direction.
      expect(dismissed, isNot(contains('id-0')));
      expect(
        dismissed,
        contains('id-${NotificationPrefsStore.maxDismissed + 4}'),
      );
    });

    test('an empty id is ignored rather than stored', () async {
      await NotificationPrefsStore.dismiss('');
      expect(await NotificationPrefsStore.loadDismissed(), isEmpty);
    });
  });

  group('NotificationPrefsStore — last opened', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('is null before the drawer has ever been opened', () async {
      expect(await NotificationPrefsStore.loadLastOpened(), isNull);
    });

    test('round-trips to the second', () async {
      final at = DateTime(2026, 8, 15, 9, 30, 15);
      await NotificationPrefsStore.markOpened(at);
      expect(await NotificationPrefsStore.loadLastOpened(), at);
    });

    test('a later visit overwrites an earlier one', () async {
      await NotificationPrefsStore.markOpened(DateTime(2026, 8, 14));
      await NotificationPrefsStore.markOpened(DateTime(2026, 8, 15));
      expect(
        await NotificationPrefsStore.loadLastOpened(),
        DateTime(2026, 8, 15),
      );
    });
  });

  group('ResidentNotificationTile', () {
    Future<void> pump(
      WidgetTester tester, {
      VoidCallback? onDelete,
      bool unread = false,
    }) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ResidentNotificationTile(
              notification: _alert('inc1', DateTime(2026, 8, 15, 9, 12)),
              onDelete: onDelete,
              unread: unread,
            ),
          ),
        ),
      );
    }

    testWidgets('renders the alert without an overflow menu by default',
        (tester) async {
      await pump(tester);

      expect(find.text('Guard Dispatched to Location'), findsOneWidget);
      // No callback, no menu — any surface reusing this tile outside the
      // drawer has nowhere for a dismissal to be read from.
      expect(_overflowMenu(), findsNothing);
    });

    testWidgets('the 3-dot menu offers Delete Notification', (tester) async {
      var deleted = 0;
      await pump(tester, onDelete: () => deleted++);

      expect(_overflowMenu(), findsOneWidget);
      await tester.tap(_overflowMenu());
      await tester.pumpAndSettle();

      expect(find.text('Delete Notification'), findsOneWidget);
      await tester.tap(find.text('Delete Notification'));
      await tester.pumpAndSettle();

      expect(deleted, 1);
    });

    testWidgets('an unread tile is tinted, a read one is not', (tester) async {
      await pump(tester, unread: true);
      final unreadCard = tester.widget<Container>(
        find
            .descendant(
              of: find.byType(ResidentNotificationTile),
              matching: find.byType(Container),
            )
            .first,
      );
      final unreadPaint = unreadCard.decoration as BoxDecoration?;

      await pump(tester, unread: false);
      // The wash fades out rather than snapping; read it once it has.
      await tester.pumpAndSettle();
      final readCard = tester.widget<Container>(
        find
            .descendant(
              of: find.byType(ResidentNotificationTile),
              matching: find.byType(Container),
            )
            .first,
      );
      final readPaint = readCard.decoration as BoxDecoration?;

      expect(unreadPaint?.color, isNot(readPaint?.color));
    });
  });
}
