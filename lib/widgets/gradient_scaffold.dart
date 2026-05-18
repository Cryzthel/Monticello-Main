import 'package:flutter/material.dart';

/// Plain white scaffold used across the app. Kept under the original name
/// so existing imports continue to work without touching every screen.
///
/// Previously this rendered a multi-stop gradient with glowing accent orbs
/// behind every page; that has been removed in favour of a flat, modern
/// white surface that matches the auth, home, and verify screens.
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
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      extendBodyBehindAppBar: extendBodyBehindAppBar,
      extendBody: true,
      appBar: appBar,
      floatingActionButton: floatingActionButton,
      floatingActionButtonLocation: floatingActionButtonLocation,
      bottomNavigationBar: bottomNavigationBar,
      body: inner,
    );
  }
}
