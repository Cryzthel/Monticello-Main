import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/announcements/widgets/announcement_card.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcements_panel.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

List<Announcement> _posts(int n) => List.generate(
      n,
      (i) => Announcement(
        id: '$i',
        title: 'Notice $i',
        body: 'Body copy for notice $i, long enough to occupy a line or two.',
        postedAt: DateTime.now().subtract(Duration(hours: i)),
        author: 'HOA Admin',
        // Deliberately mixed: the dashboard feed must show every category, so a
        // panel that still filtered anything would drop most of these.
        category: const ['General', 'Security', 'Maintenance', 'Event'][i % 4],
      ),
    );

/// Hosts the panel exactly as the dashboard does — inside a
/// [DraggableScrollableSheet], over a stand-in for the map.
///
/// The sheet is not decoration in this harness. The panel takes the sheet's
/// ScrollController and drives a CustomScrollView with it; hosting it any other
/// way would test a widget the app never builds.
Widget _host(
  List<Announcement> items, {
  VoidCallback? onSeeAll,
  double height = 640,
}) =>
    MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: height,
          child: Stack(
            children: [
              const Positioned.fill(
                child: ColoredBox(color: Color(0xFF203040)), // the map
              ),
              DraggableScrollableSheet(
                initialChildSize: 0.46,
                minChildSize: 0.28,
                maxChildSize: 1.0,
                snap: true,
                snapSizes: const [0.28, 0.46, 1.0],
                builder: (context, controller) => AnnouncementsPanel(
                  items: items,
                  scrollController: controller,
                  onSeeAll: onSeeAll ?? () {},
                  horizontalPadding: 20,
                ),
              ),
            ],
          ),
        ),
      ),
    );

void main() {
  testWidgets('renders the feed with no category filter bar', (tester) async {
    await tester.pumpWidget(_host(_posts(8)));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Announcements'), findsOneWidget);
    expect(find.byType(AnnouncementCard), findsWidgets);

    // The filter bar is gone from the dashboard. It still exists as a widget —
    // the full Announcements screen uses it — so this asserts its absence
    // here rather than its deletion everywhere.
    //
    // Asserted on the TYPE, not on chip labels. Category names legitimately
    // appear on screen as badges on the notice cards, so a text finder cannot
    // tell a filter chip from a badge and will fail on a correct panel.
    expect(find.byType(AnnouncementFilterBar), findsNothing);
    // "All" is the one label unique to the filter bar — no badge ever reads it.
    expect(find.text('All'), findsNothing);
  });

  testWidgets('shows every category, unfiltered and newest first',
      (tester) async {
    await tester.pumpWidget(_host(_posts(4)));
    await tester.pumpAndSettle();

    // Open the sheet fully — a lazy sliver list only builds what fits, so at
    // the half-open size the later notices are not in the tree yet and their
    // absence would say nothing about filtering.
    await tester.drag(find.text('Announcements'), const Offset(0, -400));
    await tester.pumpAndSettle();

    // Four posts, four different categories, all present.
    for (var i = 0; i < 4; i++) {
      expect(find.text('Notice $i'), findsOneWidget);
    }
    // Order preserved as handed in — the store supplies publishedAt DESC and
    // the panel must not re-sort or subset it.
    final first = tester.getTopLeft(find.text('Notice 0')).dy;
    final second = tester.getTopLeft(find.text('Notice 1')).dy;
    expect(first, lessThan(second));
  });

  testWidgets('the sheet drags up to the full height of its body',
      (tester) async {
    await tester.pumpWidget(_host(_posts(12)));
    await tester.pumpAndSettle();

    final collapsed = tester.getTopLeft(find.byType(AnnouncementsPanel)).dy;
    expect(collapsed, greaterThan(0), reason: 'starts partway down the map');

    // Drag from the pinned heading — the gesture a thumb actually makes.
    await tester.drag(find.text('Announcements'), const Offset(0, -400));
    await tester.pumpAndSettle();

    // maxChildSize: 1.0 means the sheet's top reaches the top of the body,
    // which on the dashboard is the underside of the header.
    expect(tester.getTopLeft(find.byType(AnnouncementsPanel)).dy, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the feed scrolls once the sheet is fully open', (tester) async {
    await tester.pumpWidget(_host(_posts(20)));
    await tester.pumpAndSettle();

    // Open the sheet fully first, so the drag below scrolls the list rather
    // than continuing to expand the sheet.
    await tester.drag(find.text('Announcements'), const Offset(0, -400));
    await tester.pumpAndSettle();

    final feed = find.byType(CustomScrollView);
    final controller = tester.widget<CustomScrollView>(feed).controller!;
    expect(controller.offset, 0);

    await tester.drag(feed, const Offset(0, -200));
    await tester.pumpAndSettle();

    // Asserted on scroll offset rather than a card's position: the list
    // recycles, so "the first card in the tree" is a different notice after
    // scrolling and its dy proves nothing.
    expect(controller.offset, greaterThan(0));

    // The heading rides WITH the content — it is a plain sliver, not a pinned
    // one, so that a drag starting on it belongs to the sheet. Pinning it
    // asserts inside a DraggableScrollableSheet; see the panel's class doc.
    expect(find.text('Announcements'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty feed still renders the sheet and its heading',
      (tester) async {
    await tester.pumpWidget(_host(const []));
    await tester.pumpAndSettle();

    expect(find.text('No announcements yet'), findsOneWidget);
    expect(find.text('Announcements'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('See all fires its callback', (tester) async {
    var tapped = false;
    await tester.pumpWidget(_host(_posts(3), onSeeAll: () => tapped = true));
    await tester.pumpAndSettle();

    await tester.tap(find.text('See all'));
    expect(tapped, isTrue);
  });
}
