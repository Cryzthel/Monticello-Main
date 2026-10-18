import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/widgets/page_title_bar.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/animated_list_entry.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';
import 'package:monticello_villas_app/core/widgets/refresh_shell.dart';
import 'package:monticello_villas_app/core/widgets/swipe_to_delete.dart';
import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';
import 'package:monticello_villas_app/features/notifications/services/notification_prefs_store.dart';
import 'package:monticello_villas_app/features/notifications/widgets/resident_notification_tile.dart';
import 'package:monticello_villas_app/features/notifications/widgets/notification_detail_modal.dart';
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

/// The notification bell's destination: security actions on the resident's own
/// reports, plus a heads-up when the HOA publishes something.
///
/// ── WHAT THIS REPLACED ────────────────────────────────────────────────────
/// `/notifications` used to route to `AnnouncementsScreen(title: 'Notification')`
/// — the community announcement feed with a different word in the header. Two
/// entry points, one body of content, so the bell rang for a pool maintenance
/// notice while a resident's own report moved Pending → Dispatched in silence.
///
/// ── THE FEED IS SEGMENTED BY WHEN YOU LAST LOOKED ─────────────────────────
/// Not by a read flag on each alert — there is nowhere to put one, because
/// every tile is derived at read time rather than stored (see
/// [ResidentNotification]). The drawer records WHEN IT WAS LAST OPENED, and
/// anything stamped after that moment is New. One integer on the handset gets
/// the whole Facebook-style split, and it needs no schema, no fan-out write and
/// no migration for history that predates it.
///
/// The stamp is written only after the previous value has been read, so the
/// visit you are in still shows what was new when you arrived.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  Set<String> _dismissed = const {};

  /// Alerts the resident has opened. A New row stays in New after it is read
  /// — the section says when it arrived — but its dot and tint go out.
  Set<String> _read = const {};
  DateTime? _lastOpened;
  bool _ready = false;
  bool _showPrevious = false;

  /// How many "Earlier" rows show before the history toggle takes over.
  ///
  /// Five is about a screen's worth under the New section — enough that the
  /// toggle is an option rather than a step everyone has to take, few enough
  /// that the initial view stays short.
  static const int _earlierPreview = 5;

  /// First-visit fallback for the New boundary.
  ///
  /// With no stored stamp, treating everything as New would highlight the
  /// entire feed and leave Earlier empty, which teaches nothing. A day's window
  /// gives a first-time reader the same shape everyone else sees.
  static const Duration _firstVisitWindow = Duration(hours: 24);

  /// Dismissals made on the resident's other devices, live.
  StreamSubscription<Set<String>>? _remoteDismissed;
  StreamSubscription<Set<String>>? _remoteRead;

  @override
  void initState() {
    super.initState();
    _restoreState();
    _remoteDismissed = NotificationPrefsStore.watchDismissed().listen((ids) {
      if (!mounted) return;
      setState(() => _dismissed = ids);
    });
    _remoteRead = NotificationPrefsStore.watchRead().listen((ids) {
      if (!mounted) return;
      // Union, not replace: a tap made here a moment ago may not have
      // round-tripped yet, and a stale snapshot must not relight its dot.
      setState(() => _read = {..._read, ...ids});
    });
  }

  @override
  void dispose() {
    _remoteDismissed?.cancel();
    _remoteRead?.cancel();
    super.dispose();
  }

  Future<void> _restoreState() async {
    final dismissed = await NotificationPrefsStore.loadDismissed();
    final lastOpened = await NotificationPrefsStore.loadLastOpened();
    final read = await NotificationPrefsStore.loadRead();
    if (!mounted) return;
    setState(() {
      _dismissed = dismissed;
      _read = {..._read, ...read};
      _lastOpened = lastOpened;
      _ready = true;
    });
    // AFTER the read. See NotificationPrefsStore.markOpened.
    await NotificationPrefsStore.markOpened(DateTime.now());
  }

  Future<void> _delete(ResidentNotification notification) async {
    HapticFeedback.mediumImpact();
    setState(() => _dismissed = {..._dismissed, notification.id});
    await NotificationPrefsStore.dismiss(notification.id);
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
          backgroundColor: AppColors.textPrimary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          duration: const Duration(seconds: 4),
          content: Text(
            'Notification deleted',
            style: _t(size: 13, weight: FontWeight.w600, color: AppColors.onAccent),
          ),
          // Undo matters more here than on most destructive actions: the swipe
          // is easy to trigger by accident while scrolling, and a dismissed
          // alert has no other way back — there is no server-side record of it
          // to re-sync.
          action: SnackBarAction(
            label: 'Undo',
            textColor: AppColors.accentSecondary,
            onPressed: () => _undo(notification.id),
          ),
        ),
      );
  }

  /// Opens the alert and marks it read. The state flips BEFORE the sheet
  /// opens, so the row behind the sheet is already unlit when it closes — the
  /// write to Firestore follows on its own and never holds the tap up.
  void _open(ResidentNotification notification) {
    if (!_read.contains(notification.id)) {
      setState(() => _read = {..._read, notification.id});
      unawaited(NotificationPrefsStore.markRead(notification.id));
    }
    showNotificationDetail(context, notification);
  }

  Future<void> _undo(String id) async {
    await NotificationPrefsStore.restore(id);
    if (!mounted) return;
    setState(() => _dismissed = {..._dismissed}..remove(id));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            const PageTitleBar(title: 'Notifications'),
            Expanded(
              child: ListenableBuilder(
                listenable: LocalDataStore.instance,
                builder: (context, _) {
                  final store = LocalDataStore.instance;
                  // `incidents` is already scoped to reporterUid == this user
                  // by the Firestore query in LocalDataStore.startListening, so
                  // this feed cannot surface another resident's dispatch
                  // history. That guarantee lives in the query.
                  final feed = ResidentNotification.build(
                    incidents: store.incidents,
                    announcements: store.announcements,
                  ).where((n) => !_dismissed.contains(n.id)).toList();

                  // Both feeds this list merges have to have answered, and the
                  // stored New/Earlier boundary has to be back, before there is
                  // anything true to draw.
                  final loading = !_ready ||
                      !store.hasLoadedIncidents ||
                      !store.hasLoadedAnnouncements;
                  return RefreshShell(
                    onRefresh: store.refresh,
                    child: loading && feed.isEmpty
                        ? const NotificationListSkeleton()
                        : feed.isEmpty && _ready
                        ? const _EmptyState()
                        : ListView(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 80),
                            children: _buildSections(feed),
                          ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildSections(List<ResidentNotification> feed) {
    // Until the stored stamp is back, the split cannot be computed. Rendering
    // the feed anyway would flash every row as New and then re-sort it.
    if (!_ready) return const [_ScopeNote()];

    final boundary = _lastOpened ?? DateTime.now().subtract(_firstVisitWindow);

    final sections = NotificationSections.split(feed, boundary);
    final fresh = sections.fresh;
    final earlier = sections.earlier;

    final hidden = earlier.length - _earlierPreview;
    final visibleEarlier = _showPrevious || hidden <= 0
        ? earlier
        : earlier.sublist(0, _earlierPreview);

    return [
      const _ScopeNote(),
      if (fresh.isNotEmpty) ...[
        _SectionHeader(label: 'New', count: fresh.length, accent: true),
        for (final notification in fresh) _row(notification, unread: true),
      ],
      if (visibleEarlier.isNotEmpty) ...[
        _SectionHeader(label: 'Earlier', count: earlier.length),
        for (final notification in visibleEarlier) _row(notification),
      ],
      if (hidden > 0)
        _SeePreviousButton(
          expanded: _showPrevious,
          hidden: hidden,
          onTap: () => setState(() => _showPrevious = !_showPrevious),
        ),
    ];
  }

  Widget _row(ResidentNotification notification, {bool unread = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SwipeToDelete(
        key: ValueKey(notification.id),
        onDismissed: () => _delete(notification),
        child: AnimatedListEntry(
          child: ResidentNotificationTile(
            notification: notification,
            unread: unread && !_read.contains(notification.id),
            onDelete: () => _delete(notification),
            onTap: () => _open(notification),
          ),
        ),
      ),
    );
  }
}

/// "New · 3" / "Earlier · 12".
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.label,
    required this.count,
    this.accent = false,
  });

  final String label;
  final int count;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    final tone = accent ? AppColors.primaryDark : AppColors.textSecondary;

    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 14, 2, 8),
      child: Row(
        children: [
          Text(
            label,
            style: _t(
              size: 13,
              weight: FontWeight.w800,
              color: accent ? AppColors.textPrimary : AppColors.textSecondary,
              letterSpacing: -0.1,
            ),
          ),
          const SizedBox(width: 7),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(AppRadius.pill),
            ),
            child: Text(
              '$count',
              style: _t(
                size: 10.5,
                weight: FontWeight.w800,
                color: tone,
                height: 1.2,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The history toggle at the foot of the feed.
class _SeePreviousButton extends StatelessWidget {
  const _SeePreviousButton({
    required this.expanded,
    required this.hidden,
    required this.onTap,
  });

  final bool expanded;
  final int hidden;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        behavior: HitTestBehavior.opaque,
        child: Container(
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.backgroundSecondary,
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: AppColors.borderNeutral),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                // Names the count when collapsed. "See Previous Notifications"
                // alone does not say whether it hides two rows or thirty, which
                // is the one thing that decides whether it is worth tapping.
                expanded
                    ? 'Show Fewer Notifications'
                    : 'See Previous Notifications ($hidden)',
                style: _t(
                  size: 13,
                  weight: FontWeight.w700,
                  color: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 6),
              Icon(
                expanded
                    ? PhosphorIconsBold.caretUp
                    : PhosphorIconsBold.caretDown,
                size: 13,
                color: AppColors.primaryDark,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// States the feed's scope in one line, at the top of the list.
///
/// Worth the row: a drawer that mixes two kinds of alert is ambiguous about
/// what it covers, and a quiet one is ambiguous about whether it works.
/// Naming the scope answers both without the resident going looking.
class _ScopeNote extends StatelessWidget {
  const _ScopeNote();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      // Neutral border and shared radius like every other container; only the
      // FILL differs, so the note reads as a callout rather than as a tile you
      // might mistake for an alert. Inert — it states scope, it does nothing.
      child: AppCard(
        color: AppColors.surfaceAccentSoft,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        showShadow: false,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(PhosphorIconsFill.bell,
                size: 15, color: AppColors.primary),
            const SizedBox(width: 9),
            Expanded(
              child: Text(
                'Security updates on your reports, and new subdivision notices. '
                'Swipe a card left, or use its menu, to remove it from here.',
                style:
                    _t(size: 11.5, color: AppColors.textSecondary, height: 1.35),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    // Inside a ListView so pull-to-refresh still has something to drag; a bare
    // Center in a RefreshShell has no scrollable and the gesture dies.
    return ListView(
      padding: const EdgeInsets.fromLTRB(32, 48, 32, 80),
      children: [
        Center(
          child: Column(
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withValues(alpha: 0.08),
                ),
                child: const Icon(PhosphorIconsFill.bell,
                    color: AppColors.primary, size: 28),
              ),
              const SizedBox(height: 14),
              Text('No notifications yet',
                  style: _t(size: 15, weight: FontWeight.w700)),
              const SizedBox(height: 6),
              Text(
                'Security updates on your reports and new subdivision notices '
                'will appear here.',
                textAlign: TextAlign.center,
                style: _t(size: 12.5, color: AppColors.textSecondary, height: 1.45),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
