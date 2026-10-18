import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

enum GlassVariant { surface, elevated, subtle }

/// A true frosted-glass panel: blurs whatever sits behind it (the forest-
/// green canvas + ambient glow shapes) and lays a mint-tinted 5% fill on
/// top of the blur, with a directional hairline border that simulates a
/// light source from the top-left — bright on top/left, dim on
/// bottom/right — so panels read as physically lit glass.
class GlassContainer extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final double borderRadius;
  final double blur;
  final Color? tint;
  final Border? border;
  final double? width;
  final double? height;
  final VoidCallback? onTap;
  final GlassVariant variant;

  const GlassContainer({
    super.key,
    required this.child,
    this.padding,
    this.margin,
    this.borderRadius = AppRadius.lg,
    this.blur = 20,
    this.tint,
    this.border,
    this.width,
    this.height,
    this.onTap,
    this.variant = GlassVariant.surface,
  });

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(borderRadius);
    final pad = padding ?? const EdgeInsets.all(AppSpacing.cardPadding);
    final fillAlphaScale = switch (variant) {
      GlassVariant.elevated => 1.6,
      GlassVariant.subtle => 0.7,
      GlassVariant.surface => 1.0,
    };
    final baseFill = tint != null
        ? tint!.withValues(alpha: 0.05)
        : AppColors.glassFill;
    final fill = baseFill.withValues(
      alpha: (baseFill.a * fillAlphaScale).clamp(0.0, 1.0),
    );

    final blurred = ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          padding: pad,
          decoration: BoxDecoration(
            borderRadius: radius,
            color: fill,
            border: border ??
                const Border(
                  top: BorderSide(color: AppColors.glassBorderTopLeft, width: 1),
                  left: BorderSide(color: AppColors.glassBorderTopLeft, width: 1),
                  bottom: BorderSide(color: AppColors.glassBorderBottomRight, width: 1),
                  right: BorderSide(color: AppColors.glassBorderBottomRight, width: 1),
                ),
          ),
          child: child,
        ),
      ),
    );

    final panel = Container(
      width: width,
      height: height,
      margin: margin,
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: [
          BoxShadow(
            color: AppColors.glassShadow,
            blurRadius: variant == GlassVariant.elevated ? 26 : 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: blurred,
    );

    if (onTap == null) return panel;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: radius,
        splashColor: Colors.white.withValues(alpha: 0.08),
        highlightColor: Colors.white.withValues(alpha: 0.05),
        onTap: onTap,
        child: panel,
      ),
    );
  }
}
