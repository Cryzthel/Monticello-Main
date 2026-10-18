import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:cached_network_image/cached_network_image.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';
import 'package:monticello_villas_app/core/widgets/skeleton.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcement_detail_sheet.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

/// The "Pinned" badge's ink. One step darker than [AppColors.primary], which
/// measures 3.30:1 on white and 3.1:1 on the badge's own 10% wash — under the
/// 4.5:1 floor a 10px label needs. green-800 clears it at ~6:1.
const Color _pinnedInk = Color(0xFF166534); // green-800

/// Feed order: pinned first, then newest.
///
/// ── WHY THIS EXISTS RATHER THAN AN ORDER-BY ───────────────────────────────
/// Firestore orders by `publishedAt DESC` and nothing else, so a pinned notice
/// sank down the feed as soon as a few ordinary ones were posted after it —
/// which is the precise opposite of what pinning means. Sorting client-side is
/// the right fix rather than a composite index: `pinned` is a boolean that
/// flips on documents already in memory, so a resident un-pinning or the HOA
/// pinning something reorders the visible feed on the next frame without a
/// re-query.
///
/// STABLE WITHIN EACH GROUP. Pinned notices keep their own newest-first order
/// rather than an arbitrary one, so two pinned posts do not swap places between
/// rebuilds.
///
/// Returns a new list — callers pass [LocalDataStore.announcements], which is
/// unmodifiable, and sorting it in place would throw.
List<Announcement> sortAnnouncementsForFeed(List<Announcement> source) {
  final sorted = [...source];
  sorted.sort((a, b) {
    if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
    return b.postedAt.compareTo(a.postedAt);
  });
  return sorted;
}

/// "2h ago" / "3d ago" — the relative stamp a feed is scanned by.
///
/// One implementation, shared. The homepage and the Announcements screen each
/// carried a byte-identical private copy, which is the kind of duplication that
/// only announces itself when the two drift and the same post claims two
/// different ages on two screens.
String announcementTimeAgo(DateTime t) {
  final diff = DateTime.now().difference(t);
  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return DateFormat('MMM d').format(t);
}

/// The posted date and time, in full.
///
/// Companion to [announcementTimeAgo], not a replacement: the relative age is
/// the right unit for skimming a feed and this is the right one for an
/// announcement that names a window. A notice reading "water supply resumes at
/// 4 PM" is unusable beside a stamp that only says "3h ago" — the reader has to
/// do the arithmetic to find out whether 4 PM has passed.
///
/// The year is dropped inside the current one. It is noise on a feed whose
/// posts are almost all from the last fortnight, and it appears the moment a
/// post is old enough for it to matter.
String announcementStamp(DateTime t) {
  final now = DateTime.now();
  final pattern = t.year == now.year ? 'MMM d · h:mm a' : 'MMM d, y · h:mm a';
  return DateFormat(pattern).format(t);
}

/// The mark beside the publisher on every card in this feed.
///
/// Not a claim the app can get wrong: every announcement here comes from the
/// `announcements` collection, which only the admin portal writes — there is no
/// resident-authored path into this feed. So the seal is a statement about the
/// SOURCE of the collection, not a per-post verification the client would have
/// to check and could not.
/// Whether a post is under a day old — the card's "New" badge.
bool isFreshAnnouncement(Announcement a, {DateTime? now}) {
  final age = (now ?? DateTime.now()).difference(a.postedAt);
  return !age.isNegative && age < const Duration(hours: 24);
}

/// A small labelled status capsule in the card's top-right corner.
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({
    required this.label,
    required this.icon,
    required this.ink,
    required this.fill,
    required this.edge,
  });

  final String label;
  final IconData icon;
  final Color ink;
  final Color fill;
  final Color edge;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: edge.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: ink),
          const SizedBox(width: 3),
          Text(
            label,
            style: _t(
              size: 10,
              weight: FontWeight.w700,
              color: ink,
              letterSpacing: 0.2,
              height: 1.1,
            ),
          ),
        ],
      ),
    );
  }
}

class _OfficialSeal extends StatelessWidget {
  const _OfficialSeal();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Official notice',
      child: const Icon(
        PhosphorIconsFill.sealCheck,
        size: 13,
        color: AppColors.primary,
      ),
    );
  }
}

/// One announcement, as an elevated card — on every surface that shows one.
///
/// THE SINGLE DEFINITION. The dashboard used to render announcements on a white
/// sheet in a slate type ramp while the Announcements screen rendered them on
/// the app's dark surface, so the same notice arrived in two different palettes
/// depending on the route you took to it: white card / slate-900 title on the
/// homepage, `backgroundSecondary` / `textPrimary` one tap away. Two card
/// widgets meant two of every token — fill, border, title, body, timestamp,
/// badge — and nothing kept them in step.
///
/// Everything here reads from [AppColors] and the shared category table, so the
/// card is the app's theme by construction rather than by matching hex values.
///
/// ── LAYOUT ────────────────────────────────────────────────────────────────
/// Image first, then the identity row, then the caption, then the badges. The
/// media used to sit BELOW the body, which put it after the fold on any post
/// long enough to need truncating — so the photo attached to "Water
/// interruption, Phase 2" was invisible in the feed and only surfaced if you
/// opened the notice. Leading with it means the feed can be skimmed visually,
/// which is the whole reason a notice carries a photo.
///
/// ── THE CAPTION EXPANDS IN PLACE ──────────────────────────────────────────
/// Long bodies clamp to [collapsedMaxLines] with a Read More / Show Less
/// toggle. Expanding does NOT open the detail sheet: a reader who wants three
/// more lines should not be moved to another surface and made to find their
/// place again. Tapping the card still opens the sheet, which is where the
/// full post, its gallery and its metadata live.
///
/// The toggle only renders when it would do something — see [_needsToggle].
class AnnouncementCard extends StatefulWidget {
  const AnnouncementCard({
    super.key,
    required this.announcement,
    this.collapsedMaxLines = 3,
    this.showImage = true,
    this.mediaAspectRatio = 16 / 9,
  });

  final Announcement announcement;

  /// Lines of body copy before truncation. The dashboard runs tighter than the
  /// full Announcements list, where a reader has already committed to the feed.
  final int collapsedMaxLines;

  /// Whether an attached image is rendered inline.
  ///
  /// ON EVERYWHERE NOW, including the dashboard. It was off there, on the
  /// argument that the card competes with the map for a fixed slice of the
  /// viewport — true, but it made the picture the one thing a resident had to
  /// leave the home screen to see, which is backwards for the most glanceable
  /// part of a notice.
  final bool showImage;

  /// Shape of the media header.
  ///
  /// The dashboard passes a shorter box than the full feed's 16:9. Same image,
  /// same prominence at the top of the card, less of the panel spent on one
  /// post — which is the real constraint the dashboard has and the full-screen
  /// feed does not.
  final double mediaAspectRatio;

  @override
  State<AnnouncementCard> createState() => _AnnouncementCardState();
}

class _AnnouncementCardState extends State<AnnouncementCard> {
  bool _expanded = false;

  /// Whether the body is actually long enough to clamp.
  ///
  /// Measured with a real [TextPainter] against the caption's own style and
  /// the width it will be laid out in, rather than guessed from a character
  /// count. A character heuristic gets this wrong in both directions — it
  /// shows "Read More" on a three-word post containing one long URL, and hides
  /// it on a wrapped post of many short words — and a control that expands
  /// nothing is worse than no control.
  bool _needsToggle(String text, TextStyle style, double maxWidth) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      maxLines: widget.collapsedMaxLines,
      textDirection: Directionality.of(context),
    )..layout(maxWidth: maxWidth);
    return painter.didExceedMaxLines;
  }

  @override
  Widget build(BuildContext context) {
    final announcement = widget.announcement;
    final catColor = announcementCategoryColor(announcement.category);
    final hasImage =
        widget.showImage && (announcement.imageUrl ?? '').isNotEmpty;

    // Geometry, border and press feedback all come from [AppCard] — the same
    // container the notification tiles and settings groups render through, so
    // the three screens cannot drift apart again.
    //
    // Opens in place rather than pushing a route. Tapping a specific post used
    // to navigate to a differently titled screen and drop the reader at the top
    // of a feed, leaving them to find again the very card they had just tapped.
    return AppCard(
      onTap: () => showAnnouncementDetail(context, announcement),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // MEDIA FIRST. See the layout note on the class: below the body
          // it sat past the fold on any post long enough to truncate.
          if (hasImage) ...[
            _AnnouncementMedia(
              imageUrl: announcement.imageUrl!,
              caption: announcement.category,
              captionColor: catColor,
              stamp: announcementTimeAgo(announcement.postedAt),
              aspectRatio: widget.mediaAspectRatio,
            ),
            const SizedBox(height: 13),
          ],
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: catColor.withValues(alpha: 0.14),
                  // AppRadius.sm (12) — the shared lead-icon tile radius,
                  // same as SettingsRow and the notification tiles. A lead
                  // glyph is one object across all three screens.
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Icon(
                  announcementCategoryIcon(announcement.category),
                  size: 19,
                  // Ink on the 14% tile behind it. This glyph is the only
                  // thing distinguishing a Security notice from a Maintenance
                  // one at a glance, so it is meaningful content and owes the
                  // 3:1 that non-text UI is held to. In the fill hue three of
                  // the four categories missed it — Maintenance at 1.93:1,
                  // Event 2.82:1, General 2.40:1, with only Security clearing
                  // at 3.89:1. The inks run 6.09:1 to 6.55:1 on that wash.
                  color: AppColors.inkFor(catColor),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      announcement.title,
                      style: _t(
                        size: 15.5,
                        weight: FontWeight.w700,
                        color: AppColors.textPrimary,
                        letterSpacing: -0.2,
                        height: 1.25,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 5),
                    // ── THE BYLINE ────────────────────────────────────────
                    //
                    // Publisher, then a verified seal, then the date and time
                    // it was posted. This was the author's name and a relative
                    // age — "HOA Admin · 2h ago" — set in one muted step of
                    // the ramp, which is what a comment looks like, not what
                    // an official notice looks like.
                    //
                    // Two things changed and each does specific work:
                    //
                    //   • THE SEAL. Every post in this feed comes from the
                    //     estate's own portal, and nothing on the card said so.
                    //     A resident glancing at a water-interruption notice
                    //     has to be able to tell it apart from a screenshot
                    //     forwarded in a group chat, and a mark beside the
                    //     publisher is how every news surface does that.
                    //   • THE ACTUAL TIME. "2h ago" is the right unit for
                    //     skimming and the wrong one for an announcement that
                    //     names a window — "the water goes off at 10" is
                    //     unusable next to a stamp that only says how long ago
                    //     it was written. The relative age still rides on the
                    //     image; the byline carries the real one.
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            announcement.author.isEmpty
                                ? 'Monticello Villas HOA'
                                : announcement.author,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: _t(
                              size: 11.5,
                              // One step heavier than the timestamp beside it.
                              // The publisher is the claim being made; the
                              // stamp is a detail about it.
                              weight: FontWeight.w600,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        const _OfficialSeal(),
                        Text('  ·  ',
                            style: _t(size: 11.5, color: AppColors.textMuted)),
                        // Flexible as well: with a status badge in the corner
                        // the column is narrower, and a fixed-width stamp
                        // overflowed the row on small phones.
                        Flexible(
                          child: Text(
                            announcementStamp(announcement.postedAt),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: _t(size: 11.5, color: AppColors.textMuted),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              // A LABELLED BADGE, not the bare pin glyph this replaces.
              //
              // At 14px a pushpin silhouette is close enough to a location pin
              // or a paperclip to be read as either, and it was tinted by
              // CATEGORY — so the one mark meant to say "this is pinned"
              // changed colour post to post and blended into the category
              // system around it. A word cannot be misread, and it earns the
              // width now that pinned posts sort to the top and a reader needs
              // to know WHY the newest notice is not first.
              //
              // "New" joins it for anything posted in the last day: the feed
              // is sorted pinned-first, so recency is otherwise only legible
              // by reading every timestamp.
              if (announcement.pinned || isFreshAnnouncement(announcement))
                Padding(
                  padding: const EdgeInsets.only(left: 8, top: 1),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (announcement.pinned)
                        const _StatusBadge(
                          label: 'Pinned',
                          icon: PhosphorIconsFill.pushPin,
                          ink: _pinnedInk,
                          fill: AppColors.primarySoft,
                          edge: AppColors.primary,
                        ),
                      if (announcement.pinned &&
                          isFreshAnnouncement(announcement))
                        const SizedBox(height: 4),
                      if (isFreshAnnouncement(announcement))
                        const _StatusBadge(
                          label: 'New',
                          icon: PhosphorIconsFill.sparkle,
                          ink: AppColors.onAccent,
                          fill: AppColors.accentPrimary,
                          edge: AppColors.accentPrimary,
                        ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          // The caption, and its toggle when one is warranted.
          //
          // LayoutBuilder because `_needsToggle` has to measure against the
          // real width the text will occupy — the card is used at two
          // different widths (dashboard panel and full-width feed), so a
          // fixed number here would be wrong on one of them.
          LayoutBuilder(
            builder: (context, constraints) {
              final bodyStyle = _t(
                size: 13.5,
                color: AppColors.textSecondary,
                height: 1.5,
              );
              final overflows = _needsToggle(
                announcement.body,
                bodyStyle,
                constraints.maxWidth,
              );

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AnimatedSize(
                    duration: const Duration(milliseconds: 180),
                    curve: Curves.easeOut,
                    alignment: Alignment.topCenter,
                    child: Text(
                      announcement.body,
                      maxLines: _expanded ? null : widget.collapsedMaxLines,
                      overflow: _expanded
                          ? TextOverflow.visible
                          : TextOverflow.ellipsis,
                      style: bodyStyle,
                    ),
                  ),
                  if (overflows) ...[
                    const SizedBox(height: 6),
                    // A real button, not the old decorative "Read more"
                    // label. That one had no onTap at all — it looked like
                    // a control and did nothing but ride the card's ripple
                    // to the detail sheet.
                    //
                    // Its own GestureDetector inside the card's InkWell is
                    // deliberate: the toggle must NOT open the sheet, so it
                    // has to swallow the tap before the card sees it.
                    GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => setState(() => _expanded = !_expanded),
                      child: Padding(
                        // Vertical padding is the tap target — the label is
                        // only ~14px tall, well under the 44px minimum, and
                        // padding is what makes it reachable without
                        // visually enlarging the control.
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              _expanded ? 'Show Less' : 'Read More',
                              style: _t(
                                size: 12.5,
                                weight: FontWeight.w700,
                                color: AppColors.primary,
                                height: 1.1,
                              ),
                            ),
                            const SizedBox(width: 3),
                            Icon(
                              _expanded
                                  ? PhosphorIconsBold.caretUp
                                  : PhosphorIconsBold.caretDown,
                              size: 12,
                              color: AppColors.primary,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
          const SizedBox(height: 12),
          AnnouncementCategoryBadge(
              category: announcement.category, dense: true),
        ],
      ),
    );
  }
}

/// The announcement card's embedded media block.
///
/// A framed container rather than a bare image, which is the difference
/// between an attachment and a designed part of the card:
///
///   • FIXED 16:9 BOX. The aspect ratio is reserved before the bytes arrive,
///     so a feed of image posts does not reflow line by line as each one
///     decodes — the single most visible jank in a scrolling list of remote
///     images, and the reason the placeholder below fills the same box rather
///     than collapsing to zero height.
///   • SUBTLE SCRIM. A bottom-up gradient, not a flat wash: it only darkens
///     the strip the caption sits on, so a photo whose lower third is already
///     dark does not get muddied, and light captions stay legible on a photo
///     whose content is unknown at build time.
///   • CAPTION IN THE FRAME. Category and age ride ON the image rather than
///     under it. Below the image they became a third metadata row competing
///     with the badge row at the card's foot; on the image they read as the
///     photo's own label.
///
/// Corners are [AppRadius.xxs] to match the card, and the ClipRRect is what
/// actually enforces it — a decorated Container alone will let a child image
/// paint square corners straight over the curve.
class _AnnouncementMedia extends StatelessWidget {
  const _AnnouncementMedia({
    required this.imageUrl,
    required this.caption,
    required this.captionColor,
    required this.stamp,
    required this.aspectRatio,
  });

  final String imageUrl;
  final String caption;
  final Color captionColor;
  final String stamp;
  final double aspectRatio;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: AppCard.borderRadius,
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: Stack(
          fit: StackFit.expand,
          children: [
            // ── SKELETON, THEN FADE ─────────────────────────────────────────
            //
            // This was `Image.network` with a spinner in the middle of a grey
            // box, and the image snapped in at full opacity the moment it
            // decoded. Two problems in a feed:
            //
            //   • A SPINNER IS AN ANSWER TO THE WRONG QUESTION. It says "the
            //     app is working", which the resident already assumes; it does
            //     not say what is arriving. A block pulsing in the shape of the
            //     picture does, and it is the same `animate-pulse` placeholder
            //     the rest of the app already uses while it waits.
            //   • THE SNAP. Six cards decoding at their own pace, each popping
            //     from grey to photo, reads as flicker down the length of a
            //     scroll. A 300ms fade makes each arrival a settle instead.
            //
            // [CachedNetworkImage] also brings disk caching, which the raw
            // `Image.network` did not have: scrolling a notice back into view,
            // or reopening the feed, no longer re-fetches from the network.
            CachedNetworkImage(
              imageUrl: imageUrl,
              fit: BoxFit.cover,
              // Decoded near the width it is drawn at rather than at full
              // resolution. A feed of 16:9 photos is the app's heaviest
              // decode, and these are attachments shot on phones.
              memCacheWidth: 720,
              fadeInDuration: const Duration(milliseconds: 300),
              fadeInCurve: Curves.easeOut,
              // Holds the 16:9 box while the image streams in, so the card's
              // height is final from first paint.
              placeholder: (_, __) => const Skeleton(
                label: 'Loading image',
                child: SkeletonBlock(
                  width: double.infinity,
                  height: double.infinity,
                  radius: 0,
                ),
              ),
              // A broken attachment must not blank the notice — the text is
              // the part that matters.
              errorWidget: (_, __, ___) => const ColoredBox(
                color: AppColors.backgroundElevated,
                child: Center(
                  child: Icon(PhosphorIconsFill.imageBroken,
                      color: AppColors.textMuted, size: 26),
                ),
              ),
            ),

            // Scrim. `IgnorePointer` so it never eats the card's tap.
            const IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.bottomCenter,
                    end: Alignment.topCenter,
                    colors: [Color(0x8C000000), Color(0x00000000)],
                    stops: [0.0, 0.55],
                  ),
                ),
              ),
            ),

            Positioned(
              left: 10,
              right: 10,
              bottom: 8,
              child: IgnorePointer(
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 7, vertical: 3),
                      decoration: BoxDecoration(
                        // The category's INK, opaque enough to hold its hue
                        // against an arbitrary photo behind it.
                        //
                        // This is the inverse of the badge problem and the
                        // only place white type sits on a solid category
                        // fill. At 10px it needs 4.5:1 and no category paid
                        // it: bounded across a white and a black photo behind
                        // the 8% that shows through, Maintenance measured
                        // 2.02:1, General 2.57:1, Event 3.01:1, and even
                        // Security only 4.43:1. Dropping the plate to the ink
                        // keeps white as the label and lands every category
                        // between 5.93:1 and 6.99:1.
                        color: AppColors.inkFor(captionColor)
                            .withValues(alpha: 0.92),
                        borderRadius: AppCard.borderRadius,
                      ),
                      child: Text(
                        caption,
                        style: _t(
                          size: 10,
                          weight: FontWeight.w700,
                          color: Colors.white,
                          letterSpacing: 0.2,
                          height: 1.1,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      stamp,
                      style: _t(
                        size: 10.5,
                        weight: FontWeight.w600,
                        // Straight white on the scrim, not a theme token: this
                        // text sits on a photograph, so it must not follow a
                        // surface colour that has nothing to do with what is
                        // behind it.
                        color: Colors.white,
                        height: 1.1,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Horizontal category filter for the announcement feed.
///
/// One bar, both screens. The dashboard used a four-slot icon-tab row and the
/// Announcements screen used pill chips, so the same operation looked like two
/// different controls — and each hard-coded its own category list, which is how
/// they came to disagree with the dashboard's published vocabulary.
///
/// Options come from [kAnnouncementCategories], and the selected tint is the
/// category's own colour, so the chip you press is the colour of the badges it
/// filters to.
class AnnouncementFilterBar extends StatelessWidget {
  const AnnouncementFilterBar({
    super.key,
    required this.value,
    required this.onChanged,
    this.padding = const EdgeInsets.symmetric(horizontal: 16),
  });

  /// Selected filter — [allAnnouncements] or one of
  /// [kAnnouncementCategories].
  final String value;
  final ValueChanged<String> onChanged;
  final EdgeInsetsGeometry padding;

  /// The unfiltered option. Not a category — no post is ever stored as "All".
  static const String allAnnouncements = 'All';

  static const List<String> options = [
    allAnnouncements,
    ...kAnnouncementCategories,
  ];

  /// True when [announcement] belongs under [filter], comparing on the
  /// canonical key so a legacy "Utilities" post files under Maintenance rather
  /// than vanishing from every tab.
  static bool matches(String filter, Announcement announcement) {
    if (filter == allAnnouncements) return true;
    return announcementCategoryKey(announcement.category) ==
        announcementCategoryKey(filter);
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 38,
      child: ListView.separated(
        padding: padding,
        scrollDirection: Axis.horizontal,
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final option = options[i];
          final selected = option == value;
          final isAll = option == allAnnouncements;
          // "All" has no category colour of its own, so it takes the app's
          // accent — the same tint every other selected control on the shell
          // uses.
          final tint =
              isAll ? AppColors.primary : announcementCategoryColor(option);

          return GestureDetector(
            onTap: () => onChanged(option),
            behavior: HitTestBehavior.opaque,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: selected
                    ? tint.withValues(alpha: 0.16)
                    : AppColors.backgroundSecondary,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                border: Border.all(
                  color: selected
                      ? tint.withValues(alpha: 0.55)
                      : AppColors.innerStroke,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    isAll
                        ? PhosphorIconsFill.squaresFour
                        : announcementCategoryIcon(option),
                    size: 13,
                    color: selected ? tint : AppColors.textSecondary,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    option,
                    style: _t(
                      size: 12.5,
                      weight: selected ? FontWeight.w700 : FontWeight.w600,
                      color: selected ? tint : AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

TextStyle _t({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.textPrimary,
  double letterSpacing = 0,
  double height = 1.35,
}) {
  return sfPro(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
  );
}
