import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The resident's notification state: which alerts they have dismissed, and
/// when they last opened the drawer.
///
/// ── WHAT A DISMISSAL IS ────────────────────────────────────────────────────
/// There is no `notifications` collection. Every tile is DERIVED at read time
/// from an incident's own timestamps and an announcement's `postedAt` — see
/// [ResidentNotification]. So "delete this notification" cannot mean deleting a
/// document: the only documents behind a tile are the resident's own security
/// report and a subdivision-wide announcement, and deleting either to clear a
/// row would destroy a security record or a notice every other household is
/// still reading. It means "stop showing me this", stored as a set of ids.
///
/// ── WHERE IT LIVES ─────────────────────────────────────────────────────────
/// In Firestore, at `users/{uid}.notificationState.resident` — the same shape
/// and place the staff portals keep theirs (`.admin`, `.security`), and a path
/// firestore.rules already lets the owner write. It used to live only on the
/// handset, so a resident who cleared a row on one phone saw it again on the
/// next, and reinstalling brought every dismissed alert back.
///
/// SharedPreferences stays as the offline cache: reads merge the two, writes
/// go to both, and a failed or absent network costs nothing but the sync —
/// this state must never be able to stop the drawer rendering.
class NotificationPrefsStore {
  NotificationPrefsStore._();

  /// Versioned so the format can change without having to read old entries.
  static const String _dismissedKey = 'dismissed_notifications_v1';
  static const String _lastOpenedKey = 'notifications_last_opened_v1';

  /// Dismissals are ids, not documents, so they are cheap — but they are also
  /// never garbage-collected by anything else, and an alert whose incident has
  /// long since aged out of the feed can never reappear to clear its own id.
  /// The cap keeps the list from growing for the life of the account.
  static const int maxDismissed = 300;

  /// A remote read that has not answered by now is skipped; the local cache
  /// already has something true to show.
  static const Duration _remoteTimeout = Duration(seconds: 4);

  // ── Remote ────────────────────────────────────────────────────────────────

  /// The signed-in resident's users document, or null when there is no
  /// Firebase app (tests) or no one signed in.
  static DocumentReference<Map<String, dynamic>>? get _doc {
    try {
      if (Firebase.apps.isEmpty) return null;
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) return null;
      return FirebaseFirestore.instance.collection('users').doc(uid);
    } catch (_) {
      return null;
    }
  }

  static Map<String, dynamic>? _stateOf(Map<String, dynamic>? data) {
    final all = data?['notificationState'];
    if (all is! Map) return null;
    final mine = all['resident'];
    return mine is Map ? Map<String, dynamic>.from(mine) : null;
  }

  static Set<String> _idsOf(Map<String, dynamic>? state) {
    final raw = state?['dismissedIds'];
    if (raw is! List) return <String>{};
    return raw.whereType<String>().toSet();
  }

  /// [ok] is false when the server could not be asked or did not answer —
  /// as opposed to answering that there is no state yet.
  static Future<({bool ok, Map<String, dynamic>? state})> _readRemote() async {
    final doc = _doc;
    if (doc == null) return (ok: false, state: null);
    try {
      final snap = await doc.get().timeout(_remoteTimeout);
      return (ok: true, state: _stateOf(snap.data()));
    } catch (_) {
      return (ok: false, state: null);
    }
  }

  /// Merge-writes [fields] into this resident's state. Never awaited by the
  /// UI for longer than a write takes to queue: Firestore holds it offline and
  /// sends it when the network returns.
  static Future<void> _writeRemote(Map<String, dynamic> fields) async {
    final doc = _doc;
    if (doc == null) return;
    try {
      await doc.set({
        'notificationState': {'resident': fields},
      }, SetOptions(merge: true));
    } catch (_) {
      // Ignored — see the class note.
    }
  }

  /// Live dismissals from the server, so a row cleared on another device
  /// disappears here too. Empty stream with no one signed in.
  static Stream<Set<String>> watchDismissed() {
    final doc = _doc;
    if (doc == null) return const Stream.empty();
    return doc
        .snapshots()
        // Only once the server HAS a list. Before the first sync the field is
        // absent, and reading that as "nothing dismissed" would wipe the
        // handset's own dismissals off the screen.
        .where((snap) => _stateOf(snap.data())?['dismissedIds'] is List)
        .map((snap) => _idsOf(_stateOf(snap.data())))
        .handleError((_) {});
  }

  // ── Dismissals ────────────────────────────────────────────────────────────

  static Future<List<String>> _localIds() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return List<String>.from(prefs.getStringList(_dismissedKey) ?? const []);
    } catch (_) {
      return <String>[];
    }
  }

  static Future<void> _saveLocal(List<String> ids) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_dismissedKey, ids);
    } catch (_) {
      // Ignored.
    }
  }

  /// Writes the whole capped list to both stores.
  ///
  /// The full list rather than an arrayUnion, so the cap holds on the server
  /// too — arrayUnion can only grow.
  static Future<void> _persist(List<String> ids) async {
    // Oldest out first. A dismissal that falls off the end simply means the
    // alert can come back, which is the safe direction to fail in.
    while (ids.length > maxDismissed) {
      ids.removeAt(0);
    }
    await _saveLocal(ids);
    await _writeRemote({'dismissedIds': ids});
  }

  /// Never throws. The union of this handset's cache and the server's list,
  /// so neither a fresh install nor an offline start loses anything.
  static Future<Set<String>> loadDismissed() async {
    final local = await _localIds();
    final read = await _readRemote();
    final remote = _idsOf(read.state);
    final merged = [...local, ...remote.where((id) => !local.contains(id))];
    if (merged.length != local.length) await _saveLocal(merged);
    // First sync from this handset (or it holds ids the server lacks): send
    // the union up, so other devices and [watchDismissed] start from it.
    // Only after a real answer: writing on a timed-out read would replace the
    // server's list with this handset's and drop ids dismissed elsewhere.
    if (read.ok && !remote.containsAll(merged)) {
      unawaited(_writeRemote({'dismissedIds': merged}));
    }
    return merged.toSet();
  }

  static Future<void> dismiss(String id) async {
    if (id.isEmpty) return;
    final ids = await _localIds();
    if (ids.contains(id)) return;
    await _persist(ids..add(id));
  }

  /// Backs out a dismissal. Exists so the delete action can offer Undo.
  static Future<void> restore(String id) async {
    final ids = await _localIds();
    if (!ids.remove(id)) return;
    await _persist(ids);
  }

  static Future<void> clearDismissed() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_dismissedKey);
    } catch (_) {
      // Ignored.
    }
    await _writeRemote({'dismissedIds': <String>[]});
  }

  // ── Read ──────────────────────────────────────────────────────────────────
  //
  // Per-alert read state, at `notificationState.resident.readIds` — the same
  // field name the staff portals use for theirs. A tap on a New row marks
  // that row read: its dot goes out and its tint clears at once, without the
  // resident having to leave and come back for [markOpened] to move the
  // boundary. Same cap, same offline-first merge as the dismissals.

  static const String _readKey = 'read_notifications_v1';

  static Set<String> _readOf(Map<String, dynamic>? state) {
    final raw = state?['readIds'];
    if (raw is! List) return <String>{};
    return raw.whereType<String>().toSet();
  }

  static Future<List<String>> _localRead() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return List<String>.from(prefs.getStringList(_readKey) ?? const []);
    } catch (_) {
      return <String>[];
    }
  }

  /// Never throws. The union of this handset's cache and the server's list.
  static Future<Set<String>> loadRead() async {
    final local = await _localRead();
    final remote = _readOf((await _readRemote()).state);
    unawaited(trimRemoteRead());
    return {...local, ...remote};
  }

  /// Live read ids from the server, so a row opened on another device stops
  /// glowing here too. Skips snapshots taken before the field exists, for the
  /// same reason as [watchDismissed].
  static Stream<Set<String>> watchRead() {
    final doc = _doc;
    if (doc == null) return const Stream.empty();
    return doc
        .snapshots()
        .where((snap) => _stateOf(snap.data())?['readIds'] is List)
        .map((snap) => _readOf(_stateOf(snap.data())))
        .handleError((_) {});
  }

  static Future<void> markRead(String id) async {
    if (id.isEmpty) return;
    final ids = await _localRead();
    if (ids.contains(id)) return;
    ids.add(id);
    while (ids.length > maxDismissed) {
      ids.removeAt(0);
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_readKey, ids);
    } catch (_) {
      // Ignored.
    }
    // arrayUnion, not the whole list: the server may hold ids read on another
    // device that this handset never cached, and a full-list write made after
    // a timed-out read would erase them. The cap is enforced on the handset
    // and trimmed server-side by [trimRemoteRead] on the next load.
    await _writeRemote({
      'readIds': FieldValue.arrayUnion([id]),
    });
  }

  /// Keeps the server list under the cap. Only after a real read, so a
  /// timeout can never replace another device's list with this one's.
  static Future<void> trimRemoteRead() async {
    final read = await _readRemote();
    if (!read.ok) return;
    final remote = _readOf(read.state).toList();
    if (remote.length <= maxDismissed) return;
    await _writeRemote(
        {'readIds': remote.sublist(remote.length - maxDismissed)});
  }

  // ── Last opened ───────────────────────────────────────────────────────────

  /// When the drawer was last opened on ANY of the resident's devices, or null
  /// on a first-ever visit.
  ///
  /// This is what makes a "New" section possible without a read flag on every
  /// alert: anything stamped after this moment has not been seen before.
  static Future<DateTime?> loadLastOpened() async {
    int? local;
    try {
      final prefs = await SharedPreferences.getInstance();
      local = prefs.getInt(_lastOpenedKey);
    } catch (_) {}
    final rawRemote = (await _readRemote()).state?['lastSeenAt'];
    final remote = rawRemote is int ? rawRemote : null;
    final latest = [local, remote].whereType<int>().fold<int?>(
        null, (a, b) => a == null || b > a ? b : a);
    return latest == null ? null : DateTime.fromMillisecondsSinceEpoch(latest);
  }

  /// Stamps this visit.
  ///
  /// Called AFTER the screen has captured the previous value, so the current
  /// view still shows what was new on arrival and the next visit reflects it.
  /// Writing it before reading would make the New section empty every time.
  static Future<void> markOpened(DateTime at) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(_lastOpenedKey, at.millisecondsSinceEpoch);
    } catch (_) {
      // Ignored.
    }
    await _writeRemote({'lastSeenAt': at.millisecondsSinceEpoch});
  }
}
