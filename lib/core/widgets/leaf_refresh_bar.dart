import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';

/// The app's top-of-viewport loading indicator: a small cluster of four
/// leaves orbiting a central bud, spinning continuously while a background
/// fetch/refresh is in flight.
///
/// A native leaf-themed adaptation of the Uiverse.io "flower-loader" CSS:
///
/// ```css
/// .flower-loader {
///   width: 16px; height: 16px; border-radius: 100%;
///   box-shadow: white 0 0 15px 0,
///     #485 -12px -12px 0 4px, #485 12px -12px 0 4px,
///     #485 12px 12px 0 4px, #485 -12px 12px 0 4px;
///   animation: flower-loader 5s infinite ease-in-out;
/// }
/// @keyframes flower-loader {
///   0%  { transform: rotate(0deg); }
///   50% { transform: rotate(1080deg); }
/// }
/// ```
///
/// GEOMETRY: the reference's four round "petals" (its box-shadow layers —
/// a `border-radius: 100%` element's shadow is a circle too, spread just
/// grows the copy) are redrawn here as [buildLeafPath] leaves, each
/// rotated to point outward from the center bud, at the reference's
/// diagonal offsets scaled down for a compact top bar.
///
/// MOTION: one [AnimationController] over the full 5s drives a two-segment
/// [TweenSequence] — 0 -> 1080deg over the first half, 1080 -> 0deg over
/// the second, both `Curves.easeInOut` — matching the CSS keyframes (which
/// define no 100% stop, so a browser implicitly falls back to the 0%
/// values there). A gentle scale pulse derived from the same controller
/// value is layered on top for a breathing, organic feel that ties this
/// loader to [LeafLoader]'s motion language elsewhere in the app.
///
/// PERFORMANCE: everything — glow, bud, four leaves — draws in one
/// [CustomPainter] pass wrapped in a [RepaintBoundary], so each frame is a
/// single cheap composited layer that never forces a repaint of the list
/// behind it.
///
/// INTEGRATION: the public API is unchanged from every prior iteration of
/// this widget, so [RefreshShell] (and every screen that uses it) needs no
/// changes at all.
class LeafRefreshBar extends StatefulWidget {
  final bool active;

  const LeafRefreshBar({super.key, required this.active});

  @override
  State<LeafRefreshBar> createState() => _LeafRefreshBarState();
}

class _LeafRefreshBarState extends State<LeafRefreshBar>
    with SingleTickerProviderStateMixin {
  static const _cycleDuration = Duration(milliseconds: 5000);
  static const _transitionDuration = Duration(milliseconds: 220);

  late final AnimationController _controller;
  late final Animation<double> _rotation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: _cycleDuration);
    _rotation = TweenSequence<double>([
      TweenSequenceItem(
        tween: Tween(begin: 0.0, end: 3 * 2 * math.pi)
            .chain(CurveTween(curve: Curves.easeInOut)),
        weight: 50,
      ),
      TweenSequenceItem(
        tween: Tween(begin: 3 * 2 * math.pi, end: 0.0)
            .chain(CurveTween(curve: Curves.easeInOut)),
        weight: 50,
      ),
    ]).animate(_controller);
    if (widget.active) _controller.repeat();
  }

  @override
  void didUpdateWidget(covariant LeafRefreshBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) {
      _controller
        ..stop()
        ..value = 0
        ..repeat();
    } else if (!widget.active && oldWidget.active) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: _transitionDuration,
      curve: widget.active ? Curves.easeOutCubic : Curves.easeInCubic,
      height: widget.active ? 48 : 0,
      clipBehavior: Clip.hardEdge,
      decoration: const BoxDecoration(),
      child: AnimatedOpacity(
        duration: _transitionDuration,
        curve: widget.active ? Curves.easeOut : Curves.easeIn,
        opacity: widget.active ? 1 : 0,
        child: Center(
          child: SizedBox(
            width: 44,
            height: 44,
            child: RepaintBoundary(
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, _) {
                  // A gentle breathing pulse layered on top of the
                  // rotation — peaks at the midpoint of each 5s cycle.
                  final scale =
                      0.92 + 0.08 * math.sin(_controller.value * math.pi);
                  return Transform.scale(
                    scale: scale,
                    child: CustomPaint(
                      painter: _LeafClusterPainter(angle: _rotation.value),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _LeafClusterPainter extends CustomPainter {
  final double angle;

  _LeafClusterPainter({required this.angle});

  static const _leafSize = Size(15, 11);
  static const _orbitRadius = 15.0;
  static const _budRadius = 5.5;
  // The reference's diagonal offsets (-12,-12) / (12,-12) / (12,12) /
  // (-12,12), expressed as angles from center.
  static const _corners = [
    -math.pi / 4, // top-right
    math.pi / 4, // bottom-right
    3 * math.pi / 4, // bottom-left
    -3 * math.pi / 4, // top-left
  ];

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.rotate(angle);

    // The reference's `white 0 0 15px 0` ambient glow, tinted to the app's
    // accent instead of literal white.
    final glowPaint = Paint()
      ..color = AppColors.accentPrimary.withValues(alpha: 0.4)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 9);
    canvas.drawCircle(Offset.zero, _budRadius, glowPaint);

    // Four leaves radiating outward from the center, each rotated to point
    // away from the bud along its own corner angle.
    final leafPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.bottomCenter,
        end: Alignment.topCenter,
        colors: [AppColors.accentPrimary, AppColors.accentSecondary],
      ).createShader(Rect.fromLTWH(0, 0, _leafSize.width, _leafSize.height));
    final leafPath = buildLeafPath(_leafSize);

    for (final cornerAngle in _corners) {
      canvas.save();
      canvas.translate(
        _orbitRadius * math.cos(cornerAngle),
        _orbitRadius * math.sin(cornerAngle),
      );
      canvas.rotate(cornerAngle + math.pi / 2);
      canvas.translate(-_leafSize.width / 2, -_leafSize.height / 2);
      canvas.drawPath(leafPath, leafPaint);
      canvas.restore();
    }

    // Center bud.
    canvas.drawCircle(Offset.zero, _budRadius, Paint()..color = AppColors.accentSecondary);

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _LeafClusterPainter oldDelegate) =>
      oldDelegate.angle != angle;
}
