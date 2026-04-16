import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Scaffold with the signature ambient gradient + soft orb accents behind glass.
/// Every screen mounts its content on this surface so the design language stays
/// consistent across the app.
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
      extendBodyBehindAppBar: extendBodyBehindAppBar,
      extendBody: true,
      appBar: appBar,
      floatingActionButton: floatingActionButton,
      floatingActionButtonLocation: floatingActionButtonLocation,
      bottomNavigationBar: bottomNavigationBar,
      body: Stack(
        children: [
          // Base gradient
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: AppColors.backgroundGradient,
              ),
            ),
            child: SizedBox.expand(),
          ),
          // Ambient orbs for depth behind glass
          Positioned(
            top: -90,
            right: -70,
            child: _orb(260, AppColors.accent.withOpacity(0.22)),
          ),
          Positioned(
            bottom: -140,
            left: -90,
            child: _orb(320, AppColors.success.withOpacity(0.16)),
          ),
          Positioned(
            top: 200,
            left: -60,
            child: _orb(180, AppColors.info.withOpacity(0.14)),
          ),
          // Subtle overlay to soften contrast
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withOpacity(0.06),
                    Colors.transparent,
                    Colors.black.withOpacity(0.18),
                  ],
                ),
              ),
            ),
          ),
          // Body content
          inner,
        ],
      ),
    );
  }

  Widget _orb(double size, Color color) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: color,
          boxShadow: [
            BoxShadow(
              color: color,
              blurRadius: 140,
              spreadRadius: 50,
            ),
          ],
        ),
      ),
    );
  }
}
