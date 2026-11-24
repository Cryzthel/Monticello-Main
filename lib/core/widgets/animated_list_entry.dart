import 'package:flutter/material.dart';

/// Wraps a list item so it fades and slides gently into place the first
/// time it's built — give each entry a stable `key` (e.g. `ValueKey(id)`)
/// so Flutter only replays the animation for genuinely new items, not for
/// ones that were already on screen and simply got rebuilt.
///
/// Only [Opacity] and [Transform] are animated, both of which are
/// paint-only properties in Flutter's pipeline — the item occupies its
/// final size for the entire animation, so nothing below it in the list
/// ever shifts or reflows while this plays.
class AnimatedListEntry extends StatefulWidget {
  final Widget child;

  const AnimatedListEntry({super.key, required this.child});

  @override
  State<AnimatedListEntry> createState() => _AnimatedListEntryState();
}

class _AnimatedListEntryState extends State<AnimatedListEntry>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
    _slide = Tween<Offset>(begin: const Offset(0, -0.10), end: Offset.zero)
        .animate(CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic));
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _fade,
      child: SlideTransition(position: _slide, child: widget.child),
    );
  }
}
