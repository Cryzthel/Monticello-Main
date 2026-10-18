import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/widgets/skeleton.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcement_card.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

Announcement _post({
  DateTime? postedAt,
  String author = 'HOA Admin',
  String? imageUrl,
  String category = 'Maintenance',
  bool pinned = false,
}) =>
    Announcement(
      id: 'a1',
      title: 'Water interruption, Phase 2',
      body: 'Supply will be cut while the main is repaired.',
      postedAt: postedAt ?? DateTime.now().subtract(const Duration(hours: 3)),
      author: author,
      category: category,
      imageUrl: imageUrl,
      pinned: pinned,
    );

Future<void> _pumpCard(WidgetTester tester, Announcement post) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: SizedBox(width: 360, child: AnnouncementCard(announcement: post)),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  group('the posted stamp', () {
    test('drops the year inside the current one', () {
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day, 14, 5);

      final stamp = announcementStamp(today);
      expect(stamp, DateFormat('MMM d · h:mm a').format(today));
      expect(stamp, isNot(contains('${now.year}')),
          reason: 'the year is noise on a feed of recent posts');
      // The part that matters: a notice naming a window is unreadable beside a
      // stamp that only says how long ago it was written.
      expect(stamp, contains('2:05 PM'));
    });

    test('shows the year once a post is old enough for it to matter', () {
      final old = DateTime(DateTime.now().year - 2, 3, 9, 9, 30);
      expect(announcementStamp(old), contains('${old.year}'));
    });

    test('the relative age still exists, for skimming', () {
      // Both units are kept on purpose — see the doc on [announcementStamp].
      final t = DateTime.now().subtract(const Duration(hours: 3));
      expect(announcementTimeAgo(t), '3h ago');
    });
  });

  group('the byline', () {
    testWidgets('names the publisher, seals it, and dates it', (tester) async {
      final at = DateTime(DateTime.now().year, 5, 2, 8, 15);
      await _pumpCard(tester, _post(postedAt: at));

      expect(find.text('HOA Admin'), findsOneWidget);
      // The seal is what separates an official notice from a screenshot
      // forwarded in a group chat. Every post in this feed comes from the
      // admin portal, so it is a claim about the collection, not per-post.
      expect(find.byIcon(PhosphorIconsFill.sealCheck), findsOneWidget);
      expect(find.text(announcementStamp(at)), findsOneWidget);
    });

    testWidgets('falls back to the estate when a post has no author',
        (tester) async {
      await _pumpCard(tester, _post(author: ''));

      expect(find.text('Monticello Villas HOA'), findsOneWidget);
      expect(find.byIcon(PhosphorIconsFill.sealCheck), findsOneWidget);
    });
  });

  group('image loading', () {
    testWidgets('a post with no image renders no media block', (tester) async {
      await _pumpCard(tester, _post());
      expect(find.byType(CachedNetworkImage), findsNothing);
    });

    testWidgets('waits on a pulsing block, not a spinner', (tester) async {
      await _pumpCard(
        tester,
        _post(imageUrl: 'https://example.invalid/notice.jpg'),
      );

      final image =
          tester.widget<CachedNetworkImage>(find.byType(CachedNetworkImage));

      // THE POINT OF THIS TEST. This was `Image.network` with a
      // CircularProgressIndicator in the middle of a grey box: an answer to
      // "is the app working", which the resident already assumes, rather than
      // to "what is arriving". The placeholder is built directly rather than
      // waited for, so the assertion does not depend on a network fetch
      // failing in a particular way.
      final placeholder = image.placeholder!(
        tester.element(find.byType(AnnouncementCard)),
        'https://example.invalid/notice.jpg',
      );
      expect(placeholder, isA<Skeleton>());
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('fades in rather than snapping', (tester) async {
      await _pumpCard(
        tester,
        _post(imageUrl: 'https://example.invalid/notice.jpg'),
      );

      final image =
          tester.widget<CachedNetworkImage>(find.byType(CachedNetworkImage));
      // Six cards each popping from grey to photo at their own pace reads as
      // flicker down the length of a scroll; a fade makes each one settle.
      expect(image.fadeInDuration, const Duration(milliseconds: 300));
      // And decoded near the width it is drawn at — a feed of 16:9 phone
      // photos is the app's heaviest decode.
      expect(image.memCacheWidth, 720);
    });
  });

  group('the badges', () {
    List<String> labels(Announcement a) =>
        announcementBadges(a).map((b) => b.label).toList();

    test('category, then Pinned, then New, each once', () {
      expect(labels(_post(pinned: true)), ['Maintenance', 'Pinned', 'New']);
      final old = DateTime.now().subtract(const Duration(days: 3));
      expect(labels(_post(postedAt: old)), ['Maintenance']);
    });

    test('an unknown or status-like category folds to one General badge', () {
      // The label is canonical (four words), so a stored "New" or "Pinned"
      // can never print a second status pill.
      for (final odd in ['New', 'PINNED', 'Notice ', '']) {
        expect(labels(_post(category: odd, pinned: true)),
            ['General', 'Pinned', 'New'],
            reason: 'category "$odd"');
      }
    });

    test('the category badge uses the canonical label', () {
      expect(labels(_post(category: 'Utilities')).first, 'Maintenance');
    });

    testWidgets('a photo post shows its category once, not on the image too',
        (tester) async {
      await _pumpCard(tester, _post(imageUrl: 'https://example.com/a.jpg'));
      expect(find.text('Maintenance'), findsOneWidget);
    });

    testWidgets('all badges sit in one row and stay inside the card',
        (tester) async {
      await _pumpCard(tester, _post(pinned: true));
      final rects = [
        for (final l in ['Maintenance', 'Pinned', 'New'])
          tester.getRect(find.text(l)),
      ];
      // One row: every label shares a vertical centre.
      for (final r in rects) {
        expect(r.center.dy, closeTo(rects.first.center.dy, 0.5));
      }
      // Left to right, inside the 360pt card.
      expect(rects[0].right, lessThan(rects[1].left));
      expect(rects[1].right, lessThan(rects[2].left));
      expect(rects.last.right, lessThanOrEqualTo(360));
      expect(tester.takeException(), isNull);
    });

    testWidgets('three badges still fit one row on a narrow card',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SizedBox(
              width: 260,
              child: AnnouncementCard(
                announcement: _post(pinned: true),
              ),
            ),
          ),
        ),
      ));
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'no overflow');
      final first = tester.getRect(find.text('Maintenance'));
      for (final l in ['Pinned', 'New']) {
        expect(tester.getRect(find.text(l)).center.dy,
            closeTo(first.center.dy, 0.5));
      }
    });
  });
}
