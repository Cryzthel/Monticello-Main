import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// Base scaffold used across the app. Paints the ultra-dark forest-green
/// canvas plus two soft ambient glow shapes (seafoam + sage) that bleed
/// from behind the frosted glass cards, giving the glassmorphism panels
/// something to visibly blur against.
class GradientScaffold extends StatelessWidget {
  final Widget body;
  final PreferredSizeWidget? appBar;
  final Widget? floatingActionButton;
  final FloatingActionButtonLocation? floatingActionButtonLocation;
  final Widget? bottomNavigationBar;
  final bool extendBodyBehindAppBar;
  final bool safeArea;

  const GradientScaffold({
    super.key,
    required this.body,
    this.appBar,
    this.floatingActionButton,
    this.floatingActionButtonLocation,
    this.bottomNavigationBar,
    this.extendBodyBehindAppBar = true,
    this.safeArea = true,
  });

  @override
  Widget build(BuildContext context) {
    final inner = safeArea ? SafeArea(child: body) : body;

    return Scaffold(
      backgroundColor: AppColors.background,
      extendBodyBehindAppBar: extendBodyBehindAppBar,
      extendBody: true,
      appBar: appBar,
      floatingActionButton: floatingActionButton,
      floatingActionButtonLocation: floatingActionButtonLocation,
      bottomNavigationBar: bottomNavigationBar,
      body: Stack(
        children: [
          const Positioned.fill(child: AmbientGlowCanvas()),
          inner,
        ],
      ),
    );
  }
}

/// The reusable canvas + glow-orb background — exposed so screens that
/// build their own [Scaffold] (rather than [GradientScaffold]) can still
/// paint the same ambient backdrop behind their glass panels.
class AmbientGlowCanvas extends StatelessWidget {
  const AmbientGlowCanvas({super.key});

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(
      decoration: BoxDecoration(gradient: AppGradients.shell),
      child: Stack(
        children: [
          Positioned(
            top: -110,
            right: -90,
            child: _GlowOrb(
              color: AppColors.accentPrimary,
              size: 340,
              alpha: 0.20,
            ),
          ),
          Positioned(
            bottom: -150,
            left: -110,
            child: _GlowOrb(
              color: AppColors.accentSecondary,
              size: 320,
              alpha: 0.14,
            ),
          ),
        ],
      ),
    );
  }
}

class _GlowOrb extends StatelessWidget {
  final Color color;
  final double size;
  final double alpha;

  const _GlowOrb({
    required this.color,
    required this.size,
    required this.alpha,
  });

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [
              color.withValues(alpha: alpha),
              color.withValues(alpha: 0),
            ],
          ),
        ),
      ),
    );
  }
}
