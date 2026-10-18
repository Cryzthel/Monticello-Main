import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// The three stages every long-running, percentage-trackable operation
/// (uploads, installs, sync jobs) moves through in strict order:
/// [pending] while work is in flight, [complete] for the brief confirmation
/// beat once it hits 100%, then [executing] once the final UI is live.
enum ProgressStage { pending, complete, executing }

/// Drives a [StagedProgressView]. Feed it real progress via [updatePercent]
/// (0-100); it automatically advances pending -> complete -> executing once
/// the percentage reaches 100, holding on the checkmark just long enough to
/// read before revealing the finished state.
class StagedProgressController extends ChangeNotifier {
  double _percent = 0;
  ProgressStage _stage = ProgressStage.pending;
  bool _disposed = false;

  double get percent => _percent;
  ProgressStage get stage => _stage;

  /// Returns a future that resolves once the complete -> executing hold has
  /// played out, so callers that need to wait for the full confirmation
  /// beat (e.g. before navigating away) can `await` it directly instead of
  /// guessing a delay. Safe to ignore for fire-and-forget progress updates.
  Future<void> updatePercent(double value) {
    if (_disposed || _stage != ProgressStage.pending) return Future.value();
    _percent = value.clamp(0, 100);
    if (_percent >= 100) {
      return _advance();
    }
    notifyListeners();
    return Future.value();
  }

  Future<void> _advance() async {
    _percent = 100;
    _stage = ProgressStage.complete;
    notifyListeners();
    await Future.delayed(const Duration(milliseconds: 700));
    if (_disposed) return;
    _stage = ProgressStage.executing;
    notifyListeners();
  }

  void reset() {
    _percent = 0;
    _stage = ProgressStage.pending;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// Renders the current stage of a [StagedProgressController]:
/// - pending: no bar/container at all, just a floating, pulsing percentage.
/// - complete: a checkmark that draws itself in.
/// - executing: [child] — the caller's finished/active UI — fades in.
class StagedProgressView extends StatelessWidget {
  final StagedProgressController controller;
  final Widget child;
  final Color color;
  final double percentFontSize;

  /// What the PENDING stage draws, given the current percentage.
  ///
  /// Defaults to the floating number. A caller supplies this when a figure is
  /// the wrong way to say "working" on its surface — the account-creation
  /// button passes a leaf bar, because its steps are nothing like equal in
  /// duration and a precise percentage invites arithmetic it cannot support.
  /// The evidence-upload chip keeps the number: it is a 14px slot in a row,
  /// where a bar has nowhere to go.
  final Widget Function(double percent)? pendingBuilder;

  const StagedProgressView({
    super.key,
    required this.controller,
    required this.child,
    this.color = AppColors.accentPrimary,
    this.percentFontSize = 32,
    this.pendingBuilder,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        return AnimatedSwitcher(
          duration: const Duration(milliseconds: 380),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeInCubic,
          transitionBuilder: (widget, animation) => FadeTransition(
            opacity: animation,
            child: ScaleTransition(
              scale: Tween(begin: 0.9, end: 1.0).animate(animation),
              child: widget,
            ),
          ),
          child: switch (controller.stage) {
            ProgressStage.pending => KeyedSubtree(
                key: const ValueKey('pending'),
                child: pendingBuilder?.call(controller.percent) ??
                    _FloatingPercent(
                      percent: controller.percent,
                      color: color,
                      fontSize: percentFontSize,
                    ),
              ),
            ProgressStage.complete => _DrawnCheckmark(
                key: const ValueKey('complete'),
                color: color,
                size: percentFontSize * 1.8,
              ),
            ProgressStage.executing => KeyedSubtree(
                key: const ValueKey('executing'),
                child: child,
              ),
          },
        );
      },
    );
  }
}

/// A bare percentage number — no track, no container — that gently floats
/// and pulses in place so the interface stays minimal while work happens.
class _FloatingPercent extends StatefulWidget {
  final double percent;
  final Color color;
  final double fontSize;

  const _FloatingPercent({
    required this.percent,
    required this.color,
    required this.fontSize,
  });

  @override
  State<_FloatingPercent> createState() => _FloatingPercentState();
}

class _FloatingPercentState extends State<_FloatingPercent>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final wave = math.sin(_controller.value * 2 * math.pi);
        return Transform.translate(
          offset: Offset(0, wave * 3),
          child: Opacity(
            opacity: 0.82 + (wave.abs() * 0.18),
            child: Text(
              '${widget.percent.round()}%',
              style: sfPro(
                fontSize: widget.fontSize,
                fontWeight: FontWeight.w700,
                color: widget.color,
                letterSpacing: -0.5,
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Just the animated checkmark stroke — draws itself in once, no
/// background badge. Drop this into any container that already provides
/// its own circular/backdrop styling (e.g. a step-indicator node) to reuse
/// the exact same confirmation motion [StagedProgressView] uses, without
/// doubling up on badge chrome.
class AnimatedCheckmark extends StatefulWidget {
  final Color color;
  final double size;
  final Duration duration;

  const AnimatedCheckmark({
    super.key,
    required this.color,
    this.size = 20,
    this.duration = const Duration(milliseconds: 380),
  });

  @override
  State<AnimatedCheckmark> createState() => _AnimatedCheckmarkState();
}

class _AnimatedCheckmarkState extends State<AnimatedCheckmark>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration)
      ..forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => SizedBox(
        width: widget.size,
        height: widget.size,
        child: CustomPaint(
          painter: CheckmarkPainter(
            color: widget.color,
            progress: Curves.easeOut.transform(_controller.value),
          ),
        ),
      ),
    );
  }
}

/// Confirmation checkmark that strokes itself on, once, inside a soft
/// filled badge — the visual "click" between pending work and the
/// installation/execution phase that follows.
class _DrawnCheckmark extends StatefulWidget {
  final Color color;
  final double size;

  const _DrawnCheckmark({super.key, required this.color, required this.size});

  @override
  State<_DrawnCheckmark> createState() => _DrawnCheckmarkState();
}

class _DrawnCheckmarkState extends State<_DrawnCheckmark>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _badgeScale;
  late final Animation<double> _strokeProgress;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    )..forward();
    _badgeScale = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.6, curve: Curves.easeOutBack),
    );
    _strokeProgress = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.35, 1.0, curve: Curves.easeOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Transform.scale(
          scale: _badgeScale.value,
          child: Container(
            width: widget.size,
            height: widget.size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: widget.color.withValues(alpha: 0.16),
              border: Border.all(color: widget.color, width: 2),
            ),
            child: CustomPaint(
              painter: CheckmarkPainter(
                color: widget.color,
                progress: _strokeProgress.value,
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Draws a checkmark stroke that reveals itself as [progress] goes 0 -> 1.
///
/// The tick occupies the middle ~50% of whatever box it is given — see
/// [vertices] — so the box IS the clearance. A caller that wants a check with
/// room around it inside a circle paints at the circle's full diameter rather
/// than insetting the painter.
class CheckmarkPainter extends CustomPainter {
  final Color color;
  final double progress;

  /// Stroke weight in logical pixels, or null for the size-relative default.
  ///
  /// The default is `shortestSide * 0.11`, tuned for the wizard's ~58px
  /// confirmation badge. It does not survive being scaled down: on the History
  /// card's 26px step node the same ratio gives a 2.9px stroke across a 13px
  /// tick, which reads as a blob rather than a check. Small callers state the
  /// weight they want instead of inheriting a ratio meant for a badge four
  /// times the size.
  final double? strokeWidth;

  CheckmarkPainter({
    required this.color,
    required this.progress,
    this.strokeWidth,
  });

  /// The tick's three points, as fractions of the box.
  ///
  /// Named because [boundsFor] measures them: "the check fits inside the node"
  /// is a claim about geometry, and the only honest way to hold it is to derive
  /// the extent from the same numbers that draw it.
  static const List<Offset> vertices = [
    Offset(0.26, 0.53),
    Offset(0.44, 0.70),
    Offset(0.76, 0.32),
  ];

  /// The stroke this painter will actually use on a [size] box.
  static double strokeFor(Size size, [double? strokeWidth]) =>
      strokeWidth ?? size.shortestSide * 0.11;

  /// Everything the painter puts on the canvas at `progress: 1`, stroke
  /// included. Round caps extend half a stroke past each endpoint, so the
  /// vertex bounds are inflated by exactly that.
  static Rect boundsFor(Size size, {double? strokeWidth}) {
    var left = double.infinity;
    var top = double.infinity;
    var right = -double.infinity;
    var bottom = -double.infinity;
    for (final v in vertices) {
      final x = v.dx * size.width;
      final y = v.dy * size.height;
      left = math.min(left, x);
      top = math.min(top, y);
      right = math.max(right, x);
      bottom = math.max(bottom, y);
    }
    return Rect.fromLTRB(left, top, right, bottom)
        .inflate(strokeFor(size, strokeWidth) / 2);
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;
    final path = Path()
      ..moveTo(vertices[0].dx * size.width, vertices[0].dy * size.height)
      ..lineTo(vertices[1].dx * size.width, vertices[1].dy * size.height)
      ..lineTo(vertices[2].dx * size.width, vertices[2].dy * size.height);

    final metrics = path.computeMetrics().toList();
    final drawPath = Path();
    for (final metric in metrics) {
      drawPath.addPath(
        metric.extractPath(0, metric.length * progress),
        Offset.zero,
      );
    }

    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeFor(size, strokeWidth)
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(drawPath, paint);
  }

  @override
  bool shouldRepaint(covariant CheckmarkPainter oldDelegate) =>
      oldDelegate.progress != progress ||
      oldDelegate.color != color ||
      oldDelegate.strokeWidth != strokeWidth;
}
