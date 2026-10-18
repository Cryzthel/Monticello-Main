import 'dart:ui';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/widgets/modern_close_button.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/skeleton.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/media/widgets/media_viewer.dart';

/// The category vocabulary the admin dashboard actually publishes.
///
/// Mirrors `ANNOUNCEMENT_CATEGORIES` in
/// `web-portal/src/shared/lib/announcements.js`, which is the list the
/// composer's tag picker is built from and the value written to the document's
/// `type` field. This app previously filtered on "Utilities" and "Events" —
/// neither of which any post can carry — so those tabs were guaranteed to
/// return an empty feed no matter what the HOA had published.
const List<String> kAnnouncementCategories = [
  'General',
  'Security',
  'Maintenance',
  'Event',
];

/// Folds a stored category onto the canonical vocabulary.
///
/// Records written before the dashboard settled on this list still carry
/// "Utilities" and "Events". Normalising here rather than at each call site is
/// what lets an old post keep its colour, sort into the right filter, and read
/// under the label a resident recognises — instead of silently falling through
/// to "General" and disappearing from the tab it belongs in.
String announcementCategoryKey(String category) {
  switch (category.trim().toLowerCase()) {
    case 'security':
      return 'Security';
    case 'maintenance':
    case 'utilities': // legacy
      return 'Maintenance';
    case 'event':
    case 'events': // legacy
      return 'Event';
    default:
      return 'General';
  }
}

/// Category identity for announcements — colour + glyph, in one place.
///
/// The dashboard feed, the Announcements screen and this modal each used to
/// carry a private copy of this switch, which is how a "Security" post could
/// read danger-red on one surface and info-blue on another. One table, three
/// surfaces — a badge must not change colour when you tap it.
///
/// The tones match `CATEGORY_TONES` on the web side (General → info,
/// Security → danger, Maintenance → warning, Event → brand), so a notice is
/// the same colour on a resident's phone as in the dispatcher's composer.
Color announcementCategoryColor(String category) {
  switch (announcementCategoryKey(category)) {
    case 'Security':
      return AppColors.danger;
    case 'Maintenance':
      return AppColors.warning;
    case 'Event':
      return AppColors.ctaGreen;
    default:
      return AppColors.info;
  }
}

IconData announcementCategoryIcon(String category) {
  switch (announcementCategoryKey(category)) {
    case 'Security':
      return PhosphorIconsFill.shield;
    case 'Maintenance':
      return PhosphorIconsFill.wrench;
    case 'Event':
      return PhosphorIconsFill.confetti;
    default:
      return PhosphorIconsFill.info;
  }
}

/// The category pill, at the contrast a phone screen outdoors actually needs.
///
/// A 10%-alpha fill behind a saturated label is comfortable indoors and
/// invisible in sunlight, which is where a security notice is most likely to
/// be read. This lifts the fill and adds a hairline of the same hue so the
/// pill keeps a defined edge on every surface it appears on.
///
/// THE ONLY category pill in the app. The homepage feed used to draw its own
/// at a 14% fill and 9.5pt type while the Announcements list drew this one at
/// 20% and 10.5pt, so the same notice changed weight and contrast depending on
/// which screen you met it on. Anything showing a category renders this.
class AnnouncementCategoryBadge extends StatelessWidget {
  const AnnouncementCategoryBadge({
    super.key,
    required this.category,
    this.dense = false,
  });

  final String category;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final color = announcementCategoryColor(category);
    // This badge paints the heaviest wash in the app — 20% of the category
    // hue, with the label in that same hue on top of it. Measured, the four
    // categories ran 1.85:1 (Maintenance) to 3.53:1 (Security). The inks run
    // 5.71:1 to 6.18:1 on the identical wash, so the badge keeps its colour
    // and gains its legibility.
    final ink = AppColors.inkFor(color);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 9 : 11,
        vertical: dense ? 4 : 5.5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.20),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(announcementCategoryIcon(category),
              size: dense ? 11 : 12.5, color: ink),
          SizedBox(width: dense ? 4 : 5),
          Text(
            // The canonical label, not the raw stored string — a legacy
            // "Utilities" post reads "Maintenance", which is the tab it now
            // files under and the word the dashboard publishes.
            announcementCategoryKey(category),
            style: sfPro(
              fontSize: dense ? 10.5 : 11.5,
              fontWeight: FontWeight.w700,
              color: ink,
              letterSpacing: 0.1,
            ),
          ),
        ],
      ),
    );
  }
}

/// Opens an announcement as a focus modal over a blurred backdrop.
///
/// A lightbox rather than a bottom sheet, and rather than a route push. The
/// dashboard card used to navigate to the whole Announcements screen, which
/// cost the reader their scroll position and dropped them at the top of a feed
/// to hunt for the post they had just tapped. A modal keeps the feed exactly
/// where it was underneath, so dismissing returns you to the same pixel.
Future<void> showAnnouncementDetail(
  BuildContext context,
  Announcement announcement,
) {
  return showFocusModal(
    context,
    barrierLabel: 'Close announcement',
    builder: (_) => _AnnouncementFocusModal(announcement: announcement),
  );
}

/// The app's detail lightbox: blurred backdrop, one card, a close control at
/// the top and a Close button at the bottom. Announcements and notifications
/// both open through it, so "tap a card, read the whole thing" looks and
/// behaves the same everywhere.
///
/// `showGeneralDialog`, not `showDialog`, because the blur has to be built into
/// the barrier itself — `showDialog`'s barrier is a flat scrim, and layering a
/// BackdropFilter above it blurs the dialog too rather than the page behind it.
Future<void> showFocusModal(
  BuildContext context, {
  required String barrierLabel,
  required WidgetBuilder builder,
}) {
  HapticFeedback.selectionClick();
  final reduceMotion = MediaQuery.disableAnimationsOf(context);
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: barrierLabel,
    barrierColor: Colors.transparent, // the blur layer paints its own scrim
    transitionDuration: Duration(milliseconds: reduceMotion ? 0 : 220),
    pageBuilder: (context, __, ___) => builder(context),
    transitionBuilder: (context, animation, _, child) {
      final curved =
          CurvedAnimation(parent: animation, curve: Curves.easeOutCubic);
      return FadeTransition(
        opacity: curved,
        // A short rise rather than a scale: scaling a full-width card reads as
        // the whole page zooming, which fights the backdrop staying still.
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, 0.03),
            end: Offset.zero,
          ).animate(curved),
          child: child,
        ),
      );
    },
  );
}

/// The frame every focus modal draws: backdrop, capped card, [header] at the
/// top, [body] scrolling beneath it, and a full-width Close button.
class FocusModalFrame extends StatelessWidget {
  const FocusModalFrame({
    super.key,
    required this.header,
    required this.body,
  });

  final Widget header;
  final Widget body;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);

    return Stack(
      children: [
        // ── Backdrop: blur + 50% scrim, dismissing on tap ──────────────────
        Positioned.fill(
          child: GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
              child: ColoredBox(
                color: Colors.black.withValues(alpha: 0.5),
                child: const SizedBox.expand(),
              ),
            ),
          ),
        ),

        // ── The card ───────────────────────────────────────────────────────
        Center(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              16,
              media.padding.top + 24,
              16,
              media.padding.bottom + 24,
            ),
            child: ConstrainedBox(
              // Capped rather than sized: a one-line notice produces a short
              // card, a long one grows to 88% of the viewport and scrolls
              // inside. A fixed height would letterbox the short case.
              constraints: BoxConstraints(
                maxHeight: media.size.height * 0.88,
                maxWidth: 560,
              ),
              child: GestureDetector(
                // Swallows taps so a press inside the card never reaches the
                // dismiss handler on the backdrop behind it.
                onTap: () {},
                child: Material(
                  color: AppColors.backgroundSecondary,
                  borderRadius: BorderRadius.circular(AppRadius.xl),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      header,
                      Flexible(child: body),
                      // The intuitive way out: a labelled button where the
                      // thumb already is, as well as the X at the top.
                      Padding(
                        padding: const EdgeInsets.fromLTRB(18, 4, 18, 18),
                        child: SizedBox(
                          width: double.infinity,
                          height: 46,
                          child: FilledButton(
                            onPressed: () => Navigator.of(context).pop(),
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.surface,
                              foregroundColor: AppColors.textPrimary,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(AppRadius.md),
                              ),
                            ),
                            child: Text(
                              'Close',
                              style: sfPro(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _AnnouncementFocusModal extends StatelessWidget {
  const _AnnouncementFocusModal({required this.announcement});

  final Announcement announcement;

  /// The model carries a single `imageUrl`, but the gallery is written against
  /// a list so a post with several attachments needs no layout work here — only
  /// a wider field on the model and the writer that populates it.
  List<String> get _images {
    final url = announcement.imageUrl ?? '';
    return url.isEmpty ? const [] : [url];
  }

  @override
  Widget build(BuildContext context) {
    return FocusModalFrame(header: _header(context), body: _body(context));
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 14, 10, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Row(
              children: [
                AnnouncementCategoryBadge(category: announcement.category),
                if (announcement.pinned) ...[
                  const SizedBox(width: 8),
                  Icon(PhosphorIconsFill.pushPin,
                      size: 14,
                      color: announcementCategoryColor(announcement.category)),
                ],
              ],
            ),
          ),
          // The close control is the only guaranteed way out on a device with
          // gesture navigation and no visible back affordance. The 44px target
          // and the pop are both inside ModernCloseButton now.
          const ModernCloseButton(semanticLabel: 'Close announcement'),
        ],
      ),
    );
  }

  Widget _body(BuildContext context) {
    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsets.fromLTRB(18, 0, 18, 20),
      children: [
        Text(
          announcement.title,
          style: sfPro(
            fontSize: 21,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
            letterSpacing: -0.4,
            height: 1.25,
          ),
        ),
        const SizedBox(height: 12),

        // Publisher + absolute timestamp. The feed card shows a relative time
        // because that is what scanning needs; the opened post shows the exact
        // one, because that is what someone quoting a notice back to the HOA
        // office needs.
        Row(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.surface,
              ),
              child: const Icon(PhosphorIconsFill.user,
                  size: 14, color: AppColors.textMuted),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    announcement.author.isEmpty
                        ? 'Monticello Villas HOA'
                        : announcement.author,
                    style: sfPro(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  Text(
                    DateFormat("MMM d, yyyy 'at' h:mm a")
                        .format(announcement.postedAt),
                    style: sfPro(fontSize: 11.5, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
          ],
        ),

        if (_images.isNotEmpty) ...[
          const SizedBox(height: 16),
          _AttachmentGallery(urls: _images),
        ],

        const SizedBox(height: 18),
        // No maxLines. The feed clamps the body to three lines precisely so
        // that opening the post is what shows the rest of it.
        SelectableText(
          announcement.body,
          style: sfPro(
            fontSize: 14.5,
            color: AppColors.textSecondary,
            height: 1.6,
          ),
        ),
      ],
    );
  }
}

/// Attachment grid.
///
/// One image goes full width; two or more tile into a 2-column grid, which is
/// the arrangement a post with mixed portrait and landscape shots survives —
/// a single row would crop everything to the shortest.
class _AttachmentGallery extends StatelessWidget {
  const _AttachmentGallery({required this.urls});

  final List<String> urls;

  @override
  Widget build(BuildContext context) {
    if (urls.length == 1) {
      return _tile(context, urls.first, aspect: 16 / 10);
    }
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: urls.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
      ),
      itemBuilder: (_, i) => _tile(context, urls[i]),
    );
  }

  Widget _tile(BuildContext context, String url, {double aspect = 1}) {
    return ClipRRect(
      // Matches the feed card's media block — these are the same photographs
      // the card previews, so they cannot round differently on the two screens.
      //
      // The SHEET's own surface stays at AppRadius.xl deliberately: the spec's
      // 1.5px rule names "card borders, image containers, and inner wrappers",
      // and a modal is none of the three. A near-square bottom sheet reads as
      // an untreated dialog rather than a considered one.
      borderRadius: AppCard.borderRadius,
      child: AspectRatio(
        aspectRatio: aspect,
        child: GestureDetector(
          // Full-resolution view reuses the app's existing photo viewer, so
          // pinch-zoom and the watermark behave exactly as they do on evidence
          // attached to an incident.
          onTap: () => openPhotoGallery(context, urls, initialIndex: urls.indexOf(url)),
          child: CachedNetworkImage(
            imageUrl: url,
            fit: BoxFit.cover,
            // The same pulsing block the feed card shows, for the same
            // photographs — a reader who taps a card mid-load must not watch
            // the placeholder change shape on the way to the sheet.
            fadeInDuration: const Duration(milliseconds: 300),
            fadeInCurve: Curves.easeOut,
            placeholder: (_, __) => const Skeleton(
              label: 'Loading image',
              child: SkeletonBlock(
                width: double.infinity,
                height: double.infinity,
                radius: 0,
              ),
            ),
            // A broken attachment must not blank the notice — the text is the
            // part that matters.
            errorWidget: (_, __, ___) => const ColoredBox(
              color: AppColors.surface,
              child: Center(
                child: Icon(PhosphorIconsFill.imageBroken,
                    color: AppColors.textMuted, size: 24),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
