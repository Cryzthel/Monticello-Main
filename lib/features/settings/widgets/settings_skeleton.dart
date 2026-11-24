import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';
import 'package:monticello_villas_app/core/widgets/settings_row.dart';
import 'package:monticello_villas_app/core/widgets/skeleton.dart';

/// The Settings screen's placeholder, shown until the resident's profile and
/// preferences have been fetched — see `UserProfileService.hasLoaded`.
///
/// Every switch on this screen is a stored value. Rendering the rows before
/// those values arrive means drawing toggles in whatever position the default
/// happens to be and then flipping them once the profile lands, which is a
/// screen appearing to change a resident's settings by itself. The placeholder
/// is what makes "we do not know yet" a state the screen can actually be in.
class SettingsSkeleton extends StatelessWidget {
  const SettingsSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      label: 'Loading your settings',
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        // Top zero, and the same gutters and bottom clearance the real list
        // uses: the screen's heading sits ABOVE this — it is not waiting on
        // anything and never pulses — so the placeholder starts exactly where
        // the profile card will.
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.screenGutter,
          0,
          AppSpacing.screenGutter,
          AppSpacing.navClearance,
        ),
        children: const [
          _ProfileCardSkeleton(),
          SizedBox(height: 24),
          _GroupSkeleton(rows: 2),
          SizedBox(height: 24),
          _GroupSkeleton(rows: 2),
          SizedBox(height: 24),
          _GroupSkeleton(rows: 3),
        ],
      ),
    );
  }
}

class _ProfileCardSkeleton extends StatelessWidget {
  const _ProfileCardSkeleton();

  @override
  Widget build(BuildContext context) {
    return const AppCard(
      showBorder: false,
      shadows: AppShadows.sm,
      cornerRadius: AppRadius.lg,
      padding: EdgeInsets.all(18),
      child: Row(
        children: [
          SkeletonBlock.circle(56),
          SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBlock.line(widthFactor: 0.55, height: 13),
                SizedBox(height: 8),
                SkeletonBlock.line(widthFactor: 0.75, height: 10),
                SizedBox(height: 10),
                SkeletonBlock(width: 104, height: 20, radius: AppRadius.pill),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One settings group: the same borderless panel the real groups use, with a
/// leading tile and a label line per row, on the row grid [SettingsRow]
/// publishes so nothing shifts when the real rows replace these.
class _GroupSkeleton extends StatelessWidget {
  const _GroupSkeleton({required this.rows});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      showBorder: false,
      shadows: AppShadows.sm,
      cornerRadius: AppRadius.lg,
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (var i = 0; i < rows; i++) ...[
            if (i > 0) const SettingsRowDivider(),
            const Padding(
              padding: EdgeInsets.symmetric(
                horizontal: SettingsRow.padX,
                vertical: SettingsRow.padY,
              ),
              child: Row(
                children: [
                  SkeletonBlock(
                    width: SettingsRow.tileSize,
                    height: SettingsRow.tileSize,
                    radius: SettingsRow.tileRadius,
                  ),
                  SizedBox(width: SettingsRow.gap),
                  Expanded(
                    child: SkeletonBlock.line(widthFactor: 0.5, height: 12),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
