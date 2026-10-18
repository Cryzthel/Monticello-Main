import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';

/// Everything the guardhouse needs to respond, captured at the instant the
/// resident pressed the button and serialisable so it survives the app dying.
///
/// WHY THIS EXISTS SEPARATELY FROM THE FIRESTORE WRITE. The alert used to be
/// built inline inside `PanicAlertService.dispatch` and handed straight to
/// `collection.add()`. That is fine while there is signal and impossible
/// without it: an inline map cannot be written to disk, cannot be retried
/// after a restart, and cannot be rendered into an SMS. Making the payload a
/// value with a codec is what lets the same emergency travel over Firestore,
/// over the encrypted queue, and over SMS without three descriptions of it
/// drifting apart.
class SosPayload {
  const SosPayload({
    required this.alertId,
    required this.residentUid,
    required this.residentName,
    required this.residentPhone,
    required this.propertyPhase,
    required this.propertyBlock,
    required this.propertyLot,
    required this.propertyLabel,
    required this.capturedAt,
    required this.emergencyType,
    this.lat,
    this.lng,
    this.attempts = 0,
  });

  /// Client-generated, and the Firestore document id this alert is written to.
  ///
  /// THIS IS THE DUPLICATE GUARD. Offline there are two independent things
  /// trying to deliver the same emergency: Firestore's own write queue, which
  /// syncs whenever it likes, and [SosQueue], which retries on reconnect. With
  /// `collection.add()` each of those produces its OWN document, so a resident
  /// who pressed the button once in a dead spot pages security twice — and a
  /// dispatcher cannot tell a duplicate from a second emergency at the same
  /// address. Writing to a deterministic id with `set()` makes every delivery
  /// path idempotent: whichever arrives first wins, the rest are no-ops.
  final String alertId;

  final String residentUid;
  final String residentName;
  final String residentPhone;
  final String propertyPhase;
  final String propertyBlock;
  final String propertyLot;
  final String? propertyLabel;

  /// When the resident actually pressed the button — NOT when this reached a
  /// server. See the note on [toFirestore] for why the difference matters.
  final DateTime capturedAt;

  /// 'general' unless a surface offers a category. Carried through every
  /// channel so the portal's emergency-type colouring works on a queued alert
  /// exactly as it does on a live one.
  final String emergencyType;

  final double? lat;
  final double? lng;

  /// How many delivery attempts this payload has survived. Diagnostic only —
  /// nothing gives up on an emergency because it has been retried too often.
  final int attempts;

  bool get hasLocation => lat != null && lng != null;

  SosPayload withAttempt() => SosPayload(
        alertId: alertId,
        residentUid: residentUid,
        residentName: residentName,
        residentPhone: residentPhone,
        propertyPhase: propertyPhase,
        propertyBlock: propertyBlock,
        propertyLot: propertyLot,
        propertyLabel: propertyLabel,
        capturedAt: capturedAt,
        emergencyType: emergencyType,
        lat: lat,
        lng: lng,
        attempts: attempts + 1,
      );

  Map<String, dynamic> toJson() => {
        'alertId': alertId,
        'residentUid': residentUid,
        'residentName': residentName,
        'residentPhone': residentPhone,
        'propertyPhase': propertyPhase,
        'propertyBlock': propertyBlock,
        'propertyLot': propertyLot,
        'propertyLabel': propertyLabel,
        'capturedAt': capturedAt.toUtc().toIso8601String(),
        'emergencyType': emergencyType,
        'lat': lat,
        'lng': lng,
        'attempts': attempts,
      };

  static SosPayload fromJson(Map<String, dynamic> json) => SosPayload(
        alertId: json['alertId'] as String,
        residentUid: json['residentUid'] as String? ?? '',
        residentName: json['residentName'] as String? ?? '',
        residentPhone: json['residentPhone'] as String? ?? '',
        propertyPhase: json['propertyPhase'] as String? ?? '',
        propertyBlock: json['propertyBlock'] as String? ?? '',
        propertyLot: json['propertyLot'] as String? ?? '',
        propertyLabel: json['propertyLabel'] as String?,
        capturedAt:
            DateTime.tryParse(json['capturedAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
        emergencyType: json['emergencyType'] as String? ?? 'general',
        lat: (json['lat'] as num?)?.toDouble(),
        lng: (json['lng'] as num?)?.toDouble(),
        attempts: (json['attempts'] as num?)?.toInt() ?? 0,
      );

  static String encodeList(List<SosPayload> items) =>
      jsonEncode(items.map((e) => e.toJson()).toList());

  static List<SosPayload> decodeList(String raw) {
    if (raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return decoded
          .whereType<Map<String, dynamic>>()
          .map(SosPayload.fromJson)
          .toList();
    } catch (_) {
      // A corrupt queue must not brick the SOS button. Losing a stale queued
      // alert is bad; refusing to raise a new one is worse.
      return const [];
    }
  }
}

extension SosPayloadWire on SosPayload {
  /// The Firestore document, matching the schema `onPanicAlertCreate` and the
  /// security portal already read.
  ///
  /// ── WHY `createdAt` IS NOT ALWAYS A SERVER TIMESTAMP ──────────────────
  /// It used to be `FieldValue.serverTimestamp()` unconditionally, which is
  /// the right answer for an alert that reaches the server the moment it is
  /// raised. It is the wrong answer — and a dangerous one — for an alert that
  /// sat in a dead spot for twenty minutes: the server stamps the moment it
  /// finally synced, so the dispatch map shows a twenty-minute-old emergency
  /// as breaking news, and the queue jumps ahead of alerts that really are
  /// newer. A dispatcher triaging by recency would work it in the wrong order.
  ///
  /// So a delayed alert carries the time the resident pressed the button, and
  /// only a live one takes the server's clock. `occurredAt` records the
  /// capture time on every alert either way, and `deliveredOffline` /
  /// `queuedForSeconds` say plainly what happened, so the portal can show "held
  /// 20 min, no signal" rather than leaving a dispatcher to infer it.
  Map<String, dynamic> toFirestore({required bool queued}) {
    // Clamped, because a device clock running ahead of real time makes this
    // negative — and "held for -4h" on a dispatcher's screen is worse than no
    // number at all. Skew is not hypothetical on phones that have been offline
    // long enough to matter, which is exactly the population this field
    // describes.
    final heldForSeconds =
        DateTime.now().difference(capturedAt).inSeconds.clamp(0, 1 << 31);
    return {
      'residentUid': residentUid,
      'residentName': residentName,
      'residentPhone': residentPhone,
      'propertyPhase': propertyPhase,
      'propertyBlock': propertyBlock,
      'propertyLot': propertyLot,
      'propertyLabel': propertyLabel,
      if (hasLocation) 'location': {'lat': lat, 'lng': lng},
      'triggerType': 'app',
      'emergencyType': emergencyType,
      'status': 'active',
      'acknowledgedBy': null,
      'acknowledgedByName': null,
      'acknowledgedAt': null,
      'resolvedAt': null,
      'occurredAt': Timestamp.fromDate(capturedAt),
      'deliveredOffline': queued,
      'queuedForSeconds': queued ? heldForSeconds : 0,
      'createdAt': queued
          ? Timestamp.fromDate(capturedAt)
          : FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }

  /// The same emergency rendered for a 160-character world.
  ///
  /// Ordered by what a guard needs first and truncated from the back, so a
  /// carrier that splits or clips the message still delivers the address. The
  /// coordinates go last because they are the one part the property record
  /// already substitutes for.
  String toSmsBody() {
    final where = propertyLabel?.isNotEmpty == true
        ? propertyLabel!
        : 'Ph $propertyPhase Blk $propertyBlock Lot $propertyLot';
    final at = capturedAt.toLocal();
    final hh = at.hour.toString().padLeft(2, '0');
    final mm = at.minute.toString().padLeft(2, '0');
    final parts = <String>[
      'SOS Monticello Villas',
      residentName.isEmpty ? 'Resident' : residentName,
      where,
      'at $hh:$mm',
      if (residentPhone.isNotEmpty) residentPhone,
      if (hasLocation) '${lat!.toStringAsFixed(5)},${lng!.toStringAsFixed(5)}',
      'Ref $alertId',
    ];
    return parts.join(' | ');
  }
}
