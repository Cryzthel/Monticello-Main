import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/widgets/page_title_bar.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/animated_list_entry.dart';
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

  /// Deleted on screen but not yet written: the Undo window is still open.
  /// See [_delete].
  Set<String> _pending = const {};
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

  /// Asks before deleting. Both routes to delete — the swipe and the
  /// overflow menu — go through this, so a scroll that drifts sideways past
  /// the threshold costs a Cancel, not an alert.
  Future<bool> _confirmDelete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.backgroundSecondary,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.xl),
          side: const BorderSide(color: AppColors.innerStroke),
        ),
        title: Text('Delete notification?',
            style: _t(size: 17, weight: FontWeight.w700)),
        content: Text(
          'It is removed from this list on all your devices. The report or '
          'announcement it points to is not affected.',
          style: _t(size: 13.5, color: AppColors.textSecondary, height: 1.45),
        ),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('Cancel',
                style: _t(
                    size: 14,
                    weight: FontWeight.w600,
                    color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.danger,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10)),
            ),
            child: Text('Delete',
                style: _t(
                    size: 14, weight: FontWeight.w600, color: Colors.white)),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  /// Hides a confirmed deletion at once and offers Undo; the dismissal is
  /// WRITTEN only once the snackbar closes without Undo.
  ///
  /// ── WHY THE WRITE WAITS ──────────────────────────────────────────────────
  /// Writing first and backing it out on Undo meant every undone delete still
  /// reached Firestore twice, and for a moment the resident's other devices
  /// hid the row too. Holding the id in [_pending] instead keeps the change
  /// on this screen until it is final. The snackbar lives on the app-level
  /// ScaffoldMessenger, so its `closed` future still completes after this
  /// screen is popped, and the write goes through the static store either
  /// way. A process killed inside the 4s window loses the deletion, which is
  /// the safe direction: the alert simply comes back.
  void _delete(ResidentNotification notification) {
    HapticFeedback.mediumImpact();
    final id = notification.id;
    setState(() => _pending = {..._pending, id});

    final controller = ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar();
    controller
        .showSnackBar(
          SnackBar(
            behavior: SnackBarBehavior.floating,
            margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
            backgroundColor: AppColors.textPrimary,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            // ── 3 SECONDS, AND IT MUST ACTUALLY LEAVE ──────────────────────
            // `persist: false` is what makes [duration] mean anything. Since
            // Flutter 3.29 a SnackBar with an action defaults to persisting
            // until dismissed, so this toast sat on screen forever — and
            // because the dismissal is written in `closed` below, a toast
            // that never closed was a delete that never saved.
            persist: false,
            duration: const Duration(seconds: 3),
            content: Text(
              'Notification deleted',
              style: _t(
                  size: 13, weight: FontWeight.w600, color: AppColors.onAccent),
            ),
            action: SnackBarAction(
              label: 'Undo',
              textColor: AppColors.accentSecondary,
              onPressed: () => _undo(id),
            ),
          ),
        )
        .closed
        .then((reason) async {
      if (reason == SnackBarClosedReason.action) return;
      await NotificationPrefsStore.dismiss(id);
      if (!mounted) return;
      setState(() {
        _pending = {..._pending}..remove(id);
        _dismissed = {..._dismissed, id};
      });
    });
  }

  void _undo(String id) {
    HapticFeedback.selectionClick();
    if (!mounted) return;
    setState(() => _pending = {..._pending}..remove(id));
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
                  ).where((n) =>
                          !_dismissed.contains(n.id) &&
                          !_pending.contains(n.id)).toList();

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
                            // No side padding: rows run edge to edge so the
                            // unread wash and the swipe plate are full-bleed.
                            // The headers carry their own 16px gutter.
                            padding: const EdgeInsets.fromLTRB(0, 4, 0, 80),
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
    if (!_ready) return const [];

    final boundary = _lastOpened ?? DateTime.now().subtract(_firstVisitWindow);

    final sections = NotificationSections.split(feed, boundary);
    final fresh = sections.fresh;
    final earlier = sections.earlier;

    final hidden = earlier.length - _earlierPreview;
    final visibleEarlier = _showPrevious || hidden <= 0
        ? earlier
        : earlier.sublist(0, _earlierPreview);

    return [
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
    return SwipeToDelete(
      key: ValueKey(notification.id),
      plateRadius: BorderRadius.zero,
      confirmDismiss: _confirmDelete,
      onDismissed: () => _delete(notification),
      child: AnimatedListEntry(
        child: ResidentNotificationTile(
          notification: notification,
          unread: unread && !_read.contains(notification.id),
          onDelete: () async {
            if (await _confirmDelete() && mounted) _delete(notification);
          },
          onTap: () => _open(notification),
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
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
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
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
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
