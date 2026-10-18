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
        final delivered = await redeliver(payload);
        if (delivered) {
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

  /// The first delivery attempt: a plain `set` on a document id that, by
  /// construction, does not exist yet.
  ///
  /// Plain and not transactional on purpose. A `set` goes into Firestore's own
  /// offline persistence, so even if this call times out the SDK keeps its own
  /// copy and may deliver it before [drain] ever runs — a second, independent
  /// route out that costs nothing to keep. A transaction would need a server
  /// round-trip and would queue nothing at all.
  ///
  /// Returns true only on server acknowledgement. A timeout returns false even
  /// though the write may still land later, and that ambiguity is harmless:
  /// every retry targets the same document id.
  static Future<bool> deliverFirst(SosPayload payload) async {
    try {
      await FirebaseFirestore.instance
          .collection(PanicAlertService.collection)
          .doc(payload.alertId)
          .set(payload.toFirestore(queued: false))
          .timeout(ackTimeout);
      return true;
    } catch (e) {
      debugPrint('SOS delivery not acknowledged (${payload.alertId}): $e');
      return false;
    }
  }

  /// A retry, guarded so it cannot undo work the guardhouse has already done.
  ///
  /// THIS IS WHY IT IS NOT JUST `set(..., merge: true)`. A queued alert can be
  /// delivered by Firestore's own cache, acknowledged by a guard, and only
  /// then reach [drain] — which would merge `status: 'active'` and null
  /// acknowledgement fields straight back over the top. The alert would
  /// reappear on the dispatch map as unhandled, and the guard who took it
  /// would be erased from the record.
  ///
  /// The transaction reads first and writes only into a genuine absence, so a
  /// late retry of an already-delivered alert is a no-op instead of a
  /// regression. Transactions need a server round-trip, so this cannot succeed
  /// offline — which is correct here, and the timeout catches it either way.
  static Future<bool> redeliver(SosPayload payload) async {
    final ref = FirebaseFirestore.instance
        .collection(PanicAlertService.collection)
        .doc(payload.alertId);
    try {
      await FirebaseFirestore.instance.runTransaction((tx) async {
        final snapshot = await tx.get(ref);
        if (snapshot.exists) return;
        tx.set(ref, payload.toFirestore(queued: true));
      }).timeout(ackTimeout);
      return true;
    } catch (e) {
      debugPrint('SOS redelivery not acknowledged (${payload.alertId}): $e');
      return false;
    }
  }
}
