import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

enum IncidentPriority { low, medium, high, critical }

enum IncidentStatus {
  pending,
  verifying,
  dispatched,
  inProgress,
  resolved,
  closed,
  falseAlarm,
}

/// Wire (Firestore) representation of [IncidentStatus] — snake_case to match
/// the values the admin/security backend writes and queries against
/// (`backend/src/controllers/incident.controller.js` `INCIDENT_STATUS`).
/// Kept separate from the Dart enum name so the enum itself can stay
/// idiomatic Dart identifiers.
extension IncidentStatusWire on IncidentStatus {
  String get wireValue {
    switch (this) {
      case IncidentStatus.pending:
        return 'pending';
      case IncidentStatus.verifying:
        return 'verifying';
      case IncidentStatus.dispatched:
        return 'dispatched';
      case IncidentStatus.inProgress:
        return 'in_progress';
      case IncidentStatus.resolved:
        return 'resolved';
      case IncidentStatus.closed:
        return 'closed';
      case IncidentStatus.falseAlarm:
        return 'false_alarm';
    }
  }

  static IncidentStatus fromWire(String? value) {
    switch (value) {
      case 'verifying':
        return IncidentStatus.verifying;
      case 'dispatched':
        return IncidentStatus.dispatched;
      case 'in_progress':
        return IncidentStatus.inProgress;
      case 'resolved':
        return IncidentStatus.resolved;
      case 'closed':
        return IncidentStatus.closed;
      case 'false_alarm':
        return IncidentStatus.falseAlarm;
      case 'pending':
      default:
        return IncidentStatus.pending;
    }
  }
}

class Incident {
  final String id;
  final String title;
  final String category;
  final String phase;
  final String block;
  final String lot;
  final String description;
  final DateTime reportedAt;
  final IncidentPriority priority;
  final IncidentStatus status;
  final String reporter;
  final String reporterUid;
  final bool hasMedia;
  final List<String> photoUrls;
  final List<String> videoUrls;
  final double? latitude;
  final double? longitude;

  /// Response metadata written by the web command centers (never by this
  /// app) — `updateIncidentStatus` and the Manual Dispatch panel in
  /// web-portal stamp these when a guard/admin acts on the report. Parsing
  /// them here is what lets the resident's tracking timeline show *who*
  /// responded and *when*, instead of generic placeholder copy.
  final String assignedGuardName;
  final String assignedGuardUid;

  /// Stamped on the transition INTO each state by the web command centres
  /// (`web-portal/src/shared/lib/incidents.js` `updateIncidentStatus`).
  ///
  /// All four are nullable and legitimately absent on older documents:
  /// `acknowledgedAt`/`onSceneAt` were added later than the other two, so a
  /// report dispatched before that change has a `dispatchedAt` and no
  /// `acknowledgedAt` even though it was self-evidently acknowledged first.
  /// The notification feed treats a missing stamp as "this happened but we
  /// cannot say when" and omits the tile — see ResidentNotification.
  final DateTime? acknowledgedAt;
  final DateTime? dispatchedAt;
  final DateTime? onSceneAt;
  final DateTime? resolvedAt;

  /// Stamped by the Guardhouse when an officer resolves the call (the
  /// Resolve stage in web-portal/apps/security-portal/src/lib/dispatchWorkflow.js).
  /// Its presence is what asks this app to prompt for a rating. Driven by the
  /// document rather than by the push, so a resident who missed the
  /// notification is still asked when they next open the app.
  final DateTime? ratingRequestedAt;

  /// The resident's own 1–5 rating of the response, once given. Written once:
  /// firestore.rules refuses a second rating.
  final int? residentRatingStars;

  const Incident({
    required this.id,
    required this.title,
    required this.category,
    required this.phase,
    required this.block,
    required this.lot,
    required this.description,
    required this.reportedAt,
    required this.priority,
    required this.status,
    required this.reporter,
    this.reporterUid = '',
    this.hasMedia = false,
    this.photoUrls = const [],
    this.videoUrls = const [],
    this.latitude,
    this.longitude,
    this.assignedGuardName = '',
    this.assignedGuardUid = '',
    this.acknowledgedAt,
    this.dispatchedAt,
    this.onSceneAt,
    this.resolvedAt,
    this.ratingRequestedAt,
    this.residentRatingStars,
  });

  /// Resolved, asked for a rating, and not yet rated.
  bool get awaitsRating =>
      ratingRequestedAt != null &&
      residentRatingStars == null &&
      (status == IncidentStatus.resolved || status == IncidentStatus.closed);

  String get location => 'Phase $phase • Block $block • Lot $lot';

  Map<String, dynamic> toFirestore() {
    return {
      'title': title,
      'category': category,
      'phase': phase,
      'block': block,
      'lot': lot,
      'propertyLabel': location,
      'description': description,
      // `reportedAt` is when the resident says it happened; `createdAt` is
      // the server-authoritative write time the admin/security dashboard
      // sorts on (backend/src/controllers/incident.controller.js
      // `listIncidents`) — keep both rather than overloading one field.
      'reportedAt': Timestamp.fromDate(reportedAt),
      'createdAt': FieldValue.serverTimestamp(),
      'priority': priority.name,
      'status': status.wireValue,
      'reporterName': reporter,
      'reporterUid': reporterUid,
      'hasMedia': hasMedia,
      'photoUrls': photoUrls,
      'videoUrls': videoUrls,
      if (latitude != null && longitude != null)
        'location': {'lat': latitude, 'lng': longitude},
      // Backfilled by the `onIncidentWrite` Cloud Function right after
      // create — see functions/index.js. Seeding 0 here just means the
      // freshly-submitted doc sorts last for the instant before that
      // trigger runs, instead of being excluded from ordered queries.
      'wpdaScore': 0,
    };
  }

  factory Incident.fromFirestore(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>;
    final loc = d['location'];
    final lat = loc is Map ? (loc['lat'] as num?)?.toDouble() : (d['latitude'] as num?)?.toDouble();
    final lng = loc is Map ? (loc['lng'] as num?)?.toDouble() : (d['longitude'] as num?)?.toDouble();
    return Incident(
      id: doc.id,
      title: d['title'] ?? '',
      category: d['category'] ?? '',
      phase: d['phase'] ?? '',
      block: d['block'] ?? '',
      lot: d['lot'] ?? '',
      description: d['description'] ?? '',
      reportedAt: (d['reportedAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      priority: IncidentPriority.values.firstWhere(
        (e) => e.name == d['priority'],
        orElse: () => IncidentPriority.medium,
      ),
      status: IncidentStatusWire.fromWire(d['status'] as String?),
      // Staff-created incidents (via the dashboard) store the reporter's
      // display name as `reporterName`; older/mobile docs used `reporter`.
      reporter: d['reporterName'] ?? d['reporter'] ?? '',
      reporterUid: d['reporterUid'] ?? '',
      hasMedia: d['hasMedia'] ?? false,
      photoUrls: List<String>.from(d['photoUrls'] ?? []),
      videoUrls: List<String>.from(d['videoUrls'] ?? []),
      latitude: lat,
      longitude: lng,
      assignedGuardName: d['assignedGuardName'] ?? '',
      assignedGuardUid: d['assignedGuardUid'] ?? '',
      acknowledgedAt: (d['acknowledgedAt'] as Timestamp?)?.toDate(),
      dispatchedAt: (d['dispatchedAt'] as Timestamp?)?.toDate(),
      onSceneAt: (d['onSceneAt'] as Timestamp?)?.toDate(),
      resolvedAt: (d['resolvedAt'] as Timestamp?)?.toDate(),
      ratingRequestedAt: (d['ratingRequestedAt'] as Timestamp?)?.toDate(),
      residentRatingStars: d['residentRating'] is Map
          ? ((d['residentRating'] as Map)['stars'] as num?)?.toInt()
          : null,
    );
  }
}

class IncidentPriorityInfo {
  static Color color(IncidentPriority p) {
    switch (p) {
      case IncidentPriority.critical:
        return const Color(0xFFEF4444);
      case IncidentPriority.high:
        return const Color(0xFFF97316);
      case IncidentPriority.medium:
        return const Color(0xFFFBBF24);
      case IncidentPriority.low:
        return const Color(0xFF60A5FA);
    }
  }

  static String label(IncidentPriority p) {
    switch (p) {
      case IncidentPriority.critical:
        return 'Critical';
      case IncidentPriority.high:
        return 'High';
      case IncidentPriority.medium:
        return 'Medium';
      case IncidentPriority.low:
        return 'Low';
    }
  }
}

class IncidentCategoryInfo {
  /// Outlined icon for an incident category — kept consistent everywhere a
  /// report is shown (cards, tiles, timeline) so the icon reflects the category
  /// rather than a generic shield.
  static IconData icon(String category) {
    switch (category.toLowerCase()) {
      case 'security':
        return PhosphorIconsFill.shield;
      case 'maintenance':
        return PhosphorIconsFill.wrench;
      case 'medical':
        return PhosphorIconsFill.firstAidKit;
      case 'hazard':
        return PhosphorIconsFill.warning;
      case 'fire':
        return PhosphorIconsFill.fire;
      case 'noise':
        return PhosphorIconsFill.speakerHigh;
      case 'flooding':
        return PhosphorIconsFill.drop;
      default:
        return PhosphorIconsFill.warningOctagon;
    }
  }
}

class IncidentStatusInfo {
  static Color color(IncidentStatus s) {
    switch (s) {
      case IncidentStatus.pending:
        return const Color(0xFFFBBF24);
      case IncidentStatus.verifying:
        return const Color(0xFF60A5FA);
      case IncidentStatus.dispatched:
        return const Color(0xFFA78BFA);
      case IncidentStatus.inProgress:
        return const Color(0xFF22D3EE);
      case IncidentStatus.resolved:
      case IncidentStatus.closed:
        return const Color(0xFF2DD4BF);
      case IncidentStatus.falseAlarm:
        return const Color(0xFF9CA3AF);
    }
  }

  static String label(IncidentStatus s) {
    switch (s) {
      case IncidentStatus.pending:
        return 'Pending';
      case IncidentStatus.verifying:
        return 'Verifying';
      case IncidentStatus.dispatched:
        return 'Dispatched';
      case IncidentStatus.inProgress:
        // Shared with both web consoles (2026-10-19): from Acknowledge &
        // respond, en route as well as on scene.
        return 'Dispatch in progress';
      case IncidentStatus.resolved:
        return 'Resolved';
      case IncidentStatus.closed:
        return 'Closed';
      case IncidentStatus.falseAlarm:
        return 'False Alarm';
    }
  }

  static IconData icon(IncidentStatus s) {
    switch (s) {
      case IncidentStatus.pending:
        return PhosphorIconsFill.hourglass;
      case IncidentStatus.verifying:
        return PhosphorIconsFill.sealCheck;
      case IncidentStatus.dispatched:
        return PhosphorIconsFill.paperPlaneTilt;
      case IncidentStatus.inProgress:
        return PhosphorIconsFill.arrowsClockwise;
      case IncidentStatus.resolved:
      case IncidentStatus.closed:
        return PhosphorIconsFill.checkCircle;
      case IncidentStatus.falseAlarm:
        return PhosphorIconsFill.xCircle;
    }
  }
}

/// The three questions the app asks about where a report is in its life, in
/// one place because they have three different answers and the enum invites
/// conflating them.
///
/// Seven statuses collapse into two buckets on screen (Active / Resolved), but
/// NOT the same two every time:
///
///   isTerminal  has it stopped moving?      resolved, closed, falseAlarm
///   isComplete  did it run all four stages? resolved, closed
///   isDeletable may the resident remove it? resolved, closed, falseAlarm
///
/// `falseAlarm` is the one that separates them, and it is the reason this
/// extension exists rather than three inline `== resolved` checks: a report
/// withdrawn as a mistake has stopped, so it belongs under Resolved and the
/// resident may delete it — but it never travelled the four stages, so drawing
/// its timeline as complete would claim a dispatch and a resolution that never
/// happened.
extension IncidentLifecycle on IncidentStatus {
  /// The report has stopped moving, however it stopped. This is the cut the
  /// History screen's Active / Resolved tabs make.
  ///
  /// Testing `== resolved` alone — which every call site used to do — left
  /// `closed` and `falseAlarm` parked under "Active" forever, so a report the
  /// command centre had shut never left the resident's open list.
  bool get isTerminal =>
      this == IncidentStatus.resolved ||
      this == IncidentStatus.closed ||
      this == IncidentStatus.falseAlarm;

  /// The report ran the full four-stage course. Drives the progress rail's
  /// completed-step count — see `ReportStatusTracker`.
  bool get isComplete =>
      this == IncidentStatus.resolved || this == IncidentStatus.closed;

  /// Whether the resident may delete this report from their history.
  ///
  /// ── WHY DELETION IS GATED AT ALL ──────────────────────────────────────────
  /// An open report is a live request to the HOA, not just a row in a personal
  /// list. Deleting one mid-response would leave the resident believing they
  /// had cancelled something they had not, and would drop the record on the one
  /// side of the exchange that still needs it. A finished report has no such
  /// obligation left, so removing it is genuinely the resident's call.
  ///
  /// Equal to [isTerminal] deliberately: the rule a resident actually sees is
  /// "anything under the Resolved tab", and a card sitting in that tab that
  /// refuses to delete would be the interface disagreeing with itself.
  bool get isDeletable => isTerminal;
}

extension IncidentStatusTracking on IncidentStatus {
  int get trackingStep {
    switch (this) {
      case IncidentStatus.pending:
        return 0;
      case IncidentStatus.verifying:
        return 1;
      case IncidentStatus.dispatched:
      case IncidentStatus.inProgress:
        return 2;
      case IncidentStatus.resolved:
      case IncidentStatus.closed:
      case IncidentStatus.falseAlarm:
        return 3;
    }
  }
}

class Announcement {
  final String id;
  final String title;
  final String body;
  final DateTime postedAt;
  final String author;
  final bool pinned;
  final String category;
  final String? imageUrl;

  const Announcement({
    required this.id,
    required this.title,
    required this.body,
    required this.postedAt,
    required this.author,
    this.pinned = false,
    this.category = 'General',
    this.imageUrl,
  });

  // Field names match what the admin/security dashboard actually writes
  // (backend/src/controllers/announcement.controller.js `createAnnouncement`):
  // `publishedAt`/`isPinned`/`authorName`/`type`, not the plainer
  // `postedAt`/`pinned`/`author`/`category` this used to read.
  factory Announcement.fromFirestore(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>;
    return Announcement(
      id: doc.id,
      title: d['title'] ?? '',
      body: d['body'] ?? '',
      postedAt: (d['publishedAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      author: d['authorName'] ?? d['author'] ?? '',
      pinned: d['isPinned'] ?? d['pinned'] ?? false,
      category: d['type'] ?? d['category'] ?? 'General',
      imageUrl: (d['imageUrl'] as String?)?.isNotEmpty == true
          ? d['imageUrl'] as String
          : null,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'title': title,
      'body': body,
      'publishedAt': Timestamp.fromDate(postedAt),
      'authorName': author,
      'isPinned': pinned,
      'type': category,
      'isArchived': false,
      if (imageUrl != null) 'imageUrl': imageUrl,
    };
  }
}
