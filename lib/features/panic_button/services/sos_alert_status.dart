import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'package:monticello_villas_app/features/panic_button/services/panic_alert_service.dart';

/// What has actually happened to one raised alert, right now.
///
/// ── EVERY FIELD IS READ OFF THE ALERT DOCUMENT ───────────────────────────
///
/// This exists so the post-countdown screen can show a live tracker without
/// inventing any of it. The old success view said "Security has been notified
/// — ETA 2 minutes", and the two minutes was a hard-coded constant: nothing in
/// this app has ever known an ETA. A tracker is a much stronger promise than a
/// sentence is, so it can only be built out of state a guard actually wrote.
///
/// Three of those exist on `panic_alerts/{alertId}`, and each is set by a real
/// action somewhere:
///   • the write reaching the server        -> [serverAcknowledged]
///   • an operator pressing Dispatch        -> [respondedBy] / [respondedAt]
///   • an operator pressing Resolve         -> [resolvedAt]
///
/// Nothing else is displayed, and in particular nothing is extrapolated from a
/// timestamp. If a guard has not touched the alert, the tracker says so.
@immutable
class SosAlertStatus {
  const SosAlertStatus({
    this.serverAcknowledged = false,
    this.respondedBy,
    this.respondedAt,
    this.resolvedAt,
  });

  /// The alert document exists on the SERVER — not merely in this device's
  /// Firestore cache.
  ///
  /// The distinction is the whole point offline. A `set()` with no signal
  /// still lands in the local cache and a naive listener reads it straight
  /// back, so a resident in a dead spot would watch a tracker confidently tick
  /// "delivered" for an alert no guard can see. [hasPendingWrites] is what
  /// separates the two, and it is the reason this listens with
  /// `includeMetadataChanges` — without that flag the snapshot that flips
  /// pending -> acknowledged never arrives.
  final bool serverAcknowledged;

  /// The officer who took the alert, as recorded on the document by whichever
  /// portal dispatched it. Null until someone has.
  final String? respondedBy;
  final DateTime? respondedAt;

  /// Set when an operator closes the alert out.
  final DateTime? resolvedAt;

  bool get responded => respondedAt != null || (respondedBy?.isNotEmpty ?? false);
  bool get resolved => resolvedAt != null;

  static const SosAlertStatus unknown = SosAlertStatus();

  /// Reads one snapshot of the alert document.
  ///
  /// `acknowledgedByName` is preferred over `acknowledgedBy`: the first is the
  /// operator's name, the second their uid, and a resident has no use for a
  /// uid. A blank name is treated as no name rather than as an empty one, so
  /// the tracker falls back to "an officer" instead of rendering a gap.
  factory SosAlertStatus.fromSnapshot(
    DocumentSnapshot<Map<String, dynamic>> snap,
  ) {
    if (!snap.exists) {
      return SosAlertStatus(serverAcknowledged: !snap.metadata.hasPendingWrites);
    }
    final data = snap.data() ?? const <String, dynamic>{};
    final name = (data['acknowledgedByName'] as String?)?.trim();
    return SosAlertStatus(
      serverAcknowledged: !snap.metadata.hasPendingWrites,
      respondedBy: (name?.isNotEmpty ?? false) ? name : null,
      respondedAt: _asDate(data['acknowledgedAt']),
      resolvedAt: _asDate(data['resolvedAt']),
    );
  }

  static DateTime? _asDate(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return null;
  }

  @override
  bool operator ==(Object other) =>
      other is SosAlertStatus &&
      other.serverAcknowledged == serverAcknowledged &&
      other.respondedBy == respondedBy &&
      other.respondedAt == respondedAt &&
      other.resolvedAt == resolvedAt;

  @override
  int get hashCode =>
      Object.hash(serverAcknowledged, respondedBy, respondedAt, resolvedAt);
}

/// Builds the live status feed for one alert.
///
/// Injectable everywhere it is used, because the surfaces that display it are
/// exactly the surfaces that must be testable without a Firebase app — an
/// emergency countdown whose tests need a real project is an emergency
/// countdown nobody runs the tests for.
typedef SosStatusStream = Stream<SosAlertStatus> Function(String alertId);

/// The production [SosStatusStream].
///
/// Residents may read their own alert (`resource.data.residentUid ==
/// request.auth.uid` in firestore.rules), so this needs no privileged access
/// and no Cloud Function in front of it.
Stream<SosAlertStatus> watchSosAlert(String alertId) {
  try {
    return FirebaseFirestore.instance
        .collection(PanicAlertService.collection)
        .doc(alertId)
        // Metadata changes ARE the signal here — see [serverAcknowledged].
        .snapshots(includeMetadataChanges: true)
        .map(SosAlertStatus.fromSnapshot)
        // A permission error or a dropped listener must not take the sheet
        // down with it. The tracker degrades to "we know it was sent" and the
        // card's own copy still tells the resident what to do.
        .handleError((Object error) {
      debugPrint('SOS status listener failed ($alertId): $error');
    });
  } catch (error) {
    debugPrint('SOS status listener could not start ($alertId): $error');
    return const Stream<SosAlertStatus>.empty();
  }
}
