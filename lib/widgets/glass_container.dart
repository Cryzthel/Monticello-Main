import 'dart:ui';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Visual variants for glass surfaces.
/// * [surface]  — default panel, balanced opacity
/// * [elevated] — brighter highlight + stronger shadow (for cards on top of cards)
/// * [subtle]   — low-noise glass for background elements or inline chips
enum GlassVariant { surface, elevated, subtle }

/// Reusable glassmorphic container — the backbone of the design language.
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
    this.blur = 22,
    this.tint,
    this.border,
    this.width,
    this.height,
    this.onTap,
    this.variant = GlassVariant.surface,
  });

  /// Gradient stops for each variant — carefully balanced for frosted look.
  List<Color> _gradientStops() {
    final base = tint ?? Colors.white;
    switch (variant) {
      case GlassVariant.elevated:
        return [base.withOpacity(0.24), base.withOpacity(0.08)];
      case GlassVariant.subtle:
        return [base.withOpacity(0.10), base.withOpacity(0.03)];
      case GlassVariant.surface:
        return [base.withOpacity(0.18), base.withOpacity(0.06)];
    }
  }

  double _borderOpacity() {
    switch (variant) {
      case GlassVariant.elevated:
        return 0.28;
      case GlassVariant.subtle:
        return 0.14;
      case GlassVariant.surface:
        return 0.22;
    }
  }

  List<BoxShadow> _shadows() {
    switch (variant) {
      case GlassVariant.elevated:
        return [
          BoxShadow(
            color: Colors.black.withOpacity(0.22),
            blurRadius: 32,
            offset: const Offset(0, 16),
          ),
        ];
      case GlassVariant.subtle:
        return const [];
      case GlassVariant.surface:
        return [
          const BoxShadow(
            color: AppColors.glassShadow,
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(borderRadius);

    final content = ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          width: width,
          height: height,
          padding: padding ?? const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: _gradientStops(),
            ),
            borderRadius: radius,
            border: border ??
                Border.all(
                  color: Colors.white.withOpacity(_borderOpacity()),
                  width: 1,
                ),
          ),
          child: child,
        ),
      ),
    );

    final wrapped = Container(
      width: width,
      height: height,
      margin: margin,
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: _shadows(),
      ),
      child: content,
    );

    if (onTap == null) return wrapped;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: radius,
        splashColor: Colors.white.withOpacity(0.08),
        highlightColor: Colors.white.withOpacity(0.04),
        onTap: onTap,
        child: wrapped,
      ),
    );
  }
}
