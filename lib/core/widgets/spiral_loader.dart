import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// ─────────────────────── SPIRAL LOADER ───────────────────────
/// The `ldrs` "spiral" dot loader, as a painted Flutter widget.
///
/// Eight dots on a ring. Each oscillates between the centre and the rim, and
/// the ring itself turns; the eighth-of-a-cycle stagger between neighbours is
/// what makes the wave read as a spiral rather than as a pulse.
///
/// ── THE PORT, LINE BY LINE ────────────────────────────────────────────────
/// The reference is CSS, and every number below is one of its declarations:
///
/// ```css
/// .container { --uib-size: 40px; --uib-speed: .9s;
///   --uib-center: calc(var(--uib-size) / 2 - var(--uib-size) / 5 / 2);
///   animation: rotate calc(var(--uib-speed) * 3) linear infinite; }
/// .dot::before { height: 20%; width: 20%; border-radius: 50%;
///   animation: oscillate var(--uib-speed) ease-in-out infinite alternate; }
/// .dot:nth-child(n) { transform: rotate(45deg * (n-1)); }
/// .dot:nth-child(n)::before { animation-delay: calc(var(--uib-speed) * -0.125 * (n-1)); }
/// @keyframes oscillate {
///   0%   { transform: translateX(var(--uib-center)) scale(0); opacity: 0.25; }
///   100% { transform: translateX(0) scale(1); opacity: 1; } }
/// ```
///
///   · `--uib-center` is the dot's travel: half the box less half a dot. At
///     the 0% keyframe the dot sits translated to the centre of the container;
///     at 100% it has travelled back out to the rim. So the CSS reads
///     "collapsed to the middle" → "out at the edge", which is [_radiusOf].
///   · `infinite alternate` means the real oscillation period is TWICE
///     `--uib-speed` — out and back — which is why [_cycle] is `speed * 2`.
///   · the container's own `rotate` is `speed * 3`, a deliberately different
///     period from the dots'. The two only realign every `speed * 6`, and that
///     is exactly [period]: one controller of that length repeats seamlessly
///     and drives both, with no drift and no second ticker.
///
/// ── WHY A PAINTER AND NOT EIGHT ANIMATED WIDGETS ──────────────────────────
/// The literal translation of the markup is eight `Transform`s each wrapping a
/// `FadeTransition` around a `ScaleTransition` — 24 widgets rebuilding every
/// frame, inside a refresh bar that sits over a scrolling list. One
/// [CustomPainter] draws the same eight circles in one pass, inside a
/// [RepaintBoundary], so a spinning loader never repaints the feed behind it.
class SpiralLoader extends StatefulWidget {
  const SpiralLoader({
    super.key,
    this.size = 40,
    this.color,
    this.speed = const Duration(milliseconds: 900),
    this.spinning = true,
  });

  /// `--uib-size`.
  final double size;

  /// `--uib-color`. Defaults to the brand accent rather than the reference's
  /// literal black — this loader appears over white feeds, and black would be
  /// the only pure black in the app.
  final Color? color;

  /// `--uib-speed`: one leg of the oscillation. The dots' full out-and-back is
  /// twice this, and the ring's rotation is three times it.
  final Duration speed;

  /// False parks the animation. A loader is only ever on screen while
  /// something is loading, but a paused ticker costs nothing and makes that
  /// explicit rather than implicit in whether the widget is mounted.
  final bool spinning;

  static const int dots = 8;

  /// The dot's diameter as a fraction of the box — the reference's `20%`.
  static const double dotFraction = 0.2;

  /// How long the whole figure takes to return to its starting state: the
  /// least common multiple of the dots' `speed * 2` and the ring's
  /// `speed * 3`.
  static Duration periodFor(Duration speed) => speed * 6;

  /// How long ONE turn of the ring takes — the CSS container's
  /// `rotate calc(var(--uib-speed) * 3)`.
  ///
  /// This, not [speed], is what a reader means by "one spin": the dots'
  /// oscillation is a texture on top of it, and the figure's full [periodFor]
  /// is two turns. So a caller thinking in rotations wants [speedForRotation]
  /// rather than to divide by three at the call site and leave the next reader
  /// to work out which of the three periods the number refers to.
  static Duration rotationFor(Duration speed) => speed * 3;

  /// The inverse of [rotationFor]: the [speed] at which one turn of the ring
  /// takes [rotation].
  static Duration speedForRotation(Duration rotation) => rotation ~/ 3;

  @override
  State<SpiralLoader> createState() => _SpiralLoaderState();
}

class _SpiralLoaderState extends State<SpiralLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: SpiralLoader.periodFor(widget.speed),
  );

  @override
  void initState() {
    super.initState();
    if (widget.spinning) _controller.repeat();
  }

  @override
  void didUpdateWidget(SpiralLoader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.speed != oldWidget.speed) {
      _controller.duration = SpiralLoader.periodFor(widget.speed);
    }
    if (widget.spinning == oldWidget.spinning) return;
    if (widget.spinning) {
      _controller.repeat();
    } else {
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
    return RepaintBoundary(
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => CustomPaint(
            painter: SpiralPainter(
              t: _controller.value,
              color: widget.color ?? AppColors.primary,
            ),
          ),
        ),
      ),
    );
  }
}

/// Paints one frame of the spiral. [t] is 0–1 over one full [SpiralLoader]
/// period; everything else is derived from it.
class SpiralPainter extends CustomPainter {
  const SpiralPainter({required this.t, required this.color});

  /// Position within the six-speed period, 0–1.
  final double t;

  final Color color;

  /// Fraction of the dots' own out-and-back cycle for dot [index], 0–1 and
  /// back to 0.
  ///
  /// The period is a third of the figure's, so `t * 3` counts dot cycles; the
  /// reference's `-0.125` delay per child is an eighth of ONE leg, which is a
  /// sixteenth of the out-and-back — hence the /16.
  static double phaseOf(double t, int index) {
    final u = (t * 3 + index / 16) % 1.0;
    // `alternate`: the second half of the cycle is the first half backwards.
    final legs = u * 2;
    return legs <= 1 ? legs : 2 - legs;
  }

  /// `translateX(--uib-center) → translateX(0)`, expressed as distance from
  /// the centre: 0 when collapsed, `travel` when out at the rim.
  static double radiusOf(double eased, double travel) => eased * travel;

  @override
  void paint(Canvas canvas, Size size) {
    final box = math.min(size.width, size.height);
    final dotRadius = box * SpiralLoader.dotFraction / 2;
    // `--uib-center`: half the box, less half a dot.
    final travel = box / 2 - dotRadius;
    final centre = Offset(size.width / 2, size.height / 2);

    // The container's own rotation — a third of the figure's period, linear.
    final spin = (t * 2 % 1.0) * 2 * math.pi;

    final paint = Paint()..isAntiAlias = true;

    for (var i = 0; i < SpiralLoader.dots; i++) {
      final eased = Curves.easeInOut.transform(phaseOf(t, i));
      // Scale 0 is an invisible dot; skipping it also avoids asking the canvas
      // to draw a zero-radius circle every cycle.
      if (eased <= 0.001) continue;

      final angle = spin + i * 2 * math.pi / SpiralLoader.dots;
      final distance = radiusOf(eased, travel);
      final at = centre +
          Offset(math.cos(angle) * distance, math.sin(angle) * distance);

      canvas.drawCircle(
        at,
        dotRadius * eased,
        // `opacity: 0.25 → 1` across the same eased travel.
        paint..color = color.withValues(alpha: 0.25 + 0.75 * eased),
      );
    }
  }

  @override
  bool shouldRepaint(covariant SpiralPainter oldDelegate) =>
      oldDelegate.t != t || oldDelegate.color != color;
}
