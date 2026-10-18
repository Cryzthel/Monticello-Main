import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/feed_skeletons.dart';
import 'package:monticello_villas_app/core/widgets/skeleton.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcements_panel.dart';
import 'package:monticello_villas_app/features/legal/legal_content.dart';

void main() {
  Future<void> pumpAt375(WidgetTester tester, Widget child) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: child)));
    await tester.pump(const Duration(milliseconds: 300));
  }

  group('every data screen has a placeholder that fits a phone', () {
    final cases = <String, Widget>{
      'announcements': const AnnouncementFeedSkeleton(),
      'notifications': const NotificationListSkeleton(),
      'property': const PropertyDetailsSkeleton(),
      'profile': const ProfileFormSkeleton(),
    };
    cases.forEach((name, widget) {
      testWidgets(name, (tester) async {
        await pumpAt375(tester, widget);
        expect(find.byType(Skeleton), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    });
  });

  group('home announcements sheet', () {
    Future<void> pumpPanel(WidgetTester tester, {required bool loading}) =>
        pumpAt375(
          tester,
          AnnouncementsPanel(
            items: const [],
            loading: loading,
            onSeeAll: () {},
            scrollController: ScrollController(),
          ),
        );

    testWidgets('pulses cards while the first snapshot is in flight',
        (tester) async {
      await pumpPanel(tester, loading: true);
      expect(find.byType(AnnouncementCardSkeleton), findsWidgets);
    });

    testWidgets('shows no placeholder once the feed has answered',
        (tester) async {
      await pumpPanel(tester, loading: false);
      expect(find.byType(AnnouncementCardSkeleton), findsNothing);
    });
  });

  test('the Privacy Policy names the HOA admin address', () {
    expect(kPrivacyEmail, 'adminmonticellov@gmail.com');
    final contact = privacyPolicy.sections.last;
    expect(contact.heading, '6. Contact Us');
    expect(contact.blocks.single.text, contains('adminmonticellov@gmail.com'));
    expect(contact.blocks.single.text, isNot(contains('privacy@')));
  });
}
