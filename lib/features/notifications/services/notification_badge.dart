import 'dart:async';

import 'package:flutter/foundation.dart';

import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';
import 'package:monticello_villas_app/features/notifications/services/notification_prefs_store.dart';

/// Whether the header bell's dot should be lit: is there anything the
/// resident has not seen?
///
/// "Unseen" means what the Notifications screen means by unread — arrived
/// after the drawer was last opened, not opened since, and not deleted. The
/// dot used to light whenever the resident had ANY update at all, so it never
/// went out. Opening the drawer moves the "last opened" mark and puts it out;
/// a later alert lights it again.
class NotificationBadge extends ChangeNotifier {
  NotificationBadge._();
  static final NotificationBadge instance = NotificationBadge._();

  DateTime? _lastOpened;
  Set<String> _read = const {};
  Set<String> _dismissed = const {};
  bool _started = false;
  StreamSubscription<Set<String>>? _readSub;
  StreamSubscription<Set<String>>? _dismissedSub;

  /// Loads the stored marks and follows changes from other devices. Safe to
  /// call repeatedly.
  void start() {
    if (_started) return;
    _started = true;
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final opened = await NotificationPrefsStore.loadLastOpened();
      final read = await NotificationPrefsStore.loadRead();
      final dismissed = await NotificationPrefsStore.loadDismissed();
      _lastOpened = opened;
      _read = {..._read, ...read};
      _dismissed = {..._dismissed, ...dismissed};
      notifyListeners();
      _readSub = NotificationPrefsStore.watchRead().listen((ids) {
        _read = {..._read, ...ids};
        notifyListeners();
      }, onError: (Object _) {});
      _dismissedSub = NotificationPrefsStore.watchDismissed().listen((ids) {
        _dismissed = ids;
        notifyListeners();
      }, onError: (Object _) {});
    } catch (err) {
      debugPrint('Notification badge could not load: $err');
    }
  }

  /// True when [feed] holds something new: after the last visit to the
  /// drawer, unread and not deleted. Before the first visit, the last day
  /// counts as new — the same window the drawer itself uses.
  bool hasUnread(List<ResidentNotification> feed, {DateTime? now}) {
    final since = _lastOpened ?? (now ?? DateTime.now()).subtract(const Duration(hours: 24));
    return feed.any((n) => n.at.isAfter(since) && !_read.contains(n.id) && !_dismissed.contains(n.id));
  }

  /// The drawer was opened at [at]: everything up to then counts as seen.
  void noteOpened(DateTime at) {
    _lastOpened = at;
    notifyListeners();
  }

  void noteRead(String id) {
    if (_read.contains(id)) return;
    _read = {..._read, id};
    notifyListeners();
  }

  @visibleForTesting
  void debugReset({DateTime? lastOpened, Set<String> read = const {}, Set<String> dismissed = const {}}) {
    _lastOpened = lastOpened;
    _read = read;
    _dismissed = dismissed;
    _started = true;
  }

  @override
  void dispose() {
    _readSub?.cancel();
    _dismissedSub?.cancel();
    super.dispose();
  }
}
