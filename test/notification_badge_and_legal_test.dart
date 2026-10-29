import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/legal/legal_content.dart';
import 'package:monticello_villas_app/features/legal/legal_document_view.dart';
import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';
import 'package:monticello_villas_app/features/notifications/services/notification_badge.dart';

ResidentNotification _n(String id, DateTime at) => ResidentNotification(
      event: NotificationEvent.dispatched,
      at: at,
      sourceId: id,
      headline: id,
      detail: '',
      tint: AppColors.info,
      icon: Icons.send,
    );

void main() {
  group('header bell dot', () {
    final badge = NotificationBadge.instance;
    final now = DateTime(2026, 10, 29, 12);

    test('lit only for something newer than the last visit', () {
      badge.debugReset(lastOpened: DateTime(2026, 10, 29, 10));
      expect(badge.hasUnread([_n('old', DateTime(2026, 10, 29, 9))], now: now), isFalse);
      expect(badge.hasUnread([_n('new', DateTime(2026, 10, 29, 11))], now: now), isTrue);
    });

    test('opening the drawer puts it out', () {
      badge.debugReset(lastOpened: DateTime(2026, 10, 29, 10));
      final feed = [_n('new', DateTime(2026, 10, 29, 11))];
      expect(badge.hasUnread(feed, now: now), isTrue);
      badge.noteOpened(DateTime(2026, 10, 29, 11, 30));
      expect(badge.hasUnread(feed, now: now), isFalse);
    });

    test('reading or deleting the new item puts it out', () {
      final feed = [_n('new', DateTime(2026, 10, 29, 11))];
      final id = feed.single.id;
      badge.debugReset(lastOpened: DateTime(2026, 10, 29, 10), read: {id});
      expect(badge.hasUnread(feed, now: now), isFalse);
      badge.debugReset(lastOpened: DateTime(2026, 10, 29, 10), dismissed: {id});
      expect(badge.hasUnread(feed, now: now), isFalse);
    });

    test('an empty feed never lights it', () {
      badge.debugReset();
      expect(badge.hasUnread(const [], now: now), isFalse);
    });
  });

  group('legal documents', () {
    testWidgets('the intro is a card, every section follows, no key points', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(child: LegalDocumentBody(document: termsAndConditions, showTitle: false)),
        ),
      ));
      expect(find.text('Key points'), findsNothing);
      expect(find.text(termsAndConditions.intro!), findsOneWidget);
      for (final section in termsAndConditions.sections) {
        expect(find.text(section.heading), findsOneWidget);
      }
      expect(tester.takeException(), isNull);
    });
  });
}
