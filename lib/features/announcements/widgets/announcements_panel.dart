import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/inline_action_link.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcement_card.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/core/widgets/feed_skeletons.dart';
import 'package:monticello_villas_app/core/widgets/skeleton.dart';

/// The dashboard's announcements sheet.
///
/// A Life360-style panel: the subdivision map fills the body behind it, and
/// this sheet floats over that map and drags upward until its top edge meets
/// the homepage header. Rounded top corners and an upward shadow are what make
/// the boundary read as a sheet lying ON the map rather than a pane docked
/// beside it.
///
/// NO CATEGORY FILTER. The dashboard shows one chronological stream — newest
/// first, straight from the store's `publishedAt DESC` ordering. Filtering
/// still exists on the full Announcements screen, where a reader has committed
/// to browsing; on a dashboard it asked people to choose a lane before they had
/// seen what was in any of them.
///
/// EVERYTHING IS ONE SCROLLABLE — grab handle, heading and feed alike.
///
/// That is the whole ergonomics of a draggable sheet. A header built outside
/// the scroll view stays visible but swallows every drag that starts on it, so
/// the one target a thumb naturally reaches for — the handle at the top of the
/// sheet — becomes the one place the sheet cannot be dragged from.
///
/// The heading is a plain sliver rather than a PINNED one, which was the first
/// thing tried here. A pinned [SliverPersistentHeader] inside a
/// [DraggableScrollableSheet] produces invalid sliver geometry as the sheet
/// resizes — "layoutExtent exceeds paintExtent" — because the header is laid
/// out against a viewport whose extent is still animating. Keeping the heading
/// in the scroll flow costs a label that scrolls away, and buys a sheet that
/// does not assert on its own open animation.
class AnnouncementsPanel extends StatelessWidget {
  const AnnouncementsPanel({
    super.key,
    required this.items,
    required this.onSeeAll,
    required this.scrollController,
    this.horizontalPadding = 14,
    this.loading = false,
  });

  /// True until the first announcements snapshot lands: cards pulse in place
  /// of the feed instead of the empty state flashing first.
  final bool loading;

  /// The feed, newest first. Not filtered — see the class doc.
  final List<Announcement> items;
  final VoidCallback onSeeAll;

  /// Supplied by the enclosing [DraggableScrollableSheet].
  ///
  /// Using any other controller is what makes a sheet fight the drag instead of
  /// continuing it: the sheet listens to THIS controller to decide when a
  /// downward drag should shrink the panel rather than scroll its contents.
  final ScrollController scrollController;

  final double horizontalPadding;

  /// Corner radius where the sheet meets the map — `rounded-t-3xl`.
  static const double topRadius = AppRadius.xl;

  @override
  Widget build(BuildContext context) {
    final radius =
        const BorderRadius.vertical(top: Radius.circular(topRadius));

    return DecoratedBox(
      decoration: BoxDecoration(
        // Opaque, not the glass fill this panel used when it sat on the shell
        // gradient. It now covers a live map: at 5% alpha the heading would be
        // read against whatever tile happened to be underneath it, which is
        // different on every scroll and legible on none of them.
        //
        // `background` rather than `backgroundSecondary` for the surface, so the
        // notice cards keep the same figure/ground relationship they have on
        // the Announcements screen — solid `backgroundSecondary` cards lifted
        // off the darkest fill.
        color: AppColors.background,
        borderRadius: radius,
        border: Border.all(color: AppColors.glassBorderLight),
        boxShadow: const [
          // Cast UPWARD. This is the one surface in the app lit from below,
          // because the light it needs to catch is the edge where it overlaps
          // the map — a downward shadow here would fall behind the sheet and
          // be invisible.
          BoxShadow(
            color: AppColors.glassShadow,
            blurRadius: 24,
            offset: Offset(0, -6),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: ScrollConfiguration(
          // Two pieces of default chrome removed, both because they paint
          // against a rounded edge they know nothing about: the platform
          // scrollbar and Android's overscroll glow, a hard-edged arc that
          // would smear across the sheet's top corners on every over-drag.
          behavior: ScrollConfiguration.of(context).copyWith(
            scrollbars: false,
            overscroll: false,
          ),
          child: CustomScrollView(
            controller: scrollController,
            // Always scrollable, so the sheet can still be dragged shut when a
            // single notice does not fill it. Without this the gesture dies on
            // a short feed and the panel becomes stuck open.
            physics: const BouncingScrollPhysics(
              parent: AlwaysScrollableScrollPhysics(),
            ),
            slivers: [
              SliverToBoxAdapter(
                child: _Heading(
                  onSeeAll: onSeeAll,
                  horizontalPadding: horizontalPadding,
                ),
              ),
              if (loading && items.isEmpty)
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(
                      horizontalPadding, 4, horizontalPadding, 0),
                  sliver: const SliverToBoxAdapter(
                    child: Skeleton(
                      label: 'Loading announcements',
                      child: Column(
                        children: [
                          AnnouncementCardSkeleton(mediaAspectRatio: 2 / 1),
                          SizedBox(height: 12),
                          AnnouncementCardSkeleton(),
                        ],
                      ),
                    ),
                  ),
                )
              else if (items.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: _empty(),
                )
              else
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(
                    horizontalPadding,
                    4,
                    horizontalPadding,
                    // Clears the nav bar's panic button, which overhangs the
                    // top of the bar and would otherwise sit on the last card.
                    AppSpacing.navClearance,
                  ),
                  sliver: SliverList.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => RepaintBoundary(
                      child: AnnouncementCard(
                        announcement: items[i],
                        // Tighter than the full Announcements screen: this feed
                        // shares the viewport with the map, and a dashboard
                        // card running four lines deep pushes the next notice
                        // off the fold entirely.
                        collapsedMaxLines: 2,
                        // ON. The dashboard used to suppress the image, so the
                        // one thing a resident could take in at a glance was
                        // the one thing they had to open another screen to see.
                        showImage: true,
                        // 2:1 rather than the full feed's 16:9. This panel is a
                        // draggable sheet that opens at 28% of the viewport; a
                        // 16:9 header there fills the visible area with picture
                        // and leaves the headline below the fold, which defeats
                        // the point of showing it.
                        mediaAspectRatio: 2 / 1,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _empty() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: 0.08),
              ),
              child: const Icon(PhosphorIconsFill.megaphone,
                  size: 24, color: AppColors.primary),
            ),
            const SizedBox(height: 12),
            // One message. With no category filter there is only one way to
            // reach an empty feed — nothing has been published — so the
            // "nothing in this category" branch describes a state this panel
            // can no longer be in.
            Text(
              'No announcements yet',
              style: _t(size: 14, weight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'New community posts will appear here automatically.',
              textAlign: TextAlign.center,
              style: _t(
                  size: 12.5, color: AppColors.onGlassSecondary, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}

/// Grab handle + section label + "See all", riding at the top of the feed.
class _Heading extends StatelessWidget {
  const _Heading({
    required this.onSeeAll,
    required this.horizontalPadding,
  });

  final VoidCallback onSeeAll;
  final double horizontalPadding;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.background,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // The affordance that says "this panel moves". A sheet with no handle
          // is a sheet most people never discover they can drag.
          const Padding(
            padding: EdgeInsets.only(top: 10, bottom: 8),
            child: _GrabHandle(),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(horizontalPadding, 0, 8, 8),
            child: Row(
              children: [
                const Icon(PhosphorIconsFill.megaphone,
                    size: 17, color: AppColors.onGlassSecondary),
                const SizedBox(width: 8),
                Text(
                  'Announcements',
                  style: _t(
                    size: 16,
                    weight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
                ),
                const Spacer(),
                // The padded tap area now lives inside InlineActionLink, so
                // this and the "Read more" on every card below it are the same
                // type size and the same glyph by construction.
                InlineActionLink(label: 'See all', onTap: onSeeAll),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GrabHandle extends StatelessWidget {
  const _GrabHandle();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 40,
      height: 4,
      decoration: BoxDecoration(
        color: AppColors.textMuted,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
    );
  }
}

TextStyle _t({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.onGlassPrimary,
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
