// Report actions: delete / locked dialogs, the timeline sheet and its summary.
// Split out of shared_widgets.dart (2026-10-20), which re-exports it.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/incident_status_widgets.dart';
import 'package:monticello_villas_app/features/media/widgets/media_viewer.dart';

/// Base dialog shell, so the delete prompt and the locked notice cannot drift
/// apart in radius, fill or typography.
Future<T?> _showReportDialog<T>(
  BuildContext context, {
  required String title,
  required Widget content,
  required List<Widget> Function(BuildContext ctx) actions,
}) {
  return showDialog<T>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: AppColors.backgroundSecondary,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.xl),
        side: const BorderSide(color: AppColors.innerStroke),
      ),
      title: Text(
        title,
        style: sfPro(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary),
      ),
      content: content,
      actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      actions: actions(ctx),
    ),
  );
}

TextStyle get _dialogBody =>
    sfPro(fontSize: 13.5, color: AppColors.textSecondary, height: 1.45);

/// Asks whether to delete [incident]. Returns false on dismiss or Cancel.
///
/// Answers a bool and does NOT write, so [Dismissible.confirmDismiss] can drive
/// the row's spring-back off the same prompt the long-press menu uses.
Future<bool> confirmReportDeletion(
    BuildContext context, Incident incident) async {
  final confirmed = await _showReportDialog<bool>(
    context,
    title: 'Delete report?',
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Are you sure you want to delete this resolved report from your '
          'history?',
          style: _dialogBody,
        ),
        const SizedBox(height: 10),
        // The consequence, kept separate from the question. A resident
        // answering "delete this from my history?" is picturing a list row,
        // not the photos they attached — and those go too.
        Text(
          'This permanently removes "${incident.title}" and its photo and '
          'video evidence. It can\'t be undone.',
          style: _dialogBody.copyWith(
              fontSize: 12.5, color: AppColors.textMuted),
        ),
      ],
    ),
    actions: (ctx) => [
      TextButton(
        onPressed: () => Navigator.of(ctx).pop(false),
        child: Text('Cancel',
            style: sfPro(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary)),
      ),
      ElevatedButton(
        onPressed: () => Navigator.of(ctx).pop(true),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.danger,
          foregroundColor: Colors.white,
          elevation: 0,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        child: Text('Delete',
            style: sfPro(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Colors.white)),
      ),
    ],
  );
  return confirmed ?? false;
}

/// Explains why an open report has no delete action.
///
/// Reached from the long-press path; the swipe path says the same thing by
/// simply not moving — an open card does not budge, which is the cheapest
/// possible "no" and needs no dialog at all.
Future<void> showReportLockedNotice(
    BuildContext context, Incident incident) {
  return _showReportDialog<void>(
    context,
    title: 'Report still open',
    content: Text(
      '"${incident.title}" is still being handled by the HOA. Reports can be '
      'deleted once they are resolved — until then this record stays so the '
      'response has something to track against.',
      style: _dialogBody,
    ),
    actions: (ctx) => [
      TextButton(
        onPressed: () => Navigator.of(ctx).pop(),
        child: Text('Got it',
            style: sfPro(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.primary)),
      ),
    ],
  );
}

/// Performs the delete and reports whether it landed.
///
/// The bool is load-bearing for the swipe path: [Dismissible] has already
/// animated the row out of the list by the time this runs, so a caller holding
/// an optimistic removal needs to know to put it back.
Future<bool> deleteReport(BuildContext context, Incident incident) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await LocalDataStore.instance.deleteIncident(incident);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.backgroundElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.innerStroke),
      ),
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
      content: Text('Report deleted',
          style: sfPro(
              color: AppColors.textPrimary, fontWeight: FontWeight.w500)),
    ));
    return true;
  } catch (_) {
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.danger,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
      content: Text('Could not delete the report. Please try again.',
          style: sfPro(color: Colors.white, fontWeight: FontWeight.w500)),
    ));
    return false;
  }
}

/// Long-press path: permission check, then confirm, then delete.
Future<void> confirmDeleteReport(
    BuildContext context, Incident incident) async {
  if (!incident.status.isDeletable) {
    return showReportLockedNotice(context, incident);
  }
  if (!await confirmReportDeletion(context, incident)) return;
  if (!context.mounted) return;
  await deleteReport(context, incident);
}

void showIncidentTimeline(BuildContext context, Incident incident) {
  showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (_) => _IncidentTimelineSheet(incident: incident),
  );
}

class _IncidentTimelineSheet extends StatelessWidget {
  final Incident incident;

  const _IncidentTimelineSheet({required this.incident});

  @override
  Widget build(BuildContext context) {
    final textPrimary = AppColors.onGlassPrimary;
    final textSecondary = AppColors.onGlassSecondary;
    final sColor = IncidentStatusInfo.color(incident.status);
    final pColor = IncidentPriorityInfo.color(incident.priority);
    final sheetRadius = const BorderRadius.vertical(
      top: Radius.circular(AppRadius.xl),
    );

    return DraggableScrollableSheet(
      initialChildSize: 0.72,
      minChildSize: 0.40,
      maxChildSize: 0.92,
      builder: (_, controller) => ClipRRect(
        borderRadius: sheetRadius,
        // ── SOLID WHITE, NO BLUR ────────────────────────────────────────────
        //
        // This was the last glassmorphic surface left in the app: a 24px
        // BackdropFilter over emerald at 35%, with slate text sitting on
        // whatever colour happened to be behind it. Every other container moved
        // to white-on-white several passes ago; this one survived because it
        // only appears on tap. It IS the background shift — open a report from
        // the white History list and the panel that slides up was dark green.
        //
        // Dropping the BackdropFilter also drops a full-screen blur pass from a
        // sheet that animates its own height on every drag.
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.background,
            borderRadius: sheetRadius,
            border: Border.all(color: AppColors.borderNeutralSoft),
          ),
            child: Column(
              children: [
                // ── Drag handle ─────────────────────────────────────────
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Container(
                    width: 38,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.borderNeutralStrong,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                  ),
                ),

            // ── Header ──────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Both pills are fill-only now, at the same alpha as the
                  // status badge on the History card these open from — the
                  // outline was a second, darker copy of the shade already
                  // filling them, and the two surfaces disagreed about whether
                  // a status pill has an edge.
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 11, vertical: 5),
                        decoration: BoxDecoration(
                          color: sColor.withValues(alpha: 0.16),
                          borderRadius:
                              BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          IncidentStatusInfo.label(incident.status),
                          style: sfPro(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: sColor,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 11, vertical: 5),
                        decoration: BoxDecoration(
                          color: pColor.withValues(alpha: 0.16),
                          borderRadius:
                              BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          IncidentPriorityInfo.label(incident.priority),
                          style: sfPro(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: pColor,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    incident.title,
                    style: sfPro(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: textPrimary,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(PhosphorIconsFill.mapPin,
                          size: 13, color: textSecondary),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          incident.location,
                          style: sfPro(
                              fontSize: 13, color: textSecondary),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            const Divider(
              height: 1,
              thickness: 1,
              color: AppColors.borderNeutralSoft,
            ),

            // ── Scrollable timeline body ─────────────────────────────
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
                children: [
                  Text(
                    'Status Timeline',
                    style: sfPro(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.onGlassMuted,
                      letterSpacing: 0.7,
                    ),
                  ),
                  const SizedBox(height: 20),
                  IncidentStatusTimeline(incident: incident),
                  if (incident.hasMedia ||
                      incident.photoUrls.isNotEmpty ||
                      incident.videoUrls.isNotEmpty) ...[
                    const SizedBox(height: 28),
                    EvidenceSection(incident: incident),
                  ],
                  const SizedBox(height: 28),
                  _ReportSummarySection(incident: incident),
                ],
              ),
            ),
          ],
              ),
            ),
        ),
    );
  }
}

/// "Report Summary" — the structured recap of a report's key fields, shown at
/// the bottom of the History detail sheet.
///
/// ── A TABLE, NOT A LIST OF DECORATED LINES ────────────────────────────────
/// This was five icon-and-stacked-text rows: a 15px glyph, then the field name
/// in small caps with the value under it, repeated. Two problems compound
/// there. Stacking label over value means every field is two lines tall and
/// nothing lines up vertically between fields, so the eye has no column to run
/// down — the reader parses five little cards instead of scanning one table.
/// And the icons were decorative: a tag beside "Category", a pin beside
/// "Location", a clock beside "Reported On" all restate the word next to them,
/// while costing 25px of the value's width on the narrowest screens.
///
/// It is now what it always was underneath — a metadata table. Field names sit
/// in a fixed left column, values start on one shared alignment line, and a
/// hairline separates each row. The description, which is prose rather than a
/// field, drops to a full-width block at the end where it can wrap without
/// dragging the value column out with it.
class _ReportSummarySection extends StatelessWidget {
  final Incident incident;
  const _ReportSummarySection({required this.incident});

  /// The label column. Wide enough for the longest field name at this weight
  /// ("Reported By") without wrapping, and fixed so every value in the card
  /// starts on the same vertical line.
  static const double _labelColumn = 104;

  static const double _sidePad = 16;
  static const double _rowPad = 13;

  @override
  Widget build(BuildContext context) {
    // Field names follow the spec's vocabulary rather than the model's:
    // `incident.category` is displayed as "Incident Type" and `reportedAt` as
    // "Date & Time". The data is untouched — this is the label a resident
    // reads, not a rename of anything the app stores.
    final fields = <(String, String)>[
      ('Incident Type', incident.category),
      ('Priority', IncidentPriorityInfo.label(incident.priority)),
      ('Status', IncidentStatusInfo.label(incident.status)),
      (
        'Date & Time',
        DateFormat('MMM d, yyyy · h:mm a').format(incident.reportedAt),
      ),
      ('Location', incident.location),
      ('Reported By', incident.reporter),
    ];

    return Container(
      // White fill, slate-100 hairline, `shadow-sm` — matched to the History
      // cards this sheet opens from. Both surfaces move together or the detail
      // view stops looking like the same app as the list that led to it.
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
          color: AppColors.borderNeutralSoft,
          width: AppStroke.hairline,
        ),
        boxShadow: AppShadows.sm,
      ),
      // Clipped so the hairline rules below meet the rounded corner cleanly
      // instead of running out past it.
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(_sidePad, 14, _sidePad, 14),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Report Summary',
                    style: sfPro(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.onGlassMuted,
                      letterSpacing: 0.7,
                    ),
                  ),
                ),
                Text(
                  incident.id,
                  style: sfPro(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          for (final (label, value) in fields) ...[
            const _SummaryRule(),
            _summaryRow(label, value),
          ],
          if (incident.description.isNotEmpty) ...[
            const _SummaryRule(),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  _sidePad, _rowPad, _sidePad, _rowPad + 3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Description', style: _labelStyle),
                  const SizedBox(height: 6),
                  Text(
                    incident.description,
                    style: sfPro(
                      fontSize: 13,
                      height: 1.45,
                      color: AppColors.onGlassPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  static TextStyle get _labelStyle => sfPro(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: AppColors.onGlassMuted,
      );

  Widget _summaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(_sidePad, _rowPad, _sidePad, _rowPad),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: _labelColumn,
            child: Text(label, style: _labelStyle),
          ),
          Expanded(
            child: Text(
              value,
              style: sfPro(
                fontSize: 13,
                height: 1.35,
                fontWeight: FontWeight.w600,
                color: AppColors.onGlassPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The hairline between two summary rows. Full-bleed on purpose: an inset rule
/// inside a card that already has a border draws a second, shorter edge a few
/// pixels in from the first, and the two read as a misalignment.
class _SummaryRule extends StatelessWidget {
  const _SummaryRule();

  @override
  Widget build(BuildContext context) => const Divider(
        height: AppStroke.hairline,
        thickness: AppStroke.hairline,
        color: AppColors.borderNeutralSoft,
      );
}
