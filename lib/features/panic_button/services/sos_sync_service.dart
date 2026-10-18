import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';

import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';
import 'package:monticello_villas_app/features/panic_button/services/panic_alert_service.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_queue.dart';

/// Drains [SosQueue] whenever the device looks reachable again.
///
/// ── THREE TRIGGERS, BECAUSE ONE IS NOT ENOUGH ─────────────────────────────
/// Connectivity events alone would miss the two cases that matter most.
///
///   • Cold start. An alert raised in a dead spot, after which the resident
///     force-quits or the OS reclaims the app, has no connectivity transition
///     to wait for — the radio was already up by the time Dart ran. So the
///     queue is drained once at boot.
///   • Resume. Android and iOS both suppress connectivity callbacks for a
///     backgrounded app, so a phone that regained signal in a pocket reports
///     nothing until it is next looked at.
///   • The connectivity stream itself, for the live walk-back-into-range case.
///
/// ── WHY A TRANSITION IS NOT PROOF ─────────────────────────────────────────
/// `ConnectivityResult` describes the radio, not the internet: captive portals,
/// a Wi-Fi network with no upstream, and a cell with no backhaul all report
/// `wifi` or `mobile`. So a transition is treated only as a reason to TRY. The
/// write's own timeout is what decides whether the alert actually landed, and
/// anything that does not land stays queued for the next trigger.
class SosSyncService with WidgetsBindingObserver {
  SosSyncService._();

  static final SosSyncService instance = SosSyncService._();

  /// How long a queued write gets before it is considered still-offline.
  ///
  /// Firestore's `set()` future does NOT complete while offline — it resolves
  /// on server acknowledgement, which is exactly what "delivered" should mean,
  /// and exactly why it hangs forever without signal. Every delivery in this
  /// feature is therefore raced against a clock rather than awaited.
  static const Duration ackTimeout = Duration(seconds: 8);

  StreamSubscription<ConnectivityResult>? _connectivitySub;
  bool _draining = false;
  bool _started = false;

  /// Safe to call more than once; only the first call wires anything up.
  Future<void> start() async {
    if (_started) return;
    _started = true;

    WidgetsBinding.instance.addObserver(this);
    _connectivitySub = Connectivity().onConnectivityChanged.listen((result) {
      if (result != ConnectivityResult.none) unawaited(drain());
    });

    // Populate the pending count for the UI, then attempt anything left over
    // from a previous run.
    await SosQueue.pending();
    unawaited(drain());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(drain());
  }

  Future<void> dispose() async {
    await _connectivitySub?.cancel();
    _connectivitySub = null;
    WidgetsBinding.instance.removeObserver(this);
    _started = false;
  }

  /// Tries to deliver every queued alert, oldest first.
  ///
  /// Oldest first is deliberate: if only one write gets through before signal
  /// drops again, it should be the emergency that has been waiting longest.
  Future<void> drain() async {
    if (_draining) return;
    _draining = true;
    try {
      final items = await SosQueue.pending();
      if (items.isEmpty) return;

      final ordered = [...items]
        ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));

      for (final payload in ordered) {
        final result = await redeliver(payload);
        if (result != SosDelivery.pending) {
          // Delivered, or REFUSED: the server will never accept this alert
          // (the account is not verified), so retrying it on every resume
          // and every connectivity change would only be a loop that can
          // never end. It leaves the queue either way.
          if (result == SosDelivery.refused) {
            debugPrint('SOS refused by the server, dropped from the queue '
                '(${payload.alertId})');
          }
          await SosQueue.remove(payload.alertId);
        } else {
          await SosQueue.recordAttempt(payload.alertId);
          // Still no route out. Stop rather than burning the rest of the queue
          // against the same dead network; the next trigger will try again.
          break;
        }
      }
    } finally {
      _draining = false;
    }
  }

  /// The first delivery attempt, made the moment the countdown fires.
  ///
  /// A plain `set` goes into Firestore's own offline persistence, so even if
  /// this call times out the SDK keeps its own copy and may deliver it before
  /// [drain] ever runs — a second, independent route out that costs nothing
  /// to keep. A timeout reports [SosDelivery.pending] even though the write
  /// may still land later, and that ambiguity is harmless: every retry
  /// targets the same document id.
  static Future<SosDelivery> deliverFirst(SosPayload payload) =>
      _deliver(payload, queued: false);

  /// A retry from the queue.
  ///
  /// -- WHY THIS IS NO LONGER A TRANSACTION --
  /// It used to read the document inside a transaction and write only into
  /// a genuine absence, so a late retry could never overwrite an alert a
  /// guard had already acknowledged. But firestore.rules lets a resident read
  /// an alert only through `resource.data.residentUid`, which DENIES a read
  /// of a document that does not exist yet. The transaction's first read was
  /// therefore refused every time the retry was actually needed, and the
  /// queue could never drain by this route. (Confirmed against the emulator
  /// 2026-10-18.)
  ///
  /// The same guarantee now comes from the rules themselves: only security
  /// staff may UPDATE a panic alert, so a resident's `set` on a document that
  /// already exists is refused rather than applied. Nothing a guard wrote can
  /// be overwritten from here. See [_deliver] for how that refusal is told
  /// apart from a genuine one.
  static Future<SosDelivery> redeliver(SosPayload payload) =>
      _deliver(payload, queued: true);

  static Future<SosDelivery> _deliver(
    SosPayload payload, {
    required bool queued,
  }) {
    final ref = FirebaseFirestore.instance
        .collection(PanicAlertService.collection)
        .doc(payload.alertId);
    return deliverWith(
      alertId: payload.alertId,
      write: () => ref.set(payload.toFirestore(queued: queued)),
      // From the SERVER, never the cache: a cached copy could be this very
      // write, still pending, and would read as "already delivered".
      exists: () async =>
          (await ref.get(const GetOptions(source: Source.server))).exists,
      timeout: ackTimeout,
    );
  }

  /// The delivery decision, with the two Firestore calls injected so it can
  /// be tested without a Firebase app.
  ///
  /// -- PERMISSION-DENIED MEANS ONE OF TWO THINGS --
  ///   1. The account may not raise alerts (firestore.rules requires a
  ///      verified resident to CREATE one): [SosDelivery.refused].
  ///   2. The document already exists, so the `set` was an UPDATE, which only
  ///      security staff may make. The alert landed earlier, through
  ///      Firestore's own queue or a previous attempt: [SosDelivery.delivered].
  /// One server read separates them. The resident may read their own alert
  /// only once it exists, so a successful read means (2), and a refused read
  /// means there is nothing there to read, so (1).
  ///
  /// Anything else that goes wrong (a timeout, no network, a server error)
  /// is [SosDelivery.pending]. Only an explicit refusal is ever final.
  @visibleForTesting
  static Future<SosDelivery> deliverWith({
    required String alertId,
    required Future<void> Function() write,
    required Future<bool> Function() exists,
    required Duration timeout,
  }) async {
    try {
      await write().timeout(timeout);
      return SosDelivery.delivered;
    } on FirebaseException catch (e) {
      if (e.code != 'permission-denied') {
        debugPrint('SOS delivery not acknowledged ($alertId): $e');
        return SosDelivery.pending;
      }
    } catch (e) {
      debugPrint('SOS delivery not acknowledged ($alertId): $e');
      return SosDelivery.pending;
    }

    // Permission denied on the write. Which of the two?
    try {
      final there = await exists().timeout(timeout);
      return there ? SosDelivery.delivered : SosDelivery.refused;
    } on FirebaseException catch (e) {
      if (e.code == 'permission-denied') return SosDelivery.refused;
      return SosDelivery.pending;
    } catch (_) {
      // Could not ask. Not final: keep it queued and ask again later.
      return SosDelivery.pending;
    }
  }
}

/// What one delivery attempt established.
enum SosDelivery {
  /// The server has the alert: written now, or found already there.
  delivered,

  /// Not known yet (offline, timed out, server error). Stays queued.
  pending,

  /// The server will never accept it: the account may not raise alerts.
  refused,
}
