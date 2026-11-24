import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcement_card.dart';
import 'package:monticello_villas_app/features/contact/widgets/hoa_contact_sheet.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';
import 'package:monticello_villas_app/features/notifications/widgets/notification_detail_modal.dart';
import 'package:monticello_villas_app/features/notifications/widgets/resident_notification_tile.dart';

void main() {
  group('HOA directory', () {
    test('the office is named as the directory names it', () {
      expect(HoaContact.officeName, 'HOA Admin Office');
    });

    test('every number dials as bare digits', () {
      // Displayed grouped for reading aloud; the dialler gets digits only.
      expect(HoaContact.dialUri(HoaContact.officeNumber).toString(),
          'tel:09662417617');
      expect(
        HoaContact.guards.map((g) => HoaContact.dialUri(g.number).toString()),
        ['tel:09453823579', 'tel:09078970640', 'tel:09381550006'],
      );
    });
  });

  group('the "New" badge', () {
    Announcement post(DateTime at) => Announcement(
          id: 'a',
          title: 't',
          body: 'b',
          author: 'HOA',
          category: 'General',
          postedAt: at,
        );
    final now = DateTime(2026, 10, 17, 12);

    test('marks a post under a day old', () {
      expect(isFreshAnnouncement(post(now.subtract(const Duration(hours: 3))),
          now: now), isTrue);
    });

    test('drops off at 24 hours, and never marks a future-dated post', () {
      expect(isFreshAnnouncement(post(now.subtract(const Duration(hours: 24))),
          now: now), isFalse);
      expect(isFreshAnnouncement(post(now.add(const Duration(hours: 1))),
          now: now), isFalse);
    });
  });

  group('tapping a notification', () {
    final alert = ResidentNotification(
      event: NotificationEvent.values.firstWhere(
          (e) => e != NotificationEvent.announcementPublished),
      at: DateTime(2026, 10, 17, 9, 30),
      sourceId: 'incident-1',
      headline: 'A Guard Is On The Way',
      detail: 'Your report about the gate light has been dispatched.',
      tint: AppColors.primary,
      icon: PhosphorIconsFill.shieldCheck,
      statusLabel: 'Dispatched',
      statusColor: AppColors.primary,
      guardName: 'Jose Sollano',
    );

    testWidgets('opens the full alert in a modal with a Close button',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: ResidentNotificationTile(
              notification: alert,
              onTap: () => showNotificationDetail(context, alert),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('A Guard Is On The Way'));
      await tester.pumpAndSettle();

      expect(find.byType(NotificationDetailModal), findsOneWidget);
      // Full detail, exact time, status and responder.
      expect(find.text('Oct 17, 2026 at 9:30 AM'), findsOneWidget);
      expect(find.text('Dispatched'), findsWidgets);
      expect(find.text('Jose Sollano'), findsWidgets);

      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(find.byType(NotificationDetailModal), findsNothing);
    });

    testWidgets('the unread dot shows only while unread', (tester) async {
      Widget tile(bool unread) => MaterialApp(
            home: Scaffold(
              body: ResidentNotificationTile(notification: alert, unread: unread),
            ),
          );
      await tester.pumpWidget(tile(true));
      expect(find.bySemanticsLabel(RegExp('Unread')), findsOneWidget);

      await tester.pumpWidget(tile(false));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel(RegExp('Unread')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a tile with no onTap stays inert', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: ResidentNotificationTile(notification: alert)),
      ));
      await tester.tap(find.text('A Guard Is On The Way'));
      await tester.pumpAndSettle();
      expect(find.byType(NotificationDetailModal), findsNothing);
    });
  });
}
