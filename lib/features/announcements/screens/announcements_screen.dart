import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/widgets/page_title_bar.dart';
import 'package:monticello_villas_app/core/widgets/refresh_shell.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcement_card.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/feed_skeletons.dart';

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

/// The community announcement feed: HOA broadcasts to every resident, with
/// category filters.
///
/// ── SCOPE, AND WHAT THIS SCREEN IS NOT ────────────────────────────────────
/// This screen carried a `title` parameter so that `/notifications` could
/// mount it as "Notification" — one feed serving both the "See All" link and
/// the header's bell. That is gone. The bell now has its own screen, its own
/// model and its own content (NotificationsScreen: security actions on the
/// resident's own reports), because a bell that rings for a pool-maintenance
/// notice trains people to ignore it on the day it rings for their break-in.
///
/// The parameter is removed rather than defaulted, so the two feeds cannot
/// quietly re-merge behind a string argument the way they did before.
class AnnouncementsScreen extends StatefulWidget {
  const AnnouncementsScreen({super.key});

  @override
  State<AnnouncementsScreen> createState() => _AnnouncementsScreenState();
}

class _AnnouncementsScreenState extends State<AnnouncementsScreen> {
  // Vocabulary and matching both come from the shared filter bar, so this
  // screen cannot drift back to offering a category the dashboard never writes.
  String _filter = AnnouncementFilterBar.allAnnouncements;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // The shared header. Was a hand-rolled Stack at w800 — one of the
            // two screens that had drifted heavier than the other five.
            const PageTitleBar(title: 'Announcements'),
            Expanded(
              child: ListenableBuilder(
        listenable: LocalDataStore.instance,
        builder: (context, _) {
          final all = LocalDataStore.instance.announcements;
          // Filter first, then order — so a pinned notice rises to the top of
          // whichever CATEGORY tab it belongs to rather than only of "All".
          // Sorting first and filtering after produces the same list here, but
          // this order is the one that stays correct if the filter ever becomes
          // something that can reorder.
          final list = sortAnnouncementsForFeed(
            all.where((a) => AnnouncementFilterBar.matches(_filter, a)).toList(),
          );
          return Column(
            children: [
              AnnouncementFilterBar(
                value: _filter,
                onChanged: (f) => setState(() => _filter = f),
              ),
              const SizedBox(height: 14),
              Expanded(
                // The app's one pull-to-refresh (leaf bar, pop, haptic), as on
                // History, Notifications and Edit Profile.
                child: RefreshShell(
                  onRefresh: LocalDataStore.instance.refresh,
                  child: !LocalDataStore.instance.hasLoadedAnnouncements &&
                          list.isEmpty
                      ? const AnnouncementFeedSkeleton()
                      : list.isEmpty
                      // Scrollable even when empty, or the pull has nothing
                      // to drag and the gesture dies.
                      ? LayoutBuilder(
                          builder: (context, c) => SingleChildScrollView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            child: SizedBox(
                              height: c.maxHeight,
                              child: _emptyState(),
                            ),
                          ),
                        )
                      : ListView.separated(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 80),
                          itemCount: list.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 12),
                          itemBuilder: (_, i) =>
                              AnnouncementCard(announcement: list[i]),
                        ),
                ),
              ),
            ],
          );
        },
      ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _emptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: 0.08),
              ),
              child: const Icon(PhosphorIconsFill.megaphone,
                  color: AppColors.primary, size: 28),
            ),
            const SizedBox(height: 14),
            Text('No announcements',
                style: _t(size: 15, weight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(
              'New community posts will appear here automatically.',
              textAlign: TextAlign.center,
              style: _t(size: 12.5, color: AppColors.textSecondary, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}

