import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_close_button.dart';
import 'package:monticello_villas_app/core/widgets/shared_widgets.dart'
    show showIncidentTimeline;
import 'package:monticello_villas_app/features/announcements/widgets/announcement_detail_sheet.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';

/// Opens a notification in full.
///
/// An announcement alert opens the announcement itself — the same modal the
/// feed card opens, with its full body and attachments — because that post is
/// what the alert is about. A report alert opens the same frame with what the
/// alert knows: what happened, when exactly, its status and who acted.
///
/// The announcement or report is looked up in the loaded feed by id. If it has since
/// been deleted, the alert's own text is shown instead rather than nothing.
Future<void> showNotificationDetail(
  BuildContext context,
  ResidentNotification notification,
) {
  if (notification.isAnnouncement) {
    for (final a in LocalDataStore.instance.announcements) {
      if (a.id == notification.sourceId) {
        return showAnnouncementDetail(context, a);
      }
    }
  } else {
    // A report alert opens THE REPORT — the same timeline sheet its card in
    // History opens, with every stage, the responder and the evidence — not
    // a copy of the alert's one-line text. The incident is the live
    // LocalDataStore row, so the sheet shows its current state rather than
    // the state at the moment this alert was derived.
    //
    // Guarded: the store needs a Firebase app, and without one (a widget test,
    // a failed bootstrap) the alert's own modal below is still a true answer.
    Incident? report;
    try {
      for (final incident in LocalDataStore.instance.incidents) {
        if (incident.id == notification.sourceId) report = incident;
      }
    } catch (_) {}
    if (report != null) {
      showIncidentTimeline(context, report);
      return Future.value();
    }
  }
  return showFocusModal(
    context,
    barrierLabel: 'Close notification',
    builder: (_) => NotificationDetailModal(notification: notification),
  );
}

class NotificationDetailModal extends StatelessWidget {
  const NotificationDetailModal({super.key, required this.notification});

  final ResidentNotification notification;

  @override
  Widget build(BuildContext context) {
    final n = notification;
    final statusLabel = n.statusLabel;
    final statusColor = n.statusColor ?? AppColors.textSecondary;

    return FocusModalFrame(
      header: Padding(
        padding: const EdgeInsets.fromLTRB(18, 14, 10, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: n.tint.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Icon(n.icon, size: 20, color: n.tint),
            ),
            const Spacer(),
            const ModernCloseButton(semanticLabel: 'Close notification'),
          ],
        ),
      ),
      body: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(18, 0, 18, 16),
        children: [
          Text(
            n.headline,
            style: sfPro(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
              letterSpacing: -0.4,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 8),
          // The exact moment, not "2h ago": someone quoting an update back to
          // the guardhouse needs the clock time.
          Row(
            children: [
              const Icon(PhosphorIconsFill.clock,
                  size: 13, color: AppColors.textMuted),
              const SizedBox(width: 5),
              Text(
                DateFormat("MMM d, yyyy 'at' h:mm a").format(n.at.toLocal()),
                style: sfPro(fontSize: 12, color: AppColors.textMuted),
              ),
            ],
          ),
          if (statusLabel != null || !n.isAnnouncement) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (statusLabel != null)
                  _Chip(label: statusLabel, color: statusColor),
                if (!n.isAnnouncement)
                  _Chip(
                    label: n.guardTag,
                    color: AppColors.textSecondary,
                    icon: PhosphorIconsFill.shieldCheck,
                  ),
              ],
            ),
          ],
          const SizedBox(height: 16),
          SelectableText(
            n.detail,
            style: sfPro(
              fontSize: 14.5,
              color: AppColors.textSecondary,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.color, this.icon});

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: sfPro(fontSize: 12, fontWeight: FontWeight.w700, color: color),
          ),
        ],
      ),
    );
  }
}
