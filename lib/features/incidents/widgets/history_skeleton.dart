import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';
import 'package:monticello_villas_app/core/widgets/skeleton.dart';

/// The History feed's placeholder, shown until the first reports snapshot
/// lands — see `LocalDataStore.hasLoadedIncidents`.
///
/// ── IT IS THE CARD, NOT A GREY RECTANGLE ──────────────────────────────────
/// Every block here sits where the real thing will: the 42px category tile, the
/// title over its id line, the status pill and relative time on the right, the
/// four-step rail, the location line. That is the difference between a skeleton
/// and a loading screen — when the data lands, nothing moves. A generic stack
/// of bars would relayout the whole feed on arrival, which is the flash the
/// placeholder was added to prevent.
class HistoryFeedSkeleton extends StatelessWidget {
  const HistoryFeedSkeleton({super.key, this.cards = 4});

  final int cards;

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      label: 'Loading your reports',
      child: ListView.separated(
        // Not scrollable: there is nothing to reach, and a placeholder that
        // scrolls invites a pull-to-refresh gesture the feed cannot answer yet.
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: cards,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, __) => const _IncidentCardSkeleton(),
      ),
    );
  }
}

class _IncidentCardSkeleton extends StatelessWidget {
  const _IncidentCardSkeleton();

  @override
  Widget build(BuildContext context) {
    // The real card's frame, to the pixel — same radius, same hairline, same
    // shadow. Only the contents are standing in.
    return const AppCard(
      borderColor: AppColors.borderNeutralSoft,
      borderWidth: AppStroke.hairline,
      shadows: AppShadows.sm,
      cornerRadius: AppRadius.lg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SkeletonBlock(width: 42, height: 42, radius: 12),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(height: 3),
                    SkeletonBlock.line(widthFactor: 0.72, height: 12),
                    SizedBox(height: 7),
                    SkeletonBlock.line(widthFactor: 0.45, height: 9),
                  ],
                ),
              ),
              SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  SkeletonBlock(width: 64, height: 20, radius: AppRadius.pill),
                  SizedBox(height: 6),
                  SkeletonBlock(width: 38, height: 9, radius: 4),
                ],
              ),
            ],
          ),
          // Where ReportStatusTracker goes: four discs on one rail, spaced the
          // way the tracker spaces them — a quarter of the width each, disc
          // centred in its column.
          Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: _TrackerSkeleton(),
          ),
          Row(
            children: [
              Expanded(
                child: SkeletonBlock.line(widthFactor: 0.55, height: 10),
              ),
              SizedBox(width: 12),
              SkeletonBlock(width: 78, height: 10, radius: 4),
            ],
          ),
        ],
      ),
    );
  }
}

class _TrackerSkeleton extends StatelessWidget {
  const _TrackerSkeleton();

  static const double _node = 26;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final column = constraints.maxWidth / 4;
        return SizedBox(
          height: _node,
          child: Stack(
            children: [
              for (var i = 0; i < 3; i++)
                Positioned(
                  left: column * (i + 0.5) + _node / 2 + 3,
                  width: math.max(0.0, column - _node - 6),
                  top: (_node - 2.5) / 2,
                  height: 2.5,
                  child: const SkeletonBlock(height: 2.5, radius: 2),
                ),
              for (var i = 0; i < 4; i++)
                Positioned(
                  left: column * (i + 0.5) - _node / 2,
                  top: 0,
                  child: const SkeletonBlock.circle(_node),
                ),
            ],
          ),
        );
      },
    );
  }
}
