import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// Draws the app's shared leaf silhouette — pointed at both ends, widest
/// at the middle — filling the given [size].
///
/// [LeafLoader] is where this is used: the in-place loader a screen shows
/// while its own content is being fetched. The pull-to-refresh bar used to
/// draw a four-leaf cluster from the same path and no longer exists — refresh
/// now shows `SpiralLoader`, so the leaf is the app's WAITING mark and the
/// spiral is its REFRESHING one.
Path buildLeafPath(Size size) {
  final w = size.width;
  final h = size.height;
  return Path()
    ..moveTo(w / 2, 0)
    ..quadraticBezierTo(w, h * 0.18, w / 2, h)
    ..quadraticBezierTo(0, h * 0.18, w / 2, 0)
    ..close();
}

/// The app's standard small loading spinner — a single leaf silhouette
/// spinning continuously with a gentle breathing scale pulse layered on
/// top, so it never reads as a mechanical, generic progress wheel. Used
/// wherever a screen needs an inline "working on it" indicator (buttons,
/// full-page loads, etc).
class LeafLoader extends StatefulWidget {
  final double size;
  final Color? color;

  const LeafLoader({super.key, this.size = 32, this.color});

  @override
  State<LeafLoader> createState() => _LeafLoaderState();
}

class _LeafLoaderState extends State<LeafLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? AppColors.accentPrimary;
    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final t = _controller.value;
          final scale = 0.88 + 0.12 * math.sin(t * math.pi * 2);
          return Transform.rotate(
            angle: t * 2 * math.pi,
            child: Transform.scale(
              scale: scale,
              child: CustomPaint(
                size: Size.square(widget.size),
                painter: _LeafPainter(color: color),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _LeafPainter extends CustomPainter {
  final Color color;

  _LeafPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final path = buildLeafPath(size);
    final paint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [color, color.withValues(alpha: 0.55)],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height));
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _LeafPainter oldDelegate) =>
      oldDelegate.color != color;
}
