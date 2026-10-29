import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// One entry in Report History — a report or an SOS alert — laid out like a
/// notification row (2026-10-29, by request): a round tinted glyph, the title
/// with one line of detail under it, the time on the right, and a single
/// status chip. Full-bleed rows split by hairlines instead of stacked cards,
/// so a long history scans as one clean list.
class HistoryRow extends StatelessWidget {
  const HistoryRow({
    super.key,
    required this.icon,
    required this.tint,
    required this.title,
    required this.detail,
    required this.at,
    required this.statusLabel,
    required this.statusColor,
    this.onTap,
    this.onLongPress,
  });

  final IconData icon;
  final Color tint;
  final String title;
  final String detail;
  final DateTime at;
  final String statusLabel;
  final Color statusColor;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// "29 Oct 14:05", the notification feed's stamp.
  static String stamp(DateTime t) => DateFormat('d MMM HH:mm').format(t.toLocal());

  @override
  Widget build(BuildContext context) {
    final ink = AppColors.inkFor(statusColor);
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        splashFactory: NoSplash.splashFactory,
        highlightColor: AppColors.textPrimary.withValues(alpha: 0.04),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: tint.withValues(alpha: 0.12),
                  border: Border.all(color: AppColors.borderNeutral),
                ),
                child: Icon(icon, size: 18, color: AppColors.inkFor(tint)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: sfPro(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                              letterSpacing: -0.15,
                              height: 1.25,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Padding(
                          padding: const EdgeInsets.only(top: 1),
                          child: Text(
                            stamp(at),
                            style: sfPro(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textMuted,
                              height: 1.2,
                              fontFeatures: const [FontFeature.tabularFigures()],
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      detail,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: sfPro(fontSize: 12, color: AppColors.textSecondary, height: 1.4),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: statusColor.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                        border: Border.all(color: statusColor.withValues(alpha: 0.22)),
                      ),
                      child: Text(
                        statusLabel,
                        style: sfPro(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: ink,
                          letterSpacing: 0.1,
                          height: 1.1,
                        ),
                      ),
                    ),
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
