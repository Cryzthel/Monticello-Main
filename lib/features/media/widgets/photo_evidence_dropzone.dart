import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// Dashed-border upload target — a native port of the classic HTML
/// `<label class="custum-file-upload">` dropzone aesthetic (cloud icon over a
/// dashed rounded box, an upload caption).
///
/// THE app's uploader. The incident report's Proof of Evidence step and the
/// registration's HOA ID / Proof of Residency step both draw this, so the two
/// places a resident hands the estate a file look and behave the same. Pass
/// [title] and [subtitle] for the copy; the box, the dash, the icon and the
/// height are shared on purpose and are not parameters.
///
/// The dashed outline is hand-painted via [_DashedBorderPainter] rather than
/// a bitmap/SVG asset, so it recolors instantly with the app's glass tokens
/// and scales cleanly to any width. Tapping anywhere in the box invokes
/// [onTap] — wire this straight to the existing media-picker workflow.
class PhotoEvidenceDropzone extends StatelessWidget {
  final VoidCallback? onTap;
  final double height;
  final bool hasError;
  final String title;
  final String subtitle;

  /// The standard height. Exposed so a preview that REPLACES the dropzone
  /// once a file is chosen can take exactly the same space, and choosing a
  /// file does not move anything below it.
  static const double defaultHeight = 168;

  /// Shared with the filled previews that stand in for the dropzone.
  static const double radius = AppRadius.md;

  const PhotoEvidenceDropzone({
    super.key,
    required this.onTap,
    this.height = defaultHeight,
    this.hasError = false,
    this.title = 'Click to upload image',
    this.subtitle = 'Photos and short video clips accepted',
  });

  @override
  Widget build(BuildContext context) {
    final strokeColor = hasError
        ? AppColors.danger.withValues(alpha: 0.55)
        : AppColors.onGlassMuted.withValues(alpha: 0.55);

    return Semantics(
      button: true,
      label: '$title. $subtitle',
      excludeSemantics: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: CustomPaint(
            foregroundPainter: _DashedBorderPainter(
              color: strokeColor,
              radius: AppRadius.md,
            ),
            child: Container(
              height: height,
              width: double.infinity,
              decoration: BoxDecoration(
                color: AppColors.glassFill,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    PhosphorIconsFill.cloudArrowUp,
                    size: 52,
                    color: AppColors.primaryDark,
                  ),
                  const SizedBox(height: 14),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: sfPro(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: AppColors.onGlassSecondary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    textAlign: TextAlign.center,
                    style: sfPro(
                      fontSize: 11.5,
                      color: AppColors.onGlassMuted,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Dashes the outline of any box, the way the dropzone does. Public so a
/// filled preview can keep the same edge it replaced.
class DashedOutline extends StatelessWidget {
  const DashedOutline({
    super.key,
    required this.child,
    required this.color,
    this.radius = PhotoEvidenceDropzone.radius,
  });

  final Widget child;
  final Color color;
  final double radius;

  @override
  Widget build(BuildContext context) => CustomPaint(
        foregroundPainter: _DashedBorderPainter(color: color, radius: radius),
        child: child,
      );
}

/// The red "remove" disc on an attached photo or video.
///
/// ONE of these for every attachment in the app. The incident report drew a
/// bare 22pt disc in three places, which is half the 44pt a fingertip needs —
/// and it sits in the corner of a thumbnail, exactly where a slightly-off tap
/// opens the photo instead. The disc stays 24pt to look the same; the target
/// around it is 44pt.
class MediaRemoveButton extends StatelessWidget {
  const MediaRemoveButton({
    super.key,
    required this.onTap,
    this.semanticLabel = 'Remove',
  });

  final VoidCallback onTap;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Center(
            child: Container(
              width: 24,
              height: 24,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.danger,
              ),
              child: const Icon(PhosphorIconsFill.x,
                  color: Colors.white, size: 13),
            ),
          ),
        ),
      ),
    );
  }
}

class _DashedBorderPainter extends CustomPainter {
  final Color color;
  final double radius;
  static const double dashWidth = 6;
  static const double gapWidth = 5;
  static const double strokeWidth = 1.6;

  const _DashedBorderPainter({
    required this.color,
    required this.radius,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        strokeWidth / 2,
        strokeWidth / 2,
        size.width - strokeWidth,
        size.height - strokeWidth,
      ),
      Radius.circular(radius),
    );
    final path = Path()..addRRect(rrect);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;

    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        final next = distance + dashWidth;
        canvas.drawPath(
          metric.extractPath(distance, next.clamp(0, metric.length)),
          paint,
        );
        distance = next + gapWidth;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedBorderPainter oldDelegate) =>
      color != oldDelegate.color || radius != oldDelegate.radius;
}
