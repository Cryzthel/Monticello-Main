import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';
import 'package:monticello_villas_app/core/widgets/skeleton.dart';

/// Placeholders for every data screen that has no skeleton of its own.
///
/// Same rule as HistoryFeedSkeleton and SettingsSkeleton: each block sits where
/// the real content will, inside the real card frame, so nothing moves when
/// the data lands. All share [Skeleton]'s single pulse.

/// The card frame every feed card in the app draws.
class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      borderColor: AppColors.borderNeutralSoft,
      borderWidth: AppStroke.hairline,
      shadows: AppShadows.sm,
      cornerRadius: AppRadius.lg,
      child: child,
    );
  }
}

/// One announcement card: optional media header, category chip and time,
/// headline, two body lines.
class AnnouncementCardSkeleton extends StatelessWidget {
  const AnnouncementCardSkeleton({super.key, this.mediaAspectRatio});

  /// Null draws no media block.
  final double? mediaAspectRatio;

  @override
  Widget build(BuildContext context) {
    return _SkeletonCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (mediaAspectRatio != null) ...[
            AspectRatio(
              aspectRatio: mediaAspectRatio!,
              child: const SkeletonBlock(radius: AppRadius.md),
            ),
            const SizedBox(height: 14),
          ],
          const Row(
            children: [
              SkeletonBlock(width: 72, height: 20, radius: AppRadius.pill),
              Spacer(),
              SkeletonBlock(width: 44, height: 9, radius: 4),
            ],
          ),
          const SizedBox(height: 12),
          const SkeletonBlock.line(widthFactor: 0.8, height: 13),
          const SizedBox(height: 10),
          const SkeletonBlock.line(widthFactor: 1, height: 10),
          const SizedBox(height: 6),
          const SkeletonBlock.line(widthFactor: 0.62, height: 10),
        ],
      ),
    );
  }
}

/// The Announcements screen's list while the first snapshot is in flight.
class AnnouncementFeedSkeleton extends StatelessWidget {
  const AnnouncementFeedSkeleton({
    super.key,
    this.cards = 3,
    this.padding = const EdgeInsets.fromLTRB(16, 4, 16, 80),
    this.mediaAspectRatio = 16 / 9,
  });

  final int cards;
  final EdgeInsets padding;
  final double? mediaAspectRatio;

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      label: 'Loading announcements',
      child: ListView.separated(
        physics: const NeverScrollableScrollPhysics(),
        padding: padding,
        itemCount: cards,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, i) => AnnouncementCardSkeleton(
          // Only the first card carries media: a feed of three picture
          // placeholders is a wall of grey, and real feeds are mixed.
          mediaAspectRatio: i == 0 ? mediaAspectRatio : null,
        ),
      ),
    );
  }
}

/// The Notifications list: a section header, then icon-and-two-line rows.
class NotificationListSkeleton extends StatelessWidget {
  const NotificationListSkeleton({super.key, this.rows = 6});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      label: 'Loading notifications',
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 80),
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(4, 12, 4, 10),
            child: SkeletonBlock(width: 64, height: 10, radius: 4),
          ),
          for (var i = 0; i < rows; i++)
            const Padding(
              padding: EdgeInsets.only(bottom: 10),
              child: _SkeletonCard(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonBlock.circle(40),
                    SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(height: 3),
                          SkeletonBlock.line(widthFactor: 0.7, height: 12),
                          SizedBox(height: 8),
                          SkeletonBlock.line(widthFactor: 0.95, height: 10),
                          SizedBox(height: 8),
                          SkeletonBlock(width: 52, height: 9, radius: 4),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Your Property: the LOCATION figure tiles, then the RESIDENCY rows.
class PropertyDetailsSkeleton extends StatelessWidget {
  const PropertyDetailsSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    Widget tile() => const Expanded(
          child: _SkeletonCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBlock(width: 44, height: 9, radius: 4),
                SizedBox(height: 10),
                SkeletonBlock(width: 36, height: 22, radius: 6),
              ],
            ),
          ),
        );
    Widget row() => const Padding(
          padding: EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              SkeletonBlock(width: 20, height: 20, radius: 6),
              SizedBox(width: 12),
              Expanded(child: SkeletonBlock.line(widthFactor: 0.4)),
              SkeletonBlock(width: 80, height: 12, radius: 4),
            ],
          ),
        );
    return Skeleton(
      label: 'Loading your property',
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          const SkeletonBlock(width: 70, height: 10, radius: 4),
          const SizedBox(height: 10),
          Row(children: [tile(), const SizedBox(width: 10), tile(),
              const SizedBox(width: 10), tile()]),
          const SizedBox(height: 24),
          const SkeletonBlock(width: 80, height: 10, radius: 4),
          const SizedBox(height: 10),
          _SkeletonCard(child: Column(children: [row(), row(), row()])),
        ],
      ),
    );
  }
}

/// Edit Profile: avatar, then two labelled fields and the Save button.
class ProfileFormSkeleton extends StatelessWidget {
  const ProfileFormSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    Widget field() => const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SkeletonBlock(width: 64, height: 10, radius: 4),
            SizedBox(height: 8),
            SkeletonBlock(height: 52, radius: AppRadius.sm),
          ],
        );
    return Skeleton(
      label: 'Loading your profile',
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          const Center(child: SkeletonBlock.circle(96)),
          const SizedBox(height: 28),
          field(),
          const SizedBox(height: 20),
          field(),
          const SizedBox(height: 28),
          const SkeletonBlock(height: 52, radius: AppRadius.sm),
        ],
      ),
    );
  }
}
