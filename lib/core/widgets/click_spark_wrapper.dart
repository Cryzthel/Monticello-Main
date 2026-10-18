import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

/// Wraps [child] with a tap-triggered particle "spark" overlay — a native
/// port of the reactbits.dev `<ClickSpark />` canvas component.
///
/// Every tap spawns [sparkCount] short lines radiating evenly around the
/// tap point, which race outward and shrink to nothing over [duration].
/// Multiple taps can be in flight at once; each is tracked independently.
///
/// The overlay is painted by a single, continuously-driven [Ticker] onto a
/// [CustomPaint] living inside its own [RepaintBoundary] — repainting it
/// every frame never touches [child]'s widget tree, since [child] is built
/// once and reused by reference across every rebuild of this wrapper.
class ClickSparkWrapper extends StatefulWidget {
  final Widget child;
  final Color sparkColor;
  final double sparkSize;
  final double sparkRadius;
  final int sparkCount;
  final Duration duration;
  final Curve easing;
  final double extraScale;

  const ClickSparkWrapper({
    super.key,
    required this.child,
    this.sparkColor = const Color(0xFFFFFFFF),
    this.sparkSize = 10.0,
    this.sparkRadius = 15.0,
    this.sparkCount = 8,
    this.duration = const Duration(milliseconds: 400),
    this.easing = Curves.easeOut,
    this.extraScale = 1.0,
  });

  @override
  State<ClickSparkWrapper> createState() => _ClickSparkWrapperState();
}

class _SparkBurst {
  final Offset center;
  final Duration startTime;
  _SparkBurst({required this.center, required this.startTime});
}

class _ClickSparkWrapperState extends State<ClickSparkWrapper>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  final Stopwatch _clock = Stopwatch();
  final List<_SparkBurst> _bursts = [];
  final ValueNotifier<int> _repaint = ValueNotifier(0);

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((_) => _onTick());
  }

  void _onTick() {
    final now = _clock.elapsed;
    _bursts.removeWhere((b) => now - b.startTime >= widget.duration);
    if (_bursts.isEmpty) {
      _ticker.stop();
      _clock.stop();
    }
    _repaint.value++;
  }

  void _handleTapDown(TapDownDetails details) {
    if (!_clock.isRunning) _clock.start();
    _bursts.add(
      _SparkBurst(center: details.localPosition, startTime: _clock.elapsed),
    );
    if (!_ticker.isTicking) _ticker.start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _repaint.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTapDown: _handleTapDown,
      child: Stack(
        children: [
          widget.child,
          Positioned.fill(
            child: IgnorePointer(
              child: RepaintBoundary(
                child: ValueListenableBuilder<int>(
                  valueListenable: _repaint,
                  builder: (context, _, __) {
                    return CustomPaint(
                      painter: _SparkPainter(
                        bursts: _bursts,
                        now: _clock.elapsed,
                        color: widget.sparkColor,
                        sparkSize: widget.sparkSize,
                        sparkRadius: widget.sparkRadius,
                        sparkCount: widget.sparkCount,
                        duration: widget.duration,
                        easing: widget.easing,
                        extraScale: widget.extraScale,
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SparkPainter extends CustomPainter {
  final List<_SparkBurst> bursts;
  final Duration now;
  final Color color;
  final double sparkSize;
  final double sparkRadius;
  final int sparkCount;
  final Duration duration;
  final Curve easing;
  final double extraScale;

  _SparkPainter({
    required this.bursts,
    required this.now,
    required this.color,
    required this.sparkSize,
    required this.sparkRadius,
    required this.sparkCount,
    required this.duration,
    required this.easing,
    required this.extraScale,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (bursts.isEmpty) return;

    final paint = Paint()
      ..color = color
      ..strokeWidth = 2.0
      ..strokeCap = StrokeCap.round;

    final totalMs = duration.inMicroseconds / 1000.0;

    for (final burst in bursts) {
      final elapsedMs = (now - burst.startTime).inMicroseconds / 1000.0;
      final rawProgress = (elapsedMs / totalMs).clamp(0.0, 1.0);
      if (rawProgress >= 1.0) continue;
      final easedProgress = easing.transform(rawProgress);

      final distance = easedProgress * sparkRadius * extraScale;
      final lineLength = sparkSize * (1 - easedProgress);

      for (var i = 0; i < sparkCount; i++) {
        final angle = (2 * math.pi * i) / sparkCount;
        final cosA = math.cos(angle);
        final sinA = math.sin(angle);

        final start = Offset(
          burst.center.dx + distance * cosA,
          burst.center.dy + distance * sinA,
        );
        final end = Offset(
          burst.center.dx + (distance + lineLength) * cosA,
          burst.center.dy + (distance + lineLength) * sinA,
        );
        canvas.drawLine(start, end, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _SparkPainter oldDelegate) => true;
}
