import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';

/// Durable, encrypted queue of SOS alerts that have not been acknowledged by
/// the server yet.
///
/// ── WHY NOT JUST LET FIRESTORE DO IT ──────────────────────────────────────
/// Firestore's offline persistence already queues writes and replays them on
/// reconnect, and that machinery stays in place — this queue is not a
/// replacement for it. It exists because that queue cannot answer three
/// questions this feature has to answer:
///
///   1. "Is my alert still waiting?" Firestore's pending-write set is not
///      enumerable from Dart, so the UI has nothing to render and the resident
///      is told nothing.
///   2. "Send it another way." Nothing can hand a queued write to the SMS
///      fallback, because nothing can read it back out.
///   3. "Is it encrypted?" Firestore's cache is a plain on-disk database. A
///      pending alert holds a resident's name, phone, home address and exact
///      coordinates; on a lost or stolen phone that is a package worth
///      protecting, and it is the one part of this app's data that sits at
///      rest in a known location with a known schema.
///
/// [FlutterSecureStorage] puts it behind the iOS Keychain and, on Android,
/// EncryptedSharedPreferences with a Keystore-held key — so the queue is
/// readable by this app on this device and by nothing else.
///
/// Duplicate delivery is not this class's problem to solve: both paths write
/// to [SosPayload.alertId] as the document id, so replaying an alert Firestore
/// already delivered overwrites an identical document rather than raising a
/// second emergency.
class SosQueue {
  SosQueue._();

  static const _key = 'sos.pending.v1';

  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(
      // The queue must survive a locked phone. A resident who raises an alert
      // and pockets the device is the normal case, not the exception, and
      // `first_unlock` is the strictest class that still lets the sync service
      // drain in the background afterwards.
      accessibility: KeychainAccessibility.first_unlock,
    ),
  );

  /// Bumped whenever the queue changes, so UI can show "1 alert waiting to
  /// send" without polling.
  static final ValueNotifier<int> pendingCount = ValueNotifier<int>(0);

  /// Serialises read-modify-write. Two alerts raised inside the same second —
  /// a double press, or a press while the sync service is draining — would
  /// otherwise both read the old list and one would overwrite the other.
  /// Losing an emergency to a race is not an acceptable failure here.
  static Future<void> _lock = Future<void>.value();

  static Future<T> _serialised<T>(Future<T> Function() action) {
    final completer = Completer<T>();
    _lock = _lock.then((_) async {
      try {
        completer.complete(await action());
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    return completer.future;
  }

  static Future<List<SosPayload>> pending() => _serialised(_readUnlocked);

  static Future<List<SosPayload>> _readUnlocked() async {
    try {
      final raw = await _storage.read(key: _key);
      final items = SosPayload.decodeList(raw ?? '');
      pendingCount.value = items.length;
      return items;
    } catch (_) {
      // Keystore can genuinely fail — a device mid-migration, a restored
      // backup with an unreadable key. Report an empty queue rather than
      // throwing into the SOS path.
      return const [];
    }
  }

  static Future<void> _writeUnlocked(List<SosPayload> items) async {
    await _storage.write(key: _key, value: SosPayload.encodeList(items));
    pendingCount.value = items.length;
  }

  /// Records the alert before anything is attempted over the network.
  ///
  /// Order matters and this is the whole point: the payload is on disk before
  /// the first packet leaves. If the write succeeds it is removed a moment
  /// later; if the app is killed, the battery dies, or the resident walks out
  /// of coverage mid-send, the alert is still there to retry.
  static Future<void> enqueue(SosPayload payload) => _serialised(() async {
        final items = await _readUnlocked();
        if (items.any((e) => e.alertId == payload.alertId)) return;
        await _writeUnlocked([...items, payload]);
      });

  static Future<void> remove(String alertId) => _serialised(() async {
        final items = await _readUnlocked();
        await _writeUnlocked(
          items.where((e) => e.alertId != alertId).toList(),
        );
      });

  static Future<void> recordAttempt(String alertId) => _serialised(() async {
        final items = await _readUnlocked();
        await _writeUnlocked([
          for (final item in items)
            item.alertId == alertId ? item.withAttempt() : item,
        ]);
      });

  /// Test seam. Never call from app code.
  @visibleForTesting
  static Future<void> clear() => _serialised(() => _writeUnlocked(const []));
}
