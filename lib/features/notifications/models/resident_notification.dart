import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

/// Everything the notification drawer can tell a resident about.
///
/// Four security actions on their own reports, plus a heads-up that the HOA
/// published something. The list is closed — if a case is not here, it does
/// not belong in the drawer.
enum NotificationEvent {
  acknowledged,
  dispatched,
  onScene,
  resolved,
  announcementPublished,
}

/// The drawer's two time sections.
///
/// Split out of the screen so the rule can be tested without a Firestore-backed
/// widget tree — the boundary is the whole of the Facebook-style grouping, and
/// getting it one comparison wrong either marks everything unread forever or
/// never marks anything.
@immutable
class NotificationSections {
  const NotificationSections({required this.fresh, required this.earlier});

  /// Arrived since the drawer was last opened.
  final List<ResidentNotification> fresh;

  /// Everything else, still newest-first.
  final List<ResidentNotification> earlier;

  bool get isEmpty => fresh.isEmpty && earlier.isEmpty;

  /// Partitions [feed] around [boundary].
  ///
  /// STRICTLY after, not at-or-after. The boundary is the instant the drawer
  /// was last opened, so an alert carrying exactly that stamp was already on
  /// screen when it was read — counting it as New would resurface the last row
  /// of every visit on the next one.
  static NotificationSections split(
    List<ResidentNotification> feed,
    DateTime boundary,
  ) {
    final fresh = <ResidentNotification>[];
    final earlier = <ResidentNotification>[];
    for (final notification in feed) {
      if (notification.at.isAfter(boundary)) {
        fresh.add(notification);
      } else {
        earlier.add(notification);
      }
    }
    return NotificationSections(fresh: fresh, earlier: earlier);
  }
}

/// One alert in the notification drawer.
///
/// ── WHAT THIS FEED IS, AFTER THE ANNOUNCEMENT ALERTS ──────────────────────
/// It previously carried security actions ONLY, on the principle that a bell
/// ringing for a pool-maintenance notice trains people to ignore it. Publish
/// alerts are now included, and the principle survives intact because of the
/// shape they take:
///
///   the drawer tells you an announcement EXISTS.
///   the Announcements screen is where you READ it.
///
/// A publish alert is one line — "New Subdivision Announcement: {title}" — and
/// it does not reproduce the body, the image, or the category filter. So the
/// two surfaces still answer different questions ("what happened?" vs "what
/// was posted?") and the drawer does not become a second announcement feed.
///
/// ── WHY THIS IS DERIVED RATHER THAN STORED ────────────────────────────────
/// There is no `notifications` collection. Incident documents already carry
/// the stamps the command centres write when a guard acts (`acknowledgedAt`,
/// `dispatchedAt`, `onSceneAt`, `resolvedAt`, plus `assignedGuardName`), and
/// announcements carry `postedAt` — and [LocalDataStore] already holds live
/// streams of both, with incidents scoped to `reporterUid == currentUser`.
/// Deriving means no second source that can disagree, no fan-out write on a
/// status change, and correct history for anything filed before this existed.
///
/// ── WHY A MISSING STAMP DROPS THE TILE ────────────────────────────────────
/// `acknowledgedAt` and `onSceneAt` were added to the backend later than the
/// other two. A report dispatched before that change has a dispatch time and
/// no acknowledgement time, even though it was self-evidently acknowledged
/// first. Those tiles are omitted rather than back-filled: every tile states
/// that something happened at a specific moment, and inventing that moment
/// would put a false time on a security record a resident may quote back to
/// the guardhouse. An absent tile is a gap; a fabricated one is a lie.
@immutable
class ResidentNotification {
  const ResidentNotification({
    required this.event,
    required this.at,
    required this.sourceId,
    required this.headline,
    required this.detail,
    required this.tint,
    required this.icon,
    this.statusLabel,
    this.statusColor,
    this.guardName = '',
  });

  final NotificationEvent event;

  /// When the thing happened — never when the resident's report was filed.
  final DateTime at;

  /// Incident or announcement document id. Used ONLY as a list key and for
  /// de-duplication; it is deliberately never rendered. See the class note on
  /// data cleanup below.
  final String sourceId;

  final String headline;
  final String detail;
  final Color tint;
  final IconData icon;

  /// Report lifecycle pill. Null for announcement alerts — an announcement has
  /// no status, and showing "Published" would invent a lifecycle it does not
  /// have.
  final String? statusLabel;
  final Color? statusColor;

  /// Empty for announcements and for actions with no stamped responder.
  final String guardName;

  /// Stable key. Event + source can only occur once.
  String get id => '$sourceId:${event.name}';

  bool get isAnnouncement => event == NotificationEvent.announcementPublished;

  /// Who acted, for the guard tag. Falls back to the post rather than a
  /// person: an unattributed dispatch still came from the guardhouse, and a
  /// blank tag would read as a rendering bug.
  String get guardTag => guardName.trim().isEmpty ? 'Guardhouse' : guardName.trim();

  // ── DATA CLEANUP ─────────────────────────────────────────────────────────
  //
  // There is deliberately no `reference` getter here any more. Tiles used to
  // carry an `MV-A1B2C3D4` chip derived from the Firestore document id, which
  // is precisely the "raw, developer-facing system ID" the spec calls out.
  //
  // What replaced it: the detail line names the report in plain language
  // ("Pool gate left open"), which is how a resident actually identifies their
  // own report. The document id is still reachable from the incident detail
  // screen for anyone who genuinely needs it to talk to the guardhouse — it is
  // just no longer the first thing in a notification.
  //
  // If a human-quotable reference is wanted back in the drawer later, it
  // should be a SHORT SEQUENTIAL number the backend assigns ("Report #14"),
  // not a slice of a UUID.

  /// Every stamped security action on one report, plus nothing else.
  ///
  /// A report nobody has touched yet produces an empty list, which is correct:
  /// "you filed a report" is not a notification — the resident was there.
  static List<ResidentNotification> _forIncident(Incident incident) {
    ResidentNotification build({
      required NotificationEvent event,
      required DateTime at,
      required String headline,
      required String detail,
      required Color tint,
      required IconData icon,
    }) {
      return ResidentNotification(
        event: event,
        at: at,
        sourceId: incident.id,
        headline: headline,
        detail: detail,
        tint: tint,
        icon: icon,
        statusLabel: _statusLabel(incident.status),
        statusColor: _statusColor(incident.status),
        guardName: incident.assignedGuardName,
      );
    }

    final subject =
        incident.title.trim().isEmpty ? 'your report' : incident.title.trim();
    final guard = incident.assignedGuardName.trim();

    return <ResidentNotification>[
      if (incident.acknowledgedAt != null)
        build(
          event: NotificationEvent.acknowledged,
          at: incident.acknowledgedAt!,
          headline: 'Security Has Acknowledged Your Report',
          detail: 'The guardhouse has seen $subject and is verifying the details.',
          tint: AppColors.textSecondary,
          icon: PhosphorIconsFill.eye,
        ),
      if (incident.dispatchedAt != null)
        build(
          event: NotificationEvent.dispatched,
          at: incident.dispatchedAt!,
          headline: guard.isEmpty
              ? 'Guard Dispatched to Location'
              : 'Guard $guard Dispatched to Location',
          detail: 'A responder is on the way to ${incident.location}.',
          tint: AppColors.info,
          icon: PhosphorIconsFill.paperPlaneTilt,
        ),
      if (incident.onSceneAt != null)
        build(
          event: NotificationEvent.onScene,
          at: incident.onSceneAt!,
          headline: 'Responder On Scene',
          detail:
              'A responder has arrived at ${incident.location} and is handling $subject.',
          tint: AppColors.warning,
          icon: PhosphorIconsFill.mapPin,
        ),
      if (incident.resolvedAt != null)
        build(
          event: NotificationEvent.resolved,
          at: incident.resolvedAt!,
          headline: 'Your Report Has Been Resolved',
          detail: '$subject has been closed out by the guardhouse.',
          tint: AppColors.success,
          icon: PhosphorIconsFill.checkCircle,
        ),
    ];
  }

  static ResidentNotification _forAnnouncement(Announcement announcement) {
    final title = announcement.title.trim();
    return ResidentNotification(
      event: NotificationEvent.announcementPublished,
      at: announcement.postedAt,
      sourceId: announcement.id,
      // The spec's copy, verbatim. The title is the payload — a resident
      // decides whether to open the feed based on it alone.
      headline: 'New Subdivision Announcement: '
          '${title.isEmpty ? 'Untitled' : title}',
      detail: announcement.author.trim().isEmpty
          ? 'Posted to the community announcements feed.'
          : 'Posted by ${announcement.author.trim()}.',
      tint: AppColors.primary,
      icon: PhosphorIconsFill.megaphone,
      guardName: '',
    );
  }

  /// The whole drawer, newest first.
  ///
  /// [incidents] is expected to be [LocalDataStore.incidents], which Firestore
  /// already filters to `reporterUid == currentUser.uid` — so this cannot leak
  /// another resident's dispatch history. That guarantee lives in the query,
  /// not here, which is worth knowing before anyone reuses this for a
  /// staff-facing view.
  ///
  /// CAPPED. Announcements are subdivision-wide and unbounded over time, so an
  /// uncapped merge would eventually turn the drawer into an announcement
  /// archive with a handful of dispatch alerts buried in it — the exact
  /// dilution this feed was separated out to avoid. The cap is on the merged,
  /// time-sorted list rather than per-source, so a busy week of security
  /// activity is never pushed out by old notices.
  static const int maxItems = 40;

  static List<ResidentNotification> build({
    required List<Incident> incidents,
    required List<Announcement> announcements,
  }) {
    final all = <ResidentNotification>[
      for (final incident in incidents) ..._forIncident(incident),
      for (final announcement in announcements) _forAnnouncement(announcement),
    ];
    all.sort((a, b) => b.at.compareTo(a.at));
    return all.length <= maxItems ? all : all.sublist(0, maxItems);
  }

  static String _statusLabel(IncidentStatus status) {
    switch (status) {
      case IncidentStatus.pending:
        return 'Pending';
      case IncidentStatus.verifying:
        return 'Verifying';
      case IncidentStatus.dispatched:
        return 'Dispatched';
      case IncidentStatus.inProgress:
        return 'On Scene';
      case IncidentStatus.resolved:
        return 'Resolved';
      case IncidentStatus.closed:
        return 'Closed';
      case IncidentStatus.falseAlarm:
        return 'False Alarm';
    }
  }

  static Color _statusColor(IncidentStatus status) {
    switch (status) {
      case IncidentStatus.pending:
      case IncidentStatus.verifying:
        return AppColors.warning;
      case IncidentStatus.dispatched:
        return AppColors.info;
      case IncidentStatus.inProgress:
        return AppColors.warning;
      case IncidentStatus.resolved:
      case IncidentStatus.closed:
        return AppColors.success;
      case IncidentStatus.falseAlarm:
        return AppColors.textMuted;
    }
  }
}
