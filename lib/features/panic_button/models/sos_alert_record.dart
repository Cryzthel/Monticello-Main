import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';

/// Where an SOS alert stands, in the words the resident sees.
///
/// The guardhouse writes `status` through three values (see the SOS state
/// machine in web-portal/packages/shared/src/lib/panicAlerts.js):
///
///   active        → [dispatched]          the guardhouse has the alert
///   acknowledged  → [inProgress]          a guard took it and is responding
///   resolved      → [resolved]            closed out, with optional notes
///
/// [waiting] is the phone's own state: queued here for want of a connection,
/// not on the server yet.
enum SosStage {
  waiting,
  dispatched,
  inProgress,
  resolved;

  String get label => switch (this) {
        SosStage.waiting => 'Waiting for signal',
        SosStage.dispatched => 'Dispatched',
        SosStage.inProgress => 'Dispatch in progress',
        SosStage.resolved => 'Resolved',
      };

  /// 0-based position on the three-step timeline; waiting sits before it.
  int get step => switch (this) {
        SosStage.waiting => -1,
        SosStage.dispatched => 0,
        SosStage.inProgress => 1,
        SosStage.resolved => 2,
      };

  bool get isOpen => this != SosStage.resolved;
}

/// One SOS alert the resident raised, from `panic_alerts/{id}` or the queue.
@immutable
class SosAlertRecord {
  const SosAlertRecord({
    required this.id,
    required this.stage,
    required this.raisedAt,
    this.receivedAt,
    this.respondedAt,
    this.respondedBy,
    this.resolvedAt,
    this.resolutionNotes,
    this.place,
    this.lat,
    this.lng,
    this.deliveredOffline = false,
  });

  final String id;
  final SosStage stage;

  /// When the resident pressed SOS (the phone's clock).
  final DateTime raisedAt;

  /// When the server received it; null while waiting or not yet stamped.
  final DateTime? receivedAt;
  final DateTime? respondedAt;
  final String? respondedBy;
  final DateTime? resolvedAt;
  final String? resolutionNotes;

  /// "Phase 2 • Block 7 • Lot 14".
  final String? place;
  final double? lat;
  final double? lng;

  /// Sent from the queue after a spell without signal.
  final bool deliveredOffline;

  factory SosAlertRecord.fromFirestore(DocumentSnapshot<Map<String, dynamic>> snap) {
    final d = snap.data() ?? const <String, dynamic>{};
    final status = d['status'] as String?;
    final resolvedAt = _date(d['resolvedAt']);
    final respondedAt = _date(d['acknowledgedAt']);
    final stage = status == 'resolved' || resolvedAt != null
        ? SosStage.resolved
        : status == 'acknowledged' || respondedAt != null
            ? SosStage.inProgress
            : SosStage.dispatched;
    final location = d['location'];
    final resolution = d['resolution'];
    final notes = resolution is Map ? (resolution['notes'] as String?)?.trim() : null;
    final name = (d['acknowledgedByName'] as String?)?.trim();
    final label = (d['propertyLabel'] as String?)?.trim();
    return SosAlertRecord(
      id: snap.id,
      stage: stage,
      raisedAt: _date(d['occurredAt']) ?? _date(d['createdAt']) ?? DateTime.now(),
      receivedAt: _date(d['createdAt']),
      respondedAt: respondedAt,
      respondedBy: (name?.isNotEmpty ?? false) ? name : null,
      resolvedAt: resolvedAt,
      resolutionNotes: (notes?.isNotEmpty ?? false) ? notes : null,
      place: (label?.isNotEmpty ?? false) ? label : _place(d),
      lat: location is Map ? (location['lat'] as num?)?.toDouble() : null,
      lng: location is Map ? (location['lng'] as num?)?.toDouble() : null,
      deliveredOffline: d['deliveredOffline'] == true,
    );
  }

  /// An alert still in the encrypted queue on this phone.
  factory SosAlertRecord.queued(SosPayload p) => SosAlertRecord(
        id: p.alertId,
        stage: SosStage.waiting,
        raisedAt: p.capturedAt,
        place: (p.propertyLabel?.isNotEmpty ?? false)
            ? p.propertyLabel
            : 'Phase ${p.propertyPhase} • Block ${p.propertyBlock} • Lot ${p.propertyLot}',
        lat: p.lat,
        lng: p.lng,
      );

  static String? _place(Map<String, dynamic> d) {
    final phase = d['propertyPhase'], block = d['propertyBlock'], lot = d['propertyLot'];
    if ([phase, block, lot].every((v) => v == null || '$v'.isEmpty)) return null;
    return 'Phase ${phase ?? '–'} • Block ${block ?? '–'} • Lot ${lot ?? '–'}';
  }

  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return null;
  }

  /// When [stage] (as a timeline step) happened, if known.
  DateTime? timeOf(SosStage s) => switch (s) {
        SosStage.waiting => raisedAt,
        SosStage.dispatched => receivedAt ?? raisedAt,
        SosStage.inProgress => respondedAt,
        SosStage.resolved => resolvedAt,
      };
}

/// Newest first, with alerts still queued on the phone merged in (a queued
/// alert that has since reached the server is shown once, from the server).
List<SosAlertRecord> mergeSosHistory(List<SosAlertRecord> server, List<SosAlertRecord> queued) {
  final ids = server.map((r) => r.id).toSet();
  return [...server, ...queued.where((q) => !ids.contains(q.id))]
    ..sort((a, b) => b.raisedAt.compareTo(a.raisedAt));
}
