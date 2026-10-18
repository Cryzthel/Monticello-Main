import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// ─────────────────────── SKELETON PLACEHOLDERS ───────────────────────
/// `animate-pulse`, driven by ONE animation for a whole placeholder screen.
///
/// ── WHY THE PULSE IS AT THE TOP AND NOT ON EACH BLOCK ─────────────────────
/// Tailwind's `animate-pulse` is a per-element class, and the reason it looks
/// coherent on the web is that every element carrying it starts its 2s cycle at
/// the same moment. Reproducing that literally here would mean one
/// [AnimationController] per grey rectangle — a settings screen's placeholder
/// is a dozen of them — and any that mounted a frame late would drift out of
/// phase for as long as the screen is up.
///
/// [Skeleton] wraps the whole placeholder in a single [FadeTransition] instead.
/// One ticker, one phase, no drift, and the blocks themselves stay what they
/// should be: plain [Container]s with no state of their own.
///
/// ── AND WHY IT FADES RATHER THAN SHIMMERS ─────────────────────────────────
/// A shimmer sweep is a gradient travelling across a masked layer — a saveLayer
/// per frame per card, on the screen the app shows when it is ALREADY waiting
/// on the network. Opacity on one subtree is a single compositor operation, and
/// it is what the spec asked for.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, required this.child, this.label = 'Loading'});

  final Widget child;

  /// What a screen reader announces in place of the placeholder shapes, which
  /// have no meaning to read out.
  final String label;

  /// One full pulse: opaque → [minOpacity] → opaque.
  static const Duration period = Duration(milliseconds: 2000);

  static const double minOpacity = 0.45;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    // Half the period: `reverse: true` supplies the other half, so the round
    // trip is [Skeleton.period] and the fade in and out are symmetric.
    duration: Skeleton.period ~/ 2,
  )..repeat(reverse: true);

  late final Animation<double> _fade = Tween<double>(
    begin: 1,
    end: Skeleton.minOpacity,
  ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: widget.label,
      container: true,
      // The shapes underneath are decoration. Without this a screen reader
      // walks a dozen unlabelled boxes.
      child: ExcludeSemantics(
        child: FadeTransition(opacity: _fade, child: widget.child),
      ),
    );
  }
}

/// One grey shape in a placeholder: a line of text, a tile, an avatar.
///
/// Slate-200 rather than slate-100. A placeholder has to be READ as a shape
/// standing in for content — at slate-100 under a 45% fade it is a white card
/// with a faint smudge on it, which reads as a rendering fault rather than as
/// "this is coming".
class SkeletonBlock extends StatelessWidget {
  const SkeletonBlock({
    super.key,
    this.width,
    this.height = 12,
    this.radius = AppRadius.xs,
    this.widthFactor,
  }) : assert(width == null || widthFactor == null,
            'Give a SkeletonBlock a width or a widthFactor, not both');

  /// A circle of [size], for an avatar or a step node.
  const SkeletonBlock.circle(double size, {Key? key})
      : this(key: key, width: size, height: size, radius: size / 2);

  /// A text line whose width is a fraction of the space available — the shape
  /// a placeholder headline actually has, since real headlines do not come in
  /// fixed pixel widths.
  const SkeletonBlock.line({
    Key? key,
    double widthFactor = 1,
    double height = 11,
  }) : this(
          key: key,
          widthFactor: widthFactor,
          height: height,
          radius: AppRadius.xxs,
        );

  final double? width;
  final double height;
  final double radius;

  /// 0–1 of the parent's width. Wraps the block in a [FractionallySizedBox]
  /// aligned left, so lines start at the text's own margin.
  final double? widthFactor;

  @override
  Widget build(BuildContext context) {
    final block = Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.borderNeutral,
        borderRadius: BorderRadius.circular(radius),
      ),
    );

    if (widthFactor == null) return block;
    return Align(
      alignment: Alignment.centerLeft,
      child: FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: widthFactor,
        child: block,
      ),
    );
  }
}
